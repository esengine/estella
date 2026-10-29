// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/view.ts
 * @brief   The shared shape of a Cocos built-in component that is a view on engine data.
 *
 * `Label`, `Sprite`, `UITransform` and the rest have no storage of their own: each reads and writes a component the engine
 * already has (`Text`, `Sprite`), or a small compat data component where the engine has no counterpart. What they share is how a
 * view is found and made — one instance per (world, entity, class), created on demand, never driven by the host's lifecycle
 * system, because there is nothing for it to run — and that is here.
 */
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Component } from '../component';
import type { BuiltinAdapter } from '../builtins';
import { instancesOn, nodeOf, storeInstance } from '../registry';
import { Color } from '../math';

/** A view on engine data. `enabled` is read from and written to the underlying component where it has one. */
export abstract class ViewComponent extends Component {
    /** The enable flag of whatever stands behind this view: the engine's `enabled` field, or the view's own. */
    protected abstract readEnabled(): boolean;
    protected abstract writeEnabled(value: boolean): void;
}

/**
 * The adapter for a view class: @p present says whether the entity has what stands behind it, @p create gives it that.
 * The view instance is made once and kept, so `node.getComponent(Label) === node.getComponent(Label)`.
 */
export function viewAdapter<T extends Component>(
    ctor: new () => T,
    present: (world: World, entity: Entity) => boolean,
    create: (world: World, entity: Entity) => void,
): BuiltinAdapter {
    const view = (world: World, entity: Entity): T => {
        let inst = instancesOn(world, entity)?.get(ctor) as T | undefined;
        if (!inst) {
            inst = new ctor();
            inst._world = world;
            inst._entity = entity;
            inst.node = nodeOf(world, entity);
            inst._loaded = true;
            storeInstance(world, entity, ctor, inst);
        }
        return inst;
    };
    return {
        get: (world, entity) => (present(world, entity) ? view(world, entity) : null),
        add: (world, entity) => {
            if (!present(world, entity)) create(world, entity);
            return view(world, entity);
        },
    };
}

/** An engine colour (channels 0..1) as Cocos's (0..255). */
export function toCocosColor(c: { r: number; g: number; b: number; a: number }): Color {
    return new Color(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(c.a * 255));
}

/** Cocos's colour (0..255) as the engine's (0..1). */
export function toEngineColor(c: Color): { r: number; g: number; b: number; a: number } {
    return { r: c.r / 255, g: c.g / 255, b: c.b / 255, a: c.a / 255 };
}
