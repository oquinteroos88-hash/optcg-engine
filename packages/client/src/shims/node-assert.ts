// Browser shim for `node:assert`, aliased in vite.config.ts.
//
// The engine barrel exports assertSerializationRoundTrip, whose module imports
// `node:assert` at top level. The client never calls it, but without this shim
// Vite externalizes the builtin and the whole engine module fails to load in
// the browser.
export function deepStrictEqual(): never {
  throw new Error('node:assert is not available in the browser build');
}

export default { deepStrictEqual };
