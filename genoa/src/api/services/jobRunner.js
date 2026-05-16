// Engineering export job runner.
//
// Dispatches a queued job to the appropriate compute / render pipeline.
// Updates progress messages so the UI can show "Computing exhibit…",
// "Running FCC validation…", "Rendering engineering statement…" while
// the long work runs in the background.
//
// PURE EXECUTION ARCHITECTURE — does not modify FCC math, contour
// logic, parity logic, or report content.  It just calls the same
// pipelines that the synchronous endpoints already call.

import {
  JOB_KIND, JOB_STATUS,
  getJob, setProgress, completeJob, failJob, updateJob
} from './jobStore.js';
import { computeExhibit }                  from './exhibitService.js';
import { applyComputeOptionDefaults }      from './computeOptionDefaults.js';
import { enrichTowerEvidence }             from './enrichTowerEvidence.js';
import { buildEngineeringReport }          from '../../exports/engineeringReport/index.js';
import { renderEngineeringReportText }     from '../../exports/engineeringReport/renderText.js';
import { renderEngineeringReportPdf }      from '../../exports/engineeringReport/renderPdf.js';
import { fetchMapRender }                  from '../../sidecars/mapClient.js';

const PROGRESS = Object.freeze({
  COMPUTING:        'Computing exhibit…',
  VALIDATING:       'Running FCC validation…',
  BUILDING_REPORT:  'Building engineering statement…',
  RENDERING_TXT:    'Rendering engineering statement (TXT)…',
  RENDERING_PDF:    'Rendering engineering statement (PDF)…',
  FINALIZING:       'Finalizing artifact…'
});

export async function runJob(id){
  const r = getJob(id);
  if (!r) throw new Error(`runJob: no such job ${id}`);
  if (r.status !== JOB_STATUS.QUEUED && r.status !== JOB_STATUS.RUNNING){
    return r;  // already terminal
  }
  try {
    switch (r.kind){
      case JOB_KIND.EXHIBIT:                 await runExhibitJob(r);   break;
      case JOB_KIND.ENGINEERING_REPORT_TXT:  await runReportJob(r, 'txt'); break;
      case JOB_KIND.ENGINEERING_REPORT_PDF:  await runReportJob(r, 'pdf'); break;
      default: throw new Error(`unknown job kind: ${r.kind}`);
    }
  } catch (err){
    failJob(id, err);
  }
  return getJob(id);
}

// Schedule a job to run on the next macrotask so the POST handler can
// return immediately.  Errors inside runJob are captured by failJob;
// nothing here may throw to the event loop.
export function scheduleJob(id){
  setImmediate(() => { runJob(id).catch(() => { /* failJob already ran */ }); });
}

// Wrap the job record's POST body into the shape computeExhibit expects.
// The HTTP body the UI POSTs is `{ kind, input: {...form fields}, options }`.
// The job store keeps `r.input` as the form fields and `r.options` as
// the option bag — both flat.  computeExhibit reads `req.inputs` (plural)
// and `req.options`, so without this re-wrap the engine would run with
// an empty inputs map and produce the FACILITY_COORDINATES_MISSING /
// FCC_METHOD_MISSING blockers despite a fully populated form.
//
// applyComputeOptionDefaults() is then called to fill in server-side
// defaults the caller didn't set (e.g. options.use_terrain = true for
// non-AM stations).  See computeOptionDefaults.js for the full table.
function computeReq(r){
  return applyComputeOptionDefaults({
    inputs:  r.input   || {},
    options: r.options || {}
  });
}

// ─────────── kind dispatchers ───────────

async function runExhibitJob(r){
  setProgress(r.id, PROGRESS.COMPUTING);
  const exhibit = await computeExhibit(computeReq(r));
  setProgress(r.id, PROGRESS.FINALIZING);
  completeJob(r.id, {
    result:       { exhibit },
    artifact_url: artifactUrl(r.id)
  });
}

