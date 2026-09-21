// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  webEntry.ts — what every web entry does before it hands the SDK over.
 *
 * A CALL, not a module side effect. `sideEffects` in package.json is a list of
 * FILES, and which file a statement ends up in is the bundler's choice: put
 * this in a module the entries share and it lands in a chunk nobody whitelisted,
 * where tree-shaking drops it. The editor booted to "Platform not initialized".
 */
import { setPlatform, webAdapter } from '../platform';
import { ensureBuiltinComponentsRegistered, markEngineComponentBaseline } from '../ecs/component';
import { ensureBuiltinAiRegistrations } from '../ai/builtins';

/** Idempotent: an entry that re-exports another still calls it exactly once. */
export function installWebEntry(): void {
    setPlatform(webAdapter);
    // Every engine component (COMPONENT_META) up front, so a scene can never
    // silently drop one that exists in the engine but lacks a typed const.
    ensureBuiltinComponentsRegistered();
    // Same for the built-in AI action/condition names, so editor palettes see
    // them even in an SDK instance that never builds the FSM/BT plugins.
    ensureBuiltinAiRegistrations();
    // Every engine `defineComponent` has run by now, so a project hot reload
    // cannot wipe them.
    markEngineComponentBaseline();
}
