// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.base.ts
 * @brief   ESEngine SDK - Web entry, minus the optional subsystems
 *
 * `index` is this plus every optional subsystem; `index.lean` is this alone,
 * for a package that imports back the subpaths its own content uses. The
 * prologue both run is `installWebEntry`, which they CALL: this file is not one
 * package.json declares side-effectful, so nothing here may have an effect.
 */
export * from './core';
export * from './runtime/webAppFactory';

// The component schema this bundle was generated from, so an embedding host
// can compare it against the wasm it loads (desktop EngineGuard). The fatal
// check is still the runtime bridge handshake's.
export { ABI_LAYOUT_HASH } from './ecs/component.generated';
