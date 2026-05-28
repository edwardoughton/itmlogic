// DO knowledge-base retrieval client (knowledge-base-05282026, 677cd4af).
//
// Mirrors fccKb.js exactly, but for the DO-hosted RF-engineering KB.
// Credentials from env, never source:
//   DO_KB_URL    kbaas retrieve endpoint
//                (…/v1/677cd4af-5ad3-11f1-b074-4e013e2ddde4/retrieve)
//   DO_KB_TOKEN  a DigitalOcean API PAT (NOT the router MODEL_ACCESS_KEY —
//                the kbaas retrieve endpoint 403s with a model-access key;
//                it authorizes with a DO account PAT).  A PAT is full-
//                account scope, so prefer the OpenSearch-direct backend
//                from inside the VPC where a scoped credential exists.
//
// Degrades to { available:false } when unset/unauthorized.

import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 20_000;

export function isEnabled(){
  return kbaasEnabled() || openSearchEnabled();
}
function kbaasEnabled(){
  return !!(String(process.env.DO_KB_URL || '').trim() && String(process.env.DO_KB_TOKEN || '').trim());
}
function openSearchEnabled(){
  return !!(String(process.env.DO_KB_OS_HOST || '').trim() && String(process.env.DO_KB_OS_PASS || '').trim());
}

export function pickKbIndex(indexNames, kbIdFragment){
  const names = (indexNames || []).filter(n => n && !String(n).startsWith('.'));
  if (!names.length) return null;
  if (kbIdFragment){
    const byId = names.find(n => n.includes(kbIdFragment));
    if (byId) return byId;
  }
  return names.find(n => /kb|knowledge|chunk|doc|embed/i.test(n)) || names[0];
}

export function hitsToChunks(searchJson, indexName){
  const hits = searchJson?.hits?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.map(h => {
    const s = h?._source || {};
    const text = s.content || s.text || s.chunk || s.body || s.passage || s.page_content || '';
    return { text: String(text || '').trim(), score: h?._score ?? null, source: indexName || null };
  }).filter(c => c.text);
}

function osRequest(method, path, body, timeoutMs){
  return new Promise((resolve, reject) => {
    const host = String(process.env.DO_KB_OS_HOST || '').trim();
    const port = Number(process.env.DO_KB_OS_PORT) || 25060;
    const user = String(process.env.DO_KB_OS_USER || 'doadmin').trim();
    const pass = String(process.env.DO_KB_OS_PASS || '').trim();
    const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host, port, path, method,
      headers: { Authorization: auth, 'Content-Type': 'application/json',
                 ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      rejectUnauthorized: false,
      timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
    }, res => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }); }
        catch { resolve({ status: res.statusCode, json: null, raw: buf }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('opensearch timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function retrieveViaOpenSearch(query, { k = 4, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  try {
    const cat = await osRequest('GET', '/_cat/indices?format=json&h=index', null, timeoutMs);
    const names = Array.isArray(cat.json) ? cat.json.map(r => r.index) : [];
    const index = pickKbIndex(names, '677cd4af');
    if (!index) return { available: false, reason: 'no KB index found', chunks: [] };
    const res = await osRequest('POST', `/${encodeURIComponent(index)}/_search`, {
      size: k,
      query: { simple_query_string: { query: String(query), fields: ['*'], default_operator: 'or' } }
    }, timeoutMs);
    const chunks = hitsToChunks(res.json, index);
    return { available: chunks.length > 0, chunks, index, backend: 'opensearch' };
  } catch (e){
    return { available: false, reason: String(e?.message || e), chunks: [] };
  }
}

export async function retrieve(query, { k = 4, alpha = 0.75, filters = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  if (!query) return { available: false, reason: 'no query', chunks: [] };
  const url   = String(process.env.DO_KB_URL || '').trim();
  const token = String(process.env.DO_KB_TOKEN || '').trim();
  if (!(url && token)){
    if (openSearchEnabled()) return retrieveViaOpenSearch(query, { k, timeoutMs });
    return { available: false, reason: 'no KB backend configured (need DO_KB_URL+DO_KB_TOKEN or DO_KB_OS_*)', chunks: [] };
  }
  const fetchFn = (typeof fetch === 'function') ? fetch : null;
  if (!fetchFn) return { available: false, reason: 'fetch unavailable', chunks: [] };

  const payload = { query: String(query), num_results: k, alpha };
  if (filters) payload.filters = filters;

  try {
    const r = await fetchFn(url, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok){
      const body = await r.text().catch(() => '');
      return { available: false, reason: `HTTP ${r.status}`, detail: body.slice(0, 160), chunks: [] };
    }
    const j = await r.json();
    const raw = j?.results || j?.data || j?.retrieved_chunks || j?.chunks || [];
    const chunks = (Array.isArray(raw) ? raw : []).map(c => ({
      text:   c?.text_content || c?.text || c?.content || c?.chunk || c?.page_content
                || c?.document_chunk || (typeof c === 'string' ? c : ''),
      score:  c?.score ?? c?.relevance ?? c?.distance ?? null,
      source: c?.source || c?.document || c?.metadata?.source
                || c?.metadata?.item_name || c?.index_name || null
    })).filter(c => c.text);
    return { available: chunks.length > 0, chunks };
  } catch (e){
    return { available: false, reason: String(e?.message || e), chunks: [] };
  }
}
