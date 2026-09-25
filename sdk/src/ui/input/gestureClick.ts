// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gestureClick.ts — clicks that run inside the host's own input event.
 *
 * A frame reads a release after the host has returned from it, and some calls are
 * refused outside it: WeChat shares a recording only from within `touchend`. A
 * control registered here is clicked during that event, from where its pointer
 * pressed and last hovered.
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
    if (!r) registries.set(world, r = { handlers: new Map(), fired: new Set() });
    return r;
}

/** Run @p onClick inside the release event that clicks @p entity. */
export function onGestureClick(world: World, entity: Entity, onClick: () => void): () => void {
    const r = registryOf(world);
    r.handlers.set(entity, onClick);
    return () => {
        if (r.handlers.get(entity) === onClick) r.handlers.delete(entity);
    };
}

/** @internal Click @p entity now, if it asked for its clicks here. */
export function fireGestureClick(world: World, entity: Entity): boolean {
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