async function runReportJob(r, ext){
  // 1. Compute — always run a FRESH per-station compute().
  //
  // Previously this path would re-use r.input.exhibit when present
  // (the UI's "Download Engineering Statement PDF" button sends the
  // currently-loaded exhibit JSON for convenience).  That shortcut
  // froze whatever engine state produced the cached exhibit into the
  // PDF, including pre-existing bugs:
  //   - exhibits pre-PR #117 carried empty Appendix C/D rows
  //   - exhibits pre-PR #118 carried "(engine NOT IMPLEMENTED)"
  //     in the methodology source string
  //   - any future engine fix would silently fail to reach the PDF
  //
  // Every engineering statement must reflect a real per-station
  // computation under the CURRENT engine — no filling in gaps from
  // cached JSON.  When the caller passes a cached exhibit, extract
  // its station_inputs and rerun the full compute pipeline (which
  // also re-fetches upstream evidence like ZTR rich-station, FCC
  // parity, nearby_primaries — none of which should be inherited
  // from a stale snapshot).
  setProgress(r.id, PROGRESS.COMPUTING);
  const cached = (r.input && r.input.exhibit && typeof r.input.exhibit === 'object')
    ? r.input.exhibit
    : null;
  const req = cached
    ? applyComputeOptionDefaults({
        inputs:  cached.station_inputs || {},
        options: r.options || {}
      })
    : computeReq(r);
  const exhibit = await computeExhibit(req);

  // 2. Validation pass — exhibitService.computeExhibit already runs the
  //    standard validation.  Surfacing the milestone separately is
  //    informational (so the UI can show "Running FCC validation…").
  setProgress(r.id, PROGRESS.VALIDATING);
  // (No additional work here; computeExhibit attaches validation.)

  // 3. Build report model.  PDF builds fetch the contour-map render
  //    from the map sidecar first; TXT builds skip the fetch (no image
  //    to embed in plain text).  Sidecar absence/timeouts are
  //    fail-soft — the section emits a placeholder note instead.
  setProgress(r.id, PROGRESS.BUILDING_REPORT);
  const reportOpts = { ...(r.options || {}) };
  if (ext === 'pdf'){
    const png = await fetchMapRender(exhibit).catch(() => null);
    if (png) reportOpts.contour_map_png = png;
  }
  // Late-bind ASR + FAA OE + tower-compliance evidence so the Tower
  // Study (Exhibit XV) and §17 sections can fill from the FCC ASR bulk
  // DB even when computeExhibit didn't already attach evidence.asr.
  // Same enrichment used by the LMS Filing Package routes — the two
  // render paths share render-time evidence.
  await enrichTowerEvidence(exhibit, console);
  const doc = buildEngineeringReport(exhibit, reportOpts);

  // 4. Render TXT or PDF.
  if (ext === 'txt'){
    setProgress(r.id, PROGRESS.RENDERING_TXT);
    const body = renderEngineeringReportText(doc);
    completeJob(r.id, {
      result: {
        kind:         'engineering_report_txt',
        filename:     reportFilename(exhibit, 'txt'),
        size_bytes:   Buffer.byteLength(body, 'utf8')
      },
      artifact: {
        content_type: 'text/plain; charset=utf-8',
        body:         Buffer.from(body, 'utf8'),
        filename:     reportFilename(exhibit, 'txt')
      },
      artifact_url: artifactUrl(r.id)
    });
  } else {
    setProgress(r.id, PROGRESS.RENDERING_PDF);
    const body = await renderEngineeringReportPdf(doc);
    completeJob(r.id, {
      result: {
        kind:         'engineering_report_pdf',
        filename:     reportFilename(exhibit, 'pdf'),
        size_bytes:   body.length
      },
      artifact: {
        content_type: 'application/pdf',
        body,
        filename:     reportFilename(exhibit, 'pdf')
      },
      artifact_url: artifactUrl(r.id)
    });
  }
}

// ─────────── helpers ───────────

function artifactUrl(id){
  return `/api/exhibit/jobs/${id}/artifact`;
}

function reportFilename(exhibit, ext){
  const call = (exhibit?.station_inputs?.call || 'exhibit')
                 .toString().replace(/[^A-Za-z0-9]/g, '_');
  const ts   = new Date().toISOString().slice(0, 10);
  return `genoa-engineering-statement-${call}-${ts}.${ext}`;
}
