// Knowledge-base retrieval client — ADVISORY GROUNDING ONLY.
//
// Talks to the DigitalOcean GenAI knowledge-base retrieve endpoint
// (kbaas.do-ai.run/v1/<kb_id>/retrieve).  Unlike the rfengineer agent,
// this performs NO LLM generation — it returns the matching source-document
// chunks with relevance scores.  That makes it the preferred grounding
// source: it surfaces authoritative rule text the engineer can verify,
// with nothing for a model to invent.
//
// BOUNDARY: retrieved text is reference/citation material for the human
// engineer of record.  It NEVER changes a deterministic value or verdict.
//
// CONFIG (server-side only; no secrets in the frontend or git):
//   RFENGINEER_KB_RETRIEVE_URL   full retrieve URL (includes the KB id)
//                                defaults to 677cd4af (knowledge-base-05282026)
//   RFENGINEER_KB_KEY            access key (Bearer).  When unset,
//                                isKbRetrieveConfigured() is false and every
//                                call returns { available:false } — clean
//                                no-op until the operator wires the key.

const DEFAULT_URL =
  'https://kbaas.do-ai.run/v1/677cd4af-5ad3-11f1-b074-4e013e2ddde4/retrieve';
const DEFAULT_TIMEOUT_MS = 20_000;

export function isKbRetrieveConfigured(){
  return !!process.env.RFENGINEER_KB_KEY;
}

function retrieveUrl(){
  return (process.env.RFENGINEER_KB_RETRIEVE_URL || DEFAULT_URL).trim();
}

export async function retrieveFromKb({ query, k = 6, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  if (!isKbRetrieveConfigured()){
    return { available: false, error: 'RFENGINEER_KB_KEY unset' };
  }
  if (!query || typeof query !== 'string'){
    return { available: false, error: 'query (string) required' };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(retrieveUrl(), {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RFENGINEER_KB_KEY}`,
        'Content-Type':  'application/json'
      },
      body:   JSON.stringify({ query, k }),
      signal: ac.signal
    });
    if (!res.ok){
      const detail = await res.text().catch(() => '');
      return { available: false, error: `kb ${res.status}`, detail: detail.slice(0, 500) };
    }
    const json = await res.json().catch(() => null);
    const chunks = extractChunks(json);
    return { available: true, chunks };
  } catch (err){
    return { available: false, error: err?.name === 'AbortError' ? 'kb timeout' : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function extractChunks(json){
  const rows = json?.retrieved_data
            || json?.results
            || json?.documents
            || json?.data
            || [];
  if (!Array.isArray(rows)) return [];
  return rows.map((d) => ({
    source:  d?.filename || d?.source || d?.title || d?.document_name || null,
    text:    (d?.content || d?.text || d?.chunk || '').slice(0, 1200) || null,
    score:   typeof d?.score === 'number' ? d.score : null
  })).filter((c) => c.text || c.source);
}
