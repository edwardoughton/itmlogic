// DigitalOcean Inference Router client (OpenAI-compatible).
//
// Routes to the operator's `router:zerotrust` policy, which auto-selects
// a model per task (fcc-rule-analysis, engineering-exhibit-validation,
// eas-ipaws-validation, sdr-rf-anomaly-analysis, …) with cost-aware
// escalation to advanced reasoning models on complexity.  Genoa uses it
// for ADVISORY grounded-reasoning passes only — it never gates or
// modifies contour distances, §73.x compliance determinations, or any
// deterministic engine output.
//
// Credentials come from env, never source:
//   MODEL_ACCESS_KEY      DO model-access key (doo_v1_…)
//   INFERENCE_ROUTER_URL  base, default https://inference.do-ai.run/v1
//   AI_ROUTER_MODEL       default router:zerotrust
//
// When MODEL_ACCESS_KEY is unset the client is a no-op (available:false),
// so local/test/offline runs make no network calls and the advisory
// layer simply doesn't render.

const DEFAULT_BASE  = 'https://inference.do-ai.run/v1';
const DEFAULT_MODEL = 'router:zerotrust';
const DEFAULT_TIMEOUT_MS = 60_000;

export function isEnabled(){
  return !!String(process.env.MODEL_ACCESS_KEY || '').trim();
}

// Single completion.  Returns { available, model, content } or
// { available:false, reason } — never throws into the caller's path.
export async function complete({ system, user, maxTokens = 700, temperature = 0, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  const key = String(process.env.MODEL_ACCESS_KEY || '').trim();
  if (!key) return { available: false, reason: 'MODEL_ACCESS_KEY unset' };
  if (!user) return { available: false, reason: 'no user prompt' };

  const base  = String(process.env.INFERENCE_ROUTER_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const model = String(process.env.AI_ROUTER_MODEL || DEFAULT_MODEL);
  const url   = `${base}/chat/completions`;
  const messages = [];
  if (system) messages.push({ role: 'system', content: String(system) });
  messages.push({ role: 'user', content: String(user) });

  const fetchFn = (typeof fetch === 'function') ? fetch : null;
  if (!fetchFn) return { available: false, reason: 'fetch unavailable' };

  try {
    const r = await fetchFn(url, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, max_tokens: maxTokens, temperature, messages }),
      signal:  AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok){
      const body = await r.text().catch(() => '');
      return { available: false, reason: `HTTP ${r.status}`, detail: body.slice(0, 200) };
    }
    const j = await r.json();
    const choice  = Array.isArray(j?.choices) ? j.choices[0] : null;
    const content = choice?.message?.content || '';
    return {
      available:    !!content,
      model:        j?.model || model,
      content,
      usage:        j?.usage || null
    };
  } catch (e){
    return { available: false, reason: String(e?.message || e) };
  }
}

export { DEFAULT_BASE, DEFAULT_MODEL };
