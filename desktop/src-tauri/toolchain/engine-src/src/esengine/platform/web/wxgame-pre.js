// Emscripten extern-pre-js for WeChat MiniGame
// Provides minimal browser globals that -sENVIRONMENT=web assumes exist.
// Injected OUTSIDE the module IIFE, so these are available at module evaluation time.
//
// IMPORTANT: Keep this minimal. Only provide what Emscripten's module-level
// code needs (specialHTMLTargets references document/window). Do NOT provide
// createElement/body/etc — SDK code uses their absence to detect non-browser
// environments and skip DOM-dependent features (e.g. TextInputPlugin).
if (typeof window === 'undefined') { globalThis.window = globalThis; }
if (typeof document === 'undefined') { globalThis.document = {}; }
