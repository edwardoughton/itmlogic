// Genoa identity sidecar — THIN ADAPTER.
//
// Wraps:
//   - chelstein/massdns        (RadioDNS resolution)
//   - chelstein/EAS-Tools      (EAS / SAME identity)
//   - chelstein/zerotrustradio (read-only facility metadata)
//
// Resolves station identity by calling these upstream tools and
// normalizing their results into Genoa's identity-evidence shape.
// This sidecar must NOT reimplement RDS / RadioDNS / EAS logic.
//
// Endpoints:
//   GET  /health                -> 200 "ok"
//   GET  /version               -> { sidecar, upstream_tools }
//   POST /v1/identity/resolve   -> { available, sources[], confirmations[] }

import express from 'express';

const PORT = parseInt(process.env.SIDECAR_PORT || process.env.PORT || '8083', 10);
const VERSION = '0.1.0';

const RADIODNS_RESOLVER_URL = process.env.RADIODNS_RESOLVER_URL || null;
const MASSDNS_RESOLVER_URL  = process.env.MASSDNS_RESOLVER_URL  || null;
const EAS_TOOLS_URL         = process.env.EAS_TOOLS_URL         || null;
const ZTR_READONLY_URL      = process.env.ZERO_TRUST_RADIO_READONLY_URL || null;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.disable('x-powered-by');

app.get('/health',  (_req, res) => res.type('text').send('ok'));
app.get('/version', (_req, res) => res.json({
  sidecar: { name: 'genoa-identity-sidecar', version: VERSION },
  upstream_tools: {
    'chelstein/massdns':        { url: MASSDNS_RESOLVER_URL,  available: !!MASSDNS_RESOLVER_URL,  role: 'RadioDNS resolution' },
    'chelstein/EAS-Tools':      { url: EAS_TOOLS_URL,         available: !!EAS_TOOLS_URL,         role: 'EAS / SAME / audio fingerprint' },
    'chelstein/zerotrustradio': { url: ZTR_READONLY_URL,      available: !!ZTR_READONLY_URL,      role: 'read-only facility metadata' }
  },
  notes: 'This sidecar is an adapter, not a new implementation. It calls upstream chelstein/* tools and normalizes their JSON for the genoa engine.'
}));

app.post('/v1/identity/resolve', async (req, res) => {
  const b = req.body || {};
  const sources = [];
  const confirmations = [];

  sources.push(await callRadioDns(b));
  sources.push(await callEasTools(b));
  sources.push({ kind: 'rds',      status: 'unavailable', detail: 'wire to a fielded RDS scan output (PI/PS/PTY) — not in scope of identity sidecar' });
  sources.push({ kind: 'audio_fp', status: 'unavailable', detail: 'audio fingerprint via chelstein/EAS-Tools is the upstream; not yet wired' });

  for (const s of sources){
    if (s.status === 'confirmed' || s.status === 'mismatch') confirmations.push(s);
  }

  res.json({
    available:    confirmations.length > 0,
    requested_at: new Date().toISOString(),
    sources,
    confirmations
  });
});

async function callRadioDns(b){
  const url = RADIODNS_RESOLVER_URL || MASSDNS_RESOLVER_URL;
  if (!url){
    return { kind: 'radiodns', status: 'unavailable', detail: 'RADIODNS_RESOLVER_URL / MASSDNS_RESOLVER_URL not configured (chelstein/massdns)' };
  }
  return { kind: 'radiodns', status: 'unavailable', detail: `would call ${url}; upstream chelstein/massdns wiring is a TODO`, fqdn: radioDnsFqdn(b) };
}

async function callEasTools(b){
  if (!EAS_TOOLS_URL){
    return { kind: 'eas_same', status: 'unavailable', detail: 'EAS_TOOLS_URL not configured (chelstein/EAS-Tools)' };
  }
  return { kind: 'eas_same', status: 'unavailable', detail: `would call ${EAS_TOOLS_URL}; upstream chelstein/EAS-Tools wiring is a TODO` };
}

function radioDnsFqdn({ frequency, frequency_unit, gcc, pi }){
  const f = Number(frequency);
  if (!Number.isFinite(f)) return null;
  return (frequency_unit === 'kHz')
    ? `am/${gcc || 'us'}.${pi || '0000'}.${Math.round(f)}.radiodns.org`
    : `fm/${gcc || 'us'}.${pi || '0000'}.${Math.round(f * 100)}.radiodns.org`;
}

app.listen(PORT, '0.0.0.0', () => console.log(`[genoa-identity-sidecar] listening on 0.0.0.0:${PORT} version=${VERSION}`));
