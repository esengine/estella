// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gestureClick.ts — clicks that run inside the host's own input event.
 *
 * A frame reads a release after the host has returned from it, and some calls are
 * refused outside it: WeChat shares a recording only from within `touchend`. A
 * control registered here is clicked during that event, using the release position.
 */
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';

interface Registry {
    handlers: Map<Entity, () => void>;
    fired: Set<Entity>;
}

const registries = new WeakMap<World, Registry>();

function registryOf(world: World): Registry {
    let r = registries.get(world);
    if (!r) {
        r = { handlers: new Map(), fired: new Set() };
        registries.set(world, r);
        const owned = r;
        world.onDespawn(entity => {
            owned.handlers.delete(entity);
            owned.fired.delete(entity);
        });
    }
    return r;
}

/** Run @p onClick inside the release event that clicks @p entity. */
export function onGestureClick(world: World, entity: Entity, onClick: () => void): () => void {
    if (!world.valid(entity) || world.isDestructionPending?.(entity)) return () => {};
    const r = registryOf(world);
    r.handlers.set(entity, onClick);
    return () => {
        if (r.handlers.get(entity) === onClick) r.handlers.delete(entity);
    };
}

export function hasGestureClick(world: World, entity: Entity): boolean {
    return registries.get(world)?.handlers.has(entity) ?? false;
}

/** @internal Click @p entity now, if it asked for its clicks here. */
export function fireGestureClick(world: World, entity: Entity): boolean {
    if (!world.valid(entity) || world.isDestructionPending?.(entity)) return false;
    const r = registries.get(world);
    const onClick = r?.handlers.get(entity);
    if (!r || !onClick) return false;
    r.fired.add(entity);
    onClick();
    return true;
}

/** @internal Whether the frame's own click for @p entity was already run during
 *  its release; answers once. */
export function takeGestureFired(world: World, entity: Entity): boolean {
    const r = registries.get(world);
    return !!r?.fired.delete(entity);
}

/** @internal Release markers whose corresponding frame click was cancelled or unobserved. */
export function expireGestureFired(world: World): void {
    registries.get(world)?.fired.clear();
}
