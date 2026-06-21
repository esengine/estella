/**
 * @file    index.ts
 * @brief   ESEngine SDK - Web entry point (auto-initializes Web platform)
 */

import { setPlatform, webAdapter } from './platform';
setPlatform(webAdapter);

export * from './core';
export * from './webAppFactory';

// ABI layout hash of the component schema this SDK bundle was generated from.
// Exposed so an embedding host (e.g. the editor) can compare it against the
// wasm build it loads — see desktop EngineGuard. The authoritative, fatal
// layout check still happens inside the runtime bridge handshake.
export { ABI_LAYOUT_HASH } from './component.generated';
