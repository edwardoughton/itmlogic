// rfengineer agent client — ADVISORY ONLY.
//
// Talks to the DigitalOcean GenAI "rfengineer" agent (OpenAI-compatible
// chat-completions endpoint) which is grounded on the attached knowledge
// bases (FCC Part 73 + RF-engineering docs).  This is a probabilistic,
// RAG-grounded LLM — it is NOT part of the deterministic engine.
//
// HARD BOUNDARY (do not cross):
//   - This client NEVER produces filing values (contour distances,
//     margins, HAAT, field strengths) or a pass/fail / block-legacy-waiver
//     verdict.  Those come exclusively from the deterministic engine
//     (§73.x math, FCCAM, FCC LMS).  See src/engine/regulatory/context.js.
//   - Output is advisory prose + citations only, for the human engineer of
//     record.  The system prompt below enforces this; callers must also
//     treat the result as advisory and label it as such in the UI/report.
//
// CONFIG (server-side only; no secrets in the frontend or git):
//   RFENGINEER_AGENT_URL   base endpoint, e.g.
//                          https://xpo2v7dvymlx22rk43lh2nuz.agents.do-ai.run
//   RFENGINEER_AGENT_KEY   endpoint access key (Bearer).  When unset,
//                          isRfAgentConfigured() is false and every call
//                          returns { available:false } — the feature is a
//                          clean no-op until the operator wires the key.
//
// SERVICE CONTRACT (DigitalOcean GenAI agent, OpenAI-compatible):
//   POST {base}/api/v1/chat/completions
//     headers: Authorization: Bearer <KEY>, Content-Type: application/json
//     body: { messages:[{role,content}], stream:false,
//             include_retrieval_info:true, temperature, max_tokens }
//     → 200 { choices:[{ message:{ content } }],
//             retrieval?: { retrieved_data?:[{ ... }] }, ... }
//   The agent queries its own knowledge bases internally; we do NOT pass
//   the KB id, OpenSearch creds, or the /retrieve endpoint.

const DEFAULT_URL = 'https://xpo2v7dvymlx22rk43lh2nuz.agents.do-ai.run';
const DEFAULT_TIMEOUT_MS = 30_000;

// Baked-in guardrails prepended to every request.  Defense in depth: the
// agent's own instructions already scope it, but we re-assert the hard
// boundary on each call so a future agent-instruction change can't quietly
// let it emit values or verdicts.
const GUARDRAIL_SYSTEM = [
  'You are an ADVISORY RF-engineering narrative assistant operating inside a',
  'deterministic FCC filing tool.  Strict rules you must never break:',
  '1. NEVER output numeric engineering values (contour distances, field',
  '   strengths, HAAT, margins, spacings).  All numbers are supplied to you',
  '   as already-computed grounding; refer to them, never recompute or invent.',
  '2. NEVER state a pass/fail, compliant/non-compliant, or block/legacy/',
  '   waiver determination.  That verdict is made by the deterministic engine.',
  '3. Explain WHY — terrain confinement, shadowing, diffraction, conductivity,',
  '   clutter — and cite the controlling rule from your knowledge base.',
  '4. Conservative professional engineering language.  Separate filing-',
  '   controlling FCC requirements from advisory propagation observations.',
  '5. If grounding is insufficient, say what additional RF parameters are',
  '   required rather than speculating.'
].join('\n');

export function isRfAgentConfigured(){
  return !!process.env.RFENGINEER_AGENT_KEY;
}

function baseUrl(){
  return (process.env.RFENGINEER_AGENT_URL || DEFAULT_URL).replace(/\/+$/, '');
}

/**
 * Ask the rfengineer agent for advisory narrative grounded on supplied,
 * already-computed values.  Always resolves (never throws) — degrades to
 * { available:false } so it can never break the deterministic path.
 *
 * @param {object}  opts
 * @param {string}  opts.task         what prose to produce (e.g. a report
 *                                    section name + intent)
 * @param {object}  [opts.grounding]  deterministic values for the agent to
 *                                    reference (serialized into the prompt)
 * @param {number}  [opts.maxTokens]  default 700
 * @param {number}  [opts.temperature] default 0.2
 * @param {number}  [opts.timeoutMs]  default 30s
 * @returns {Promise<{available:boolean, text?:string,
 *                    citations?:Array, model?:string, error?:string}>}
 */
export async function askRfEngineer({
  task,
  grounding = null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!isRfAgentConfigured()){
    return { available: false, error: 'RFENGINEER_AGENT_KEY unset' };
  }
  if (!task || typeof task !== 'string'){
    return { available: false, error: 'task (string) required' };
  }

  // The DO agent rejects `system`/`developer` roles (its base instructions
  // are set in agent config), so our guardrails are prepended to the user
  // turn as explicit constraints.
  const groundingBlock = grounding
    ? '\n\nDeterministic grounding (reference only — do not recompute):\n' +
      '```json\n' + JSON.stringify(grounding, null, 2) + '\n```'
    : '';
  const userContent =
    `${GUARDRAIL_SYSTEM}\n\n--- TASK ---\n${task}${groundingBlock}`;

  // The agent is backed by an Anthropic model with extended thinking
  // enabled, which rejects `temperature`/`top_p` != 1 and requires
  // max_tokens > thinking budget.  We therefore send neither — the agent
  // applies its own configured sampling + token limits.  Citations are
  // returned natively when the agent's "Include citations" is on.
  const body = {
    messages: [
      { role: 'user', content: userContent }
    ],
    stream: false
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}/api/v1/chat/completions`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RFENGINEER_AGENT_KEY}`,
        'Content-Type':  'application/json'
      },
      body:   JSON.stringify(body),
      signal: ac.signal
    });
    if (!res.ok){
      const detail = await res.text().catch(() => '');
      return { available: false, error: `agent ${res.status}`, detail: detail.slice(0, 500) };
    }
    const json = await res.json().catch(() => null);
    const text = json?.choices?.[0]?.message?.content || '';
    if (!text){
      return { available: false, error: 'agent returned empty content', raw: json };
    }
    return {
      available: true,
      text,
      citations: extractCitations(json),
      model:     json?.model || null
    };
  } catch (err){
    return { available: false, error: err?.name === 'AbortError' ? 'agent timeout' : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

// DO returns retrieval grounding under a few shapes depending on version;
// parse defensively and return [] when absent rather than asserting a shape.
function extractCitations(json){
  const r = json?.citations || json?.retrieval || json?.choices?.[0]?.message?.retrieval || null;
  const rows = r?.citations || r?.retrieved_data || r?.documents || (Array.isArray(r) ? r : []);
  if (!Array.isArray(rows)) return [];
  return rows.map((d) => ({
    source:  d?.source || d?.title || d?.document_name || d?.filename || null,
    snippet: (d?.text || d?.content || d?.chunk || '').slice(0, 280) || null,
    score:   typeof d?.score === 'number' ? d.score : null
  })).filter((c) => c.source || c.snippet);
}
