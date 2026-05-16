// Genoa NEC sidecar — antenna / tower modeling via NEC2++ + PyNEC.
//
// LICENSE BOUNDARY (CRITICAL)
//   NEC2++ (https://github.com/tmolteno/necpp) is GPL v2.  Genoa
//   itself is NOT GPL.  The license boundary is enforced by isolating
//   NEC2++ inside this separate HTTP sidecar process; Genoa never
//   links, imports, or statically embeds NEC2++.  The genoa-api
//   process talks to this sidecar over HTTP and treats every result
//   as external evidence with a `license_boundary: "external sidecar"`
//   provenance stamp.
//
//   This file (the Node sidecar) does NOT import any GPL'd code.  It
//   spawns a child Python process (nec_bridge.py) which DOES import
//   PyNEC.  The Python bridge is also part of the GPL-isolated
//   sidecar — nothing in src/ outside of sidecars/nec/* is allowed
//   to import or link NEC2++ / PyNEC.
//
// REGULATORY USE
//   47 CFR §73.62  / §73.150 — directional AM RTA (radiation
//                                theoretical analysis)
//   47 CFR §73.45  — MEOV monitor-point fields
//   47 CFR §1.1310 / OET-65 — near-field RF exposure for AM towers
//                              where far-field formulas are invalid
//                              within λ/(2π)
//
// HTTP API
//   GET  /health             → 200 { ok, pynec_available, version }
//   POST /model/run          → run an arbitrary wire-segment model
//   POST /model/am-array     → convenience: generate vertical-tower
//                               array from a high-level spec then run
//   POST /model/near-field   → convenience: existing model + extra
//                               near-field probe points
//
// REQUEST SHAPE  (POST /model/run)
//   {
//     "frequency_mhz": 1.0,
//     "ground": {
//       "type": "pec" | "sommerfeld" | "free_space",
//       "conductivity_s_m": 0.005,
//       "dielectric_constant": 13
//     },
//     "wires": [
//       { "tag": 1, "segments": 21,
//         "x1": 0, "y1": 0, "z1": 0,
//         "x2": 0, "y2": 0, "z2": 75,
//         "radius_m": 0.25 }
//     ],
//     "excitations": [
//       { "tag": 1, "segment": 1, "voltage_real": 1, "voltage_imag": 0 }
//     ],
//     "loads": [
//       { "tag": 1, "segment": 5, "type": "series_RLC",
//         "r_ohm": 0, "l_h": 0, "c_f": 0 }
//     ],
//     "pattern": {
//       "theta_start": 90, "theta_stop": 90, "theta_step": 1,
//       "phi_start": 0,    "phi_stop":   359, "phi_step":  1
//     },
//     "near_field": {
//       "enabled": true,
//       "points": [{ "x": 10, "y": 0, "z": 2 }]
//     }
//   }
//
// RESPONSE SHAPE
//   {
//     "ok": true,
//     "model_valid": true,
//     "frequency_mhz": 1.0,
//     "geometry": { "n_wires": 1, "total_length_m": 75, "n_segments": 21 },
//     "feedpoint": { "r_ohm": 36.5, "x_ohm": 21.4, "vswr_50": 1.43 },
//     "pattern": {
//       "theta_deg": [...], "phi_deg": [...],
//       "gain_dbi":  [[...]]                  // [theta][phi]
//     },
//     "near_field": [
//       { "x": 10, "y": 0, "z": 2, "e_v_m": 12.3, "h_a_m": 0.04, "s_mw_cm2": 0.2 }
//     ],
//     "warnings":   ["..."],
//     "provenance": {
//       "engine":           "necpp/PyNEC",
//       "source":           "NEC2++ sidecar",
//       "license_boundary": "external sidecar",
//       "generated_at":     "2026-...",
//       "model_hash":       "<sha256 of input model>"
//     }
//   }
//
// SAFETY
//   - Hard timeout per request (env BRIDGE_TIMEOUT_MS, default 60_000).
//   - No raw stderr to client; sanitized to a `detail` string capped at
//     600 characters.
//   - JSON-only responses; never streams stdout/stderr verbatim.
//   - The Python bridge does NO network calls.  It reads stdin, runs
//     PyNEC locally, writes stdout.

import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT             = parseInt(process.env.SIDECAR_PORT || process.env.PORT || '8085', 10);
const PYTHON_BIN       = process.env.PYNEC_PYTHON_BIN || 'python3';
const BRIDGE           = path.join(__dirname, 'nec_bridge.py');
const BRIDGE_TIMEOUT_MS = parseInt(process.env.BRIDGE_TIMEOUT_MS || '60000', 10);
const VERSION          = '0.1.0';

