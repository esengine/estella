// Vitest setup for editor tests

// Fix TextEncoder cross-realm instanceof check in jsdom.
// jsdom provides its own globals from a separate realm, so
// Node's TextEncoder.encode() returns a Uint8Array that fails
// `instanceof Uint8Array` against jsdom's Uint8Array.
// esbuild-wasm checks this invariant at import time and throws.
const OriginalEncode = TextEncoder.prototype.encode;
TextEncoder.prototype.encode = function (input?: string) {
    return new Uint8Array(OriginalEncode.call(this, input)) as Uint8Array<ArrayBuffer>;
};
