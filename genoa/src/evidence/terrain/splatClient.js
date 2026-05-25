// Genoa SPLAT client - talks to chelstein/splat's Genoa sidecar
// (Flask + gunicorn, deployed at SPLAT_SIDECAR_URL).
//
// Sidecar API (chelstein/splat#7-#11 reflected here):
//   GET    /healthz                  -> "ok"
//   GET    /version                  -> { sidecar, splat_bin, splat_version,
//                                      git_commit_sha, build_time, workdir,
//                                      sdf_dir, auth_required }
//   GET    /api/v1/stats             -> { total_runs, success_count, ... }
//   POST   /api/v1/splat/run         -> { command, command_string, returncode,
//                                      stdout, stderr }
//                                    body: { tx_qth, rx_qth?, output_base?,
//                                             flags?, timeout_seconds? }
//                                    IMPORTANT: tx_qth is a FILE PATH on
//                                    the sidecar's disk.
//   POST   /api/v1/splat/run-inline  -> { available, source, method, engine,
//                                      tier, dem_source, terrain_used,
//                                      runtime_seconds, radials, ... }
//                                    body: { tx_qth_content, frequency_mhz,
//                                             erp_kw, polarization,
//                                             max_distance_km,
//                                             radial_step_deg,
//                                             target_field_dbu,
//                                             timeout_seconds }
//                                    Inline JSON-in coverage sweep — no
//                                    on-disk QTH files; sidecar materialises
//                                    an ephemeral run dir per request.
//   GET    /api/v1/artifacts         -> { workdir, count, artifacts: [...] }
//   GET    /api/v1/artifacts/<path>  -> file bytes
//   GET    /api/v1/sdf               -> { sdf_dir, count, tiles: [...] }
//   POST   /api/v1/sdf/<name>        -> { name, size_bytes, ... } 201
//   DELETE /api/v1/sdf/<name>        -> { deleted: name }
//   POST   /api/v1/sdf/convert/srtm/<n> -> { name, size_bytes, runtime_seconds, ... } 201
//
// Auth: when SPLAT_API_TOKEN is set on the Genoa side AND the sidecar's
// own GENOA_API_TOKEN is set, callers must send `Authorization: Bearer
// <token>` on every endpoint except /healthz, /version, /api/v1/stats.
// This client forwards the bearer when configured; otherwise it omits
// the header (backward compatible with sidecars that haven't enabled
// auth).
//
// REALITY CHECK
//   Per-radial HAAT and ITM coverage need DEM tiles co-located on the
//   sidecar's disk under WORKDIR/sdf/.  predictItmCoverage() now drives
//   provisionDemForCoverage() automatically before each SPLAT run, so a
//   fresh tx area auto-stages its 1deg-x-1deg SRTM-3 tiles via bailu.ch
//   before the inline run goes out.  Disable via auto_provision_dem=false
//   on the call site if you want a pure-SPLAT timing or you've already
//   pre-warmed the sidecar.
//
// TIMEOUT ENVELOPE
//   The sidecar's gunicorn worker --timeout is 600 s (chelstein/splat
//   Dockerfile CMD).  This client passes timeout_seconds in the body
//   for the sidecar's own per-radial budget, AND wraps the fetch in
//   AbortSignal.timeout(timeout_seconds + 60 s) so the genoa side
//   doesn't trip first under normal load.  60 s slack covers TLS +
//   sidecar startup latency on a cold worker.

const DEFAULT_TIMEOUT_MS = 8_000;
const UPLOAD_TIMEOUT_MS  = 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
// Headroom added to timeout_seconds when computing the AbortSignal for
// /api/v1/splat/run-inline.  Must exceed the sidecar's own timeout
// budget by enough to absorb cold-worker startup + TLS handshake but
// stay safely under any upstream gateway limit.  60 s is comfortable.
const INLINE_ABORT_SLACK_S = 60;