const app = express();
app.use(express.json({ limit: '4mb' }));
app.disable('x-powered-by');

// -------------------- /health --------------------
//
// Always returns 200 (so liveness probes don't fail when PyNEC isn't
// installed).  pynec_available is the actionable bit for operators.
app.get('/health', async (_req, res) => {
  let pynec_available = false;
  let pynec_version   = null;
  let pynec_error     = null;
  try {
    const out = await runBridge('--probe', '', 5000);
    if (out.code === 0){
      try {
        const j = JSON.parse(out.stdout);
        pynec_available = !!j.pynec_available;
        pynec_version   = j.pynec_version || null;
        pynec_error     = j.error || null;
      } catch { pynec_error = 'bridge probe JSON parse failed'; }
    } else {
      pynec_error = (out.stderr || '').slice(0, 200) || `bridge exit ${out.code}`;
    }
  } catch (e){ pynec_error = String(e.message); }

  res.json({
    ok:                true,
    sidecar:           { name: 'genoa-nec-sidecar', version: VERSION },
    backend:           'necpp/PyNEC',
    license_boundary:  'external sidecar (NEC2++ is GPL v2)',
    pynec_available,
    pynec_version,
    pynec_error,
    bridge_timeout_ms: BRIDGE_TIMEOUT_MS
  });
});

// -------------------- /model/run --------------------

app.post('/model/run', asyncHandler(async (req, res) => {
  const body = validateModel(req.body);
  if (body.error) return res.status(400).json({ ok: false, ...body });
  const result = await runModel(body.model);
  res.status(result.ok ? 200 : 502).json(result);
}));

// -------------------- /model/am-array --------------------
//
// Convenience endpoint: build a vertical-tower AM directional array
// from a high-level spec (tower heights, drive currents, locations)
// and run it.  This is the typical §73.62 / §73.150 RTA case.
//
// Input:
//   {
//     "frequency_khz": 1240,
//     "ground": { ... },
//     "towers": [
//       { "tag": 1, "x_m": 0,   "y_m": 0,   "height_m": 75, "radius_m": 0.25,
//         "segments": 21, "drive": { "amplitude": 1.0, "phase_deg": 0 } },
//       { "tag": 2, "x_m": 100, "y_m": 0,   "height_m": 75, "radius_m": 0.25,
//         "segments": 21, "drive": { "amplitude": 1.0, "phase_deg": 90 } }
//     ],
//     "pattern": { ... },
//     "near_field": { ... }
//   }
app.post('/model/am-array', asyncHandler(async (req, res) => {
  const built = buildAmArrayModel(req.body || {});
  if (built.error) return res.status(400).json({ ok: false, ...built });
  const result = await runModel(built.model);
  res.status(result.ok ? 200 : 502).json(result);
}));

// -------------------- /model/near-field --------------------
//
// Convenience: take an existing model + add additional near-field
// probe points (e.g. monitor-point coordinates) and run.
app.post('/model/near-field', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.model){
    return res.status(400).json({ ok: false, error: 'INVALID_INPUT', detail: 'body.model required' });
  }
  const m = { ...body.model };
  m.near_field = { enabled: true,
                   points: [...(m.near_field?.points || []), ...(body.points || [])] };
  const validated = validateModel(m);
  if (validated.error) return res.status(400).json({ ok: false, ...validated });
  const result = await runModel(validated.model);
  res.status(result.ok ? 200 : 502).json(result);
}));

// -------------------- helpers --------------------

function asyncHandler(fn){
  return (req, res, next) => Promise.resolve(fn(req, res, next))
    .catch(err => {
      // Sanitize errors — no stack traces, no DSNs, no env values.
      res.status(500).json({
        ok:     false,
        error:  'NEC_SIDECAR_ERROR',
        detail: String(err && err.message || err).slice(0, 600)
      });
    });
}

