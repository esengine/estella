// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   ESEngine SDK - Web entry point (auto-initializes Web platform)
 */

import { setPlatform, webAdapter } from './platform';
import { ensureBuiltinComponentsRegistered, markEngineComponentBaseline } from './ecs/component';
import { ensureBuiltinAiRegistrations } from './ai/builtins';
setPlatform(webAdapter);

// Register every engine component (COMPONENT_META) up front so a scene can never
// silently drop a component that exists in the engine but lacks a typed const.
ensureBuiltinComponentsRegistered();
// Same for the built-in AI action/condition names, so editor palettes see them
// even in an SDK instance that never builds the FSM/BT plugins.
ensureBuiltinAiRegistrations();
// All engine `defineComponent`s have run by now (their modules are dependencies of
// this entry, evaluated before this statement); snapshot them so a project hot
// reload can't wipe them (see seedEngineComponents).
markEngineComponentBaseline();

export * from './core';
export * from './runtime/webAppFactory';

// ABI layout hash of the component schema this SDK bundle was generated from.
// Exposed so an embedding host (e.g. the editor) can compare it against the
// wasm build it loads — see desktop EngineGuard. The authoritative, fatal
// layout check still happens inside the runtime bridge handshake.
export { ABI_LAYOUT_HASH } from './ecs/component.generated';