export function makeSplatClient({
  baseUrl   = process.env.SPLAT_SIDECAR_URL || null,
  apiToken  = process.env.SPLAT_API_TOKEN   || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;

  // Sanitize: empty / whitespace-only token is treated as "no auth".
  const _token = (apiToken && String(apiToken).trim()) || null;

  function _headers(extra = {}){
    const h = { ...extra };
    if (_token) h['Authorization'] = `Bearer ${_token}`;
    return h;
  }

  return {
    baseUrl,
    auth_configured: _token !== null,

    async health(){
      try {
        const r = await fetch(joinUrl(baseUrl, '/healthz'), {
          headers: _headers(),                        // /healthz is open
                                                       // anyway, but cheap to
                                                       // forward.
          signal:  AbortSignal.timeout(3000)
        });
        return r.ok;
      } catch { return false; }
    },

    async version(){
      try {
        const r = await fetch(joinUrl(baseUrl, '/version'), {
          headers: _headers(),
          signal:  AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok) return { reachable: false, status: r.status };
        const j = await r.json();
        return { reachable: true, ...j };
      } catch (e){
        return { reachable: false, error: String(e.message) };
      }
    },

    async run({ tx_qth, rx_qth = null, output_base = null, flags = [], timeout_seconds = 120 }){
      if (!tx_qth) return { available: false, source: null, error: 'tx_qth required' };
      const endpoint = joinUrl(baseUrl, '/api/v1/splat/run');
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: _headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ tx_qth, rx_qth, output_base, flags, timeout_seconds }),
          signal: AbortSignal.timeout((timeout_seconds + 5) * 1000)
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          return { available: false, source: null, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return {
          available:      j.returncode === 0,
          source:         'splat-sidecar',
          endpoint,
          fetched_at:     new Date().toISOString(),
          command_string: j.command_string,
          returncode:     j.returncode,
          stdout:         j.stdout,
          stderr:         j.stderr
        };
      } catch (e){
        return { available: false, source: null, endpoint, error: String(e.message) };
      }
    },

    async predictItmCoverage({ tx, max_distance_km = 80, target_field_dbu = 60,
                                radial_step_deg = 10, climate_code = 5,
                                timeout_seconds = Number(process.env.SPLAT_TIMEOUT_SECONDS) || 60,
                                auto_provision_dem = true,
                                provision_concurrency = 3 } = {}){
      if (!tx || !Number.isFinite(Number(tx.lat)) || !Number.isFinite(Number(tx.lon))){
        return { available: false, source: null, error: 'tx.lat / tx.lon required' };
      }

      // Idempotent DEM provisioning before the SPLAT run.  Without
      // this, the sidecar runs flat-earth on any tx whose tile bbox
      // hasn't been pre-staged.  provisionDemForCoverage diffs against
      // the sidecar's current SDF inventory and only fetches missing
      // tiles, so calling it on every request is cheap when the area
      // is already cached.  Disable via auto_provision_dem=false (e.g.
      // when the caller wants to time a pure-SPLAT run, or when a
      // pre-warm has already populated the sidecar).
      let dem_provision = null;
      if (auto_provision_dem){
        try {
          const { provisionDemForCoverage } = await import('./provisionDem.js');
          dem_provision = await provisionDemForCoverage({
            tx:           { lat: Number(tx.lat), lon: Number(tx.lon) },
            radius_km:    max_distance_km,
            splatClient:  this,
            concurrency:  provision_concurrency
          });
        } catch (err){
          dem_provision = { available: false, error: String(err?.message || err) };
        }
      }

      const qthLines = [
        String(tx.call || 'TX'),
        String(tx.lat),
        String(-Number(tx.lon)),
        String((Number(tx.antenna_height_m) || 30) * 3.28084) + ' feet'
      ];
      const inlineEndpoint = joinUrl(baseUrl, '/api/v1/splat/run-inline');
      try {
        const r = await fetch(inlineEndpoint, {
          method:  'POST',
          headers: _headers({ 'content-type': 'application/json' }),
          body:    JSON.stringify({
            tx_qth_content:    qthLines.join('\n'),
            tx_call:           tx.call || 'TX',
            frequency_mhz:     Number(tx.frequency_mhz),
            erp_kw:            Number(tx.erp_kw),
            polarization:      tx.polarization || 'V',
            max_distance_km, target_field_dbu, radial_step_deg, climate_code,
            timeout_seconds
          }),
          // Sidecar gunicorn worker --timeout is 600 s; the inline
          // route clamps client timeout_seconds to ≤ 540 server-side,
          // so timeout_seconds + 60 s slack stays under both ceilings.
          signal:  AbortSignal.timeout((timeout_seconds + INLINE_ABORT_SLACK_S) * 1000)
        });
        if (r.status === 404){
          // Defense in depth: if the sidecar has been rolled back to a
          // build that predates inline_runner.py, fall back to the JS
          // multi-source-DEM engine cleanly instead of surfacing a 404
          // as a generic compute error.  Current sidecars (chelstein/splat
          // ≥ 28618eb) do expose this route — expected only on rollback.
          return {
            available: false,
            source:    null,
            endpoint:  inlineEndpoint,
            sidecar_enhancement_required: 'inline-qth',
            suggested_fallback:            'src/engine/coverage/itm_radial.js (computeItmCoverage)',
            note:      'SPLAT sidecar at this URL did not expose /api/v1/splat/run-inline; falling back to the multi-source-DEM JS terrain engine.  Verify the sidecar is on chelstein/splat ≥ 28618eb.',
            dem_provision
          };
        }
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, source: null, endpoint: inlineEndpoint, error: j.error || `HTTP ${r.status}`, dem_provision };
        }
        const j = await r.json();
        return {
          available:    true,
          source:       'splat-sidecar',
          endpoint:     inlineEndpoint,
          fetched_at:   new Date().toISOString(),
          method:       'SPLAT (Longley-Rice ITM v1.2.2) per-radial coverage prediction',
          dem_source:   j.dem_source || 'sidecar-provisioned (SRTM-3 / NED)',
          terrain_used: !!j.terrain_used,
          runtime_seconds: j.runtime_seconds || null,
          timeout_clamped: !!j.timeout_clamped,
          timeout_requested: j.timeout_requested ?? null,
          radials:      j.radials || [],
          target_field_dbu, max_distance_km,
          stdout_excerpt: (j.stdout || '').slice(0, 400),
          dem_provision
        };
      } catch (e){
        return { available: false, source: null, endpoint: inlineEndpoint, error: String(e.message), dem_provision };
      }
    },

    // ------------------------------------------------------------------
    // SDF terrain-tile lifecycle.  Maps to chelstein/splat#11 endpoints.
    // ------------------------------------------------------------------

    async listSdfTiles(){
      const endpoint = joinUrl(baseUrl, '/api/v1/sdf');
      try {
        const r = await fetch(endpoint, {
          headers: _headers(),
          signal:  AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    async uploadSdfTile(name, bytes){
      if (!name) return { available: false, error: 'name required' };
      if (bytes == null) return { available: false, error: 'bytes required' };
      const endpoint = joinUrl(baseUrl, `/api/v1/sdf/${encodeURIComponent(name)}`);
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: _headers({ 'content-type': 'application/octet-stream' }),
          body:   bytes,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    async deleteSdfTile(name){
      if (!name) return { available: false, error: 'name required' };
      const endpoint = joinUrl(baseUrl, `/api/v1/sdf/${encodeURIComponent(name)}`);
      try {
        const r = await fetch(endpoint, {
          method:  'DELETE',
          headers: _headers(),
          signal:  AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    // POST raw SRTM .hgt or .hgt.zip bytes to the sidecar's converter
    // endpoint.  The sidecar runs srtm2sdf and stages the produced .sdf
    // tile in WORKDIR/sdf/.  `name` MUST follow the SRTM convention
    // (NLLLELLL.hgt[.zip]) - the sidecar's coord parser reads coords
    // straight out of the filename.  Returns the standard envelope plus
    // the produced .sdf name + url so the caller can confirm coverage.
    async convertSrtmHgt(name, bytes){
      if (!name)           return { available: false, error: 'name required' };
      if (bytes == null)   return { available: false, error: 'bytes required' };
      if (!/^[NSns]\d{2}[EWew]\d{3}\.(hgt|bil)(\.zip)?$/.test(name)){
        return { available: false, error: 'name must match NLLLELLL.(hgt|bil)[.zip]' };
      }
      const endpoint = joinUrl(baseUrl, `/api/v1/sdf/convert/srtm/${encodeURIComponent(name)}`);
      try {
        const r = await fetch(endpoint, {
          method:  'POST',
          headers: _headers({ 'content-type': 'application/octet-stream' }),
          body:    bytes,
          signal:  AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    // ------------------------------------------------------------------
    // Run-output artifact retrieval.  Maps to chelstein/splat#10 endpoints.
    // ------------------------------------------------------------------

    async listArtifacts(){
      const endpoint = joinUrl(baseUrl, '/api/v1/artifacts');
      try {
        const r = await fetch(endpoint, {
          headers: _headers(),
          signal:  AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    async getArtifact(path){
      if (!path) return { available: false, error: 'path required' };
      const safePath = path.split('/').map(encodeURIComponent).join('/');
      const endpoint = joinUrl(baseUrl, `/api/v1/artifacts/${safePath}`);
      try {
        const r = await fetch(endpoint, {
          headers: _headers(),
          signal:  AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
        });
        if (!r.ok){
          if (r.status === 404) return { available: false, endpoint, status: 404, error: 'not found' };
          return { available: false, endpoint, status: r.status, error: `HTTP ${r.status}` };
        }
        const buf = await r.arrayBuffer();
        return {
          available:    true,
          endpoint,
          path,
          bytes:        new Uint8Array(buf),
          size_bytes:   buf.byteLength,
          content_type: r.headers.get('content-type') || null,
          fetched_at:   new Date().toISOString()
        };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    // ------------------------------------------------------------------
    // Capability probe.  Now reads /version AND /api/v1/sdf so the
    // returned record carries a real dem_provisioned flag instead of
    // null-as-undefined.
    // ------------------------------------------------------------------

    async capability(){
      const v = await this.version();
      if (!v.reachable){
        return {
          available: false,
          source:    null,
          reachable: false,
          error:     v.error || `sidecar unreachable (HTTP ${v.status})`
        };
      }

      // SDF probe.  When this fails (auth wall, 5xx, network), leave
      // tile_count and dem_provisioned as null - we do not silently
      // claim DEM is provisioned.
      let tile_count      = null;
      let dem_provisioned = null;
      const sdfList = await this.listSdfTiles();
      if (sdfList.available && Number.isFinite(Number(sdfList.count))){
        tile_count      = Number(sdfList.count);
        dem_provisioned = tile_count > 0;
      }

      return {
        available:        true,
        source:           'splat-sidecar',
        reachable:        true,
        endpoint:         joinUrl(baseUrl, '/version'),
        sidecar_name:     v.sidecar       || 'genoa-splat-sidecar',
        splat_bin:        v.splat_bin     || null,
        splat_version:    v.splat_version || null,
        git_commit_sha:   v.git_commit_sha || null,
        build_time:       v.build_time    || null,
        workdir:          v.workdir       || null,
        sdf_dir:          v.sdf_dir       || null,
        auth_required:    !!v.auth_required,
        auth_configured:  _token !== null,
        tile_count,
        dem_provisioned,
        notes: dem_provisioned
          ? `SPLAT sidecar reachable with ${tile_count} terrain tile(s).  Coverage runs may use Longley-Rice ITM with terrain-aware HAAT.`
          : (tile_count === 0
              ? 'SPLAT sidecar reachable but no terrain tiles provisioned.  Upload tiles via uploadSdfTile() before requesting terrain-aware coverage.'
              : 'SPLAT sidecar reachable; tile inventory could not be probed (auth failure or transient error).  dem_provisioned is unknown.')
      };
    }
  };
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}