function validateModel(input){
  const m = input || {};
  if (!Number.isFinite(Number(m.frequency_mhz)))
    return { error: 'INVALID_INPUT', detail: 'frequency_mhz required (number)' };
  if (!Array.isArray(m.wires) || m.wires.length === 0)
    return { error: 'INVALID_INPUT', detail: 'wires required (non-empty array)' };
  for (const w of m.wires){
    for (const k of ['tag', 'segments', 'x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'radius_m']){
      if (!Number.isFinite(Number(w[k])))
        return { error: 'INVALID_INPUT', detail: `wire.${k} required (number) on tag ${w.tag}` };
    }
  }
  if (!Array.isArray(m.excitations) || m.excitations.length === 0)
    return { error: 'INVALID_INPUT', detail: 'excitations required (non-empty array)' };
  return { model: m };
}

function buildAmArrayModel(spec){
  if (!Number.isFinite(Number(spec.frequency_khz)))
    return { error: 'INVALID_INPUT', detail: 'frequency_khz required' };
  if (!Array.isArray(spec.towers) || !spec.towers.length)
    return { error: 'INVALID_INPUT', detail: 'towers required (non-empty array)' };

  const wires       = [];
  const excitations = [];
  for (const t of spec.towers){
    const tag = Number(t.tag);
    wires.push({
      tag,
      segments: Number(t.segments) || 21,
      x1: Number(t.x_m) || 0, y1: Number(t.y_m) || 0, z1: 0,
      x2: Number(t.x_m) || 0, y2: Number(t.y_m) || 0, z2: Number(t.height_m),
      radius_m: Number(t.radius_m) || 0.25
    });
    const amp_v = Number(t.drive?.amplitude) || 1.0;
    const ph    = (Number(t.drive?.phase_deg) || 0) * Math.PI / 180;
    excitations.push({
      tag,
      segment:        1,                       // base segment (first along the wire)
      voltage_real:   amp_v * Math.cos(ph),
      voltage_imag:   amp_v * Math.sin(ph)
    });
  }
  return {
    model: {
      frequency_mhz: Number(spec.frequency_khz) / 1000,
      ground:        spec.ground   || { type: 'sommerfeld', conductivity_s_m: 0.005, dielectric_constant: 13 },
      wires, excitations,
      pattern:       spec.pattern    || { theta_start: 90, theta_stop: 90, theta_step: 1,
                                           phi_start: 0,   phi_stop: 359,  phi_step: 1 },
      near_field:    spec.near_field || { enabled: false, points: [] }
    }
  };
}

async function runModel(model){
  const model_hash = sha256(JSON.stringify(canonicalize(model)));
  const t0 = Date.now();
  const r  = await runBridge('', JSON.stringify(model), BRIDGE_TIMEOUT_MS);
  const runtime_seconds = (Date.now() - t0) / 1000;

  if (r.code === 124 || r.timed_out){
    return {
      ok:       false,
      error:    'NEC_BRIDGE_TIMEOUT',
      detail:   `Python bridge exceeded BRIDGE_TIMEOUT_MS=${BRIDGE_TIMEOUT_MS}`,
      runtime_seconds
    };
  }
  if (r.code !== 0){
    return {
      ok:       false,
      error:    'NEC_BRIDGE_FAILED',
      detail:   (r.stderr || '').trim().slice(0, 600),
      runtime_seconds
    };
  }
  let parsed;
  try { parsed = JSON.parse(r.stdout); }
  catch (e){
    return {
      ok:        false,
      error:     'NEC_BRIDGE_PARSE_FAILED',
      detail:    String(e.message),
      runtime_seconds
    };
  }
  if (parsed.ok === false){
    return { ...parsed, runtime_seconds };
  }
  return {
    ok:           true,
    runtime_seconds,
    ...parsed,
    provenance: {
      engine:           'necpp/PyNEC',
      source:           'NEC2++ sidecar',
      license_boundary: 'external sidecar',
      sidecar_version:  VERSION,
      generated_at:     new Date().toISOString(),
      model_hash
    }
  };
}

function runBridge(probeFlag, stdinText, timeoutMs){
  return new Promise((resolve) => {
    const args = probeFlag ? [BRIDGE, probeFlag] : [BRIDGE];
    const ch   = spawn(PYTHON_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out_chunks = [];
    const err_chunks = [];
    ch.stdout.on('data', (c) => out_chunks.push(c));
    ch.stderr.on('data', (c) => err_chunks.push(c));
    let timed_out = false;
    const t = setTimeout(() => { timed_out = true; ch.kill('SIGKILL'); }, timeoutMs);
    ch.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, timed_out,
                stdout: Buffer.concat(out_chunks).toString('utf8'),
                stderr: Buffer.concat(err_chunks).toString('utf8') });
    });
    ch.on('error', (err) => {
      clearTimeout(t);
      resolve({ code: -1, timed_out: false, stdout: '', stderr: String(err.message || err) });
    });
    if (stdinText) ch.stdin.write(stdinText);
    ch.stdin.end();
  });
}

function sha256(s){ return crypto.createHash('sha256').update(s).digest('hex'); }

function canonicalize(obj){
  // Stable JSON for hash — sort keys at every level.
  if (Array.isArray(obj)) return obj.map(canonicalize);
  if (obj && typeof obj === 'object'){
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = canonicalize(obj[k]);
    return out;
  }
  return obj;
}

app.listen(PORT, '0.0.0.0', () =>
  console.log(`[genoa-nec-sidecar] v${VERSION} listening on 0.0.0.0:${PORT} python=${PYTHON_BIN} bridge=${BRIDGE}`));
