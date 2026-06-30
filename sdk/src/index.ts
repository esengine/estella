// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   ESEngine SDK - Web entry point (auto-initializes Web platform)
 */

import { setPlatform, webAdapter } from './platform';
import { ensureBuiltinComponentsRegistered } from './component';
setPlatform(webAdapter);

// Register every engine component (COMPONENT_META) up front so a scene can never
// silently drop a component that exists in the engine but lacks a typed const.
ensureBuiltinComponentsRegistered();

export * from './core';
export * from './webAppFactory';

// ABI layout hash of the component schema this SDK bundle was generated from.
// Exposed so an embedding host (e.g. the editor) can compare it against the
// wasm build it loads — see desktop EngineGuard. The authoritative, fatal
// layout check still happens inside the runtime bridge handshake.
export { ABI_LAYOUT_HASH } from './component.generated';
