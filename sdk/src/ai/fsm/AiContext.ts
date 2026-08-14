// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AiContext.ts
 * @brief   The concrete leaf context + the shared action/condition registry.
 *
 * AiContext is a BehaviorContext superset (adds the blackboard): writing an FSM
 * action or a BT leaf is the same programming model as a `defineBehavior.update`
 * — same entity/world/commands access, plus `blackboard` for AI data flow. This
 * is the engine layer, so it may reference World/Commands; the FSM/BT cores stay
 * generic and wasm-free.
 */

import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import type { CommandsInstance } from '../../ecs/commands';
import type { AnyComponentDef, ComponentData } from '../../ecs/component';
import type { Blackboard } from './Blackboard';
import { AiRegistry, type AiAction, type AiActionSpec, type AiCondition } from './registry';

export interface AiContext {
    /** The agent entity this action/condition runs for. */
    readonly entity: Entity;
    /** Frame delta in seconds. */
    readonly dt: number;
    /** This agent's blackboard — the AI data plane. */
    readonly blackboard: Blackboard;
    /** The world, for cross-entity access. */
    readonly world: World;
    /** Deferred structural ops (spawn / despawn), safe mid-iteration. */
    readonly commands: CommandsInstance;
    /** Read another component on THIS entity. */
    get<C extends AnyComponentDef>(component: C): ComponentData<C>;
    /** Write another component on THIS entity. */
    set<C extends AnyComponentDef>(component: C, data: ComponentData<C>): void;
    /** Whether THIS entity has `component`. */
    has(component: AnyComponentDef): boolean;
}

/**
 * The process-wide AI registry. Actions/conditions are code registrations
 * (stable like component defs), so a single shared instance is correct across
 * App instances; `.esfsm`/`.esbt` data references resolve against it.
 */
export const aiRegistry = new AiRegistry<AiContext>();

/**
 * Register a named action referenced by FSM state hooks / BT leaves / event
 * rows — as a bare function, or with declared parameters, which is what turns
 * an editor text box into typed controls.
 */
export function registerAction(name: string, fn: AiAction<AiContext> | AiActionSpec<AiContext>): void {
    aiRegistry.registerAction(name, fn);
}

/** Register a named condition referenced by FSM transitions / BT conditions. */
export function registerCondition(name: string, fn: AiCondition<AiContext>): void {
    aiRegistry.registerCondition(name, fn);
}
