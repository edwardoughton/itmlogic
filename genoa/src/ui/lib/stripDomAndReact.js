// stripDomAndReact — defensive sanitizer.
//
// React SyntheticEvent objects (and DOM nodes) have circular structures
// that crash JSON.stringify with:
//
//   "Converting circular structure to JSON
//    starting at object with constructor 'HTMLButtonElement'"
//
// The proper fix is "always wrap handlers as () => fn()" — never pass
// a bare function reference into onClick.  This sanitizer is the
// belt-and-suspenders pass: even if a future handler regresses, the
// payload going into the API will be event-free.

export function stripDomAndReact(value){
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  // Browser DOM events / nodes — strip entirely.
  if (typeof Event !== 'undefined' && value instanceof Event)             return undefined;
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return undefined;
  if (typeof Node !== 'undefined' && value instanceof Node)               return undefined;
  // React SyntheticEvent shape (also covers Preact, Solid, etc).
  if (value.nativeEvent || value.currentTarget || value.target || value._reactName) return undefined;

  if (Array.isArray(value)){
    return value.map(stripDomAndReact).filter(v => v !== undefined);
  }

  const out = {};
  for (const [k, v] of Object.entries(value)){
    if (k.startsWith('__react')
        || k === 'target'
        || k === 'currentTarget'
        || k === 'nativeEvent'
        || k === 'view'
        || k === 'srcElement') continue;
    const cleaned = stripDomAndReact(v);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out;
}
