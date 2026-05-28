// readJsonOrThrow — safe JSON parser for fetch responses.
//
// Production crash:
//   "Save failed: Unexpected token '<', '<!DOCTYPE '... is not valid JSON"
//
// Cause: response.json() crashes when the server returns HTML (App
// Platform error page, static-app fallback, proxy 502, etc).  This
// helper checks Content-Type and HTTP status BEFORE parsing and turns
// every failure mode into a structured Error with a useful message.
//
// Usage:
//   const j = await readJsonOrThrow(await fetch(url));
//
// Throws:
//   Error('HTTP 503: <truncated body>')             — non-2xx response
//   Error('Expected JSON but got text/html: <body>') — wrong content-type
//   SyntaxError                                       — body claimed JSON but was malformed

export async function readJsonOrThrow(response){
  const text        = await response.text();
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (!response.ok){
    // Try to parse as JSON one more time in case the API returned a
    // structured error with a non-2xx code; fall back to truncated text.
    if (contentType.includes('application/json')){
      try {
        const j = JSON.parse(text);
        const msg = j.message || j.error || JSON.stringify(j).slice(0, 300);
        const err = new Error(`HTTP ${response.status}: ${msg}`);
        err.body   = j;
        err.status = response.status;
        throw err;
      } catch (e){
        if (e instanceof SyntaxError){ /* fall through to text */ }
        else throw e;
      }
    }
    const err = new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    err.status = response.status;
    err.body   = text;
    throw err;
  }

  if (!contentType.includes('application/json')){
    const err = new Error(`Expected JSON but got ${contentType || 'unknown content-type'}: ${text.slice(0, 300)}`);
    err.status       = response.status;
    err.content_type = contentType;
    err.body         = text;
    throw err;
  }

  return JSON.parse(text);
}
