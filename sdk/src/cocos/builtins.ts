// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/builtins.ts
 * @brief   The Cocos classes the engine already has under another name — `Label`, `Sprite`, `UITransform`, `Button`.
 *
 * A script asks `node.getComponent(Label)` and then sets `label.string`. There is no script class behind it: the answer is a
 * view on an Estella component (`Text`), whose fields it reads and writes under Cocos's names. An adapter says how to find
 * that view on an entity and how to make one; the classes that use it live beside it and register themselves.
 */
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { Component } from './component';

export interface BuiltinAdapter {
    /** The view on @p entity's component, or null when it has none. */
    get(world: World, entity: Entity): Component | null;
    /** Give @p entity the component (with the engine's defaults) and return the view. */
    add(world: World, entity: Entity): Component | null;
}

const adapters = new Map<unknown, BuiltinAdapter>();

/** Register an adapter under its class and the names a script or a scene may use for it (`'cc.Label'`, `'Label'`). */
export function registerBuiltinComponent(ctor: Function, names: string[], adapter: BuiltinAdapter): void {
    adapters.set(ctor, adapter);
    for (const n of names) adapters.set(n, adapter);
}

export function builtinAdapterFor(type: unknown): BuiltinAdapter | undefined {
    return adapters.get(type);
}

/** Test seam. */
export function resetBuiltinAdapters(): void {
    adapters.clear();
}
