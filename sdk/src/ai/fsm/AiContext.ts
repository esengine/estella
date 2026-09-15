// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AiContext.ts
 * @brief   The concrete leaf context + the shared action/condition registry.
 *
 * AiContext is a BehaviorContext superset (adds the blackboard): writing an FSM
 * action, a BT leaf or a script-graph node is the same programming model as a
 * `defineBehavior.update` — same entity/world/commands/input/time access, plus
 * `blackboard` for AI data flow. This is the engine layer, so it may reference
 * World/Commands; the FSM/BT cores stay generic and wasm-free.
 *
 * `input` arrives through {@link noInput} when a caller has none — a test, or a
 * host with no devices. Nothing pressed is the truthful answer there, and it
 * keeps the context's shape from being conditional.
 */

import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import type { CommandsInstance } from '../../ecs/commands';
import type { AnyComponentDef, ComponentData } from '../../ecs/component';
import type { Blackboard } from './Blackboard';
import { AiRegistry, type AiAction, type AiActionSpec, type AiCondition, type AiValueSpec } from './registry';
import { InputState } from '../../input/input';

export interface AiContext {
    /** The agent entity this action/condition runs for. */
    readonly entity: Entity;
    /** Frame delta in seconds. */
    readonly dt: number;
    /** Runtime input — the same state `defineBehavior` reads. A leaf that cannot
     *  see the keyboard is a leaf no game logic can be written in. */
    readonly input: InputState;
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

/** An input state with nothing pressed — what a caller with no devices supplies. */
export const noInput = (): InputState => EMPTY_INPUT;
const EMPTY_INPUT = new InputState();

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

/**
 * Register a named VALUE — a pure name that answers a question, which a script
 * graph reads by wiring its declared outputs. Same store as the actions, so it
 * shows up in the same palettes.
 */
export function registerValue(name: string, spec: AiValueSpec<AiContext>): void {
    aiRegistry.registerValue(name, spec);
}
