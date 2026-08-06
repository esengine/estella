// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entityUtils.ts
 * @brief   Showing / hiding an entity, and taking it out of the frame.
 *
 * Two different questions that read alike. `visible` is about drawing: the
 * entity is still simulated, still hit by queries, just not on screen.
 * `active` is about existing at all: a `Disabled` entity is skipped by the
 * systems that respect the tag.
 */
import type { Entity } from '../types';
import type { World } from './world';
import {
    Sprite, SpineAnimation, BitmapText, ShapeRenderer, ParticleEmitter, Disabled,
    type AnyComponentDef,
} from './component';
import { UINode, UIDisplay, type UINodeData } from '../ui/core/ui-node';
import { UIVisual } from '../ui/core/ui-visual';

/**
 * Every component that draws something, each carrying its own `enabled` bit.
 *
 * ONE list, because scene sleep/wake and the helpers below ask the same
 * question — and answered it differently for long enough that
 * {@link setEntityVisible} silently did nothing to a Spine armature, a particle
 * system or a UI element. A new renderer belongs here, not in a second list.
 */
export const RENDERABLE_COMPONENTS: readonly AnyComponentDef[] = [
    Sprite, SpineAnimation, BitmapText, ShapeRenderer, ParticleEmitter, UIVisual,
];

/**
 * Whether hiding this entity would do anything — it has a UI node, or at least
 * one renderer of its own. False for a bare transform, whose children draw but
 * which has nothing of its own to hide.
 */
export function hasVisibility(world: World, entity: Entity): boolean {
    if (world.has(entity, UINode)) return true;
    return RENDERABLE_COMPONENTS.some((comp) => world.has(entity, comp));
}

/**
 * Show or hide an entity.
 *
 * A UI node hides through `display`, which the layout pass resolves down the
 * tree — hiding a panel hides everything under it, and that is what hiding a UI
 * element means. Nothing else has hierarchical visibility in the runtime, so
 * for the rest the write lands on this entity's own renderers and its children
 * keep drawing.
 */
export function setEntityVisible(world: World, entity: Entity, visible: boolean): void {
    if (world.has(entity, UINode)) {
        const node = world.get(entity, UINode) as UINodeData;
        node.display = visible ? UIDisplay.Flex : UIDisplay.None;
        world.set(entity, UINode, node);
        return;
    }
    for (const comp of RENDERABLE_COMPONENTS) {
        if (!world.has(entity, comp)) continue;
        const data = world.get(entity, comp) as { enabled: boolean };
        data.enabled = visible;
        world.set(entity, comp, data as never);
    }
}

/** The reading {@link setEntityVisible} writes. An entity with nothing to hide is visible. */
export function isEntityVisible(world: World, entity: Entity): boolean {
    if (world.has(entity, UINode)) {
        return (world.get(entity, UINode) as UINodeData).display !== UIDisplay.None;
    }
    for (const comp of RENDERABLE_COMPONENTS) {
        if (world.has(entity, comp)) return (world.get(entity, comp) as { enabled: boolean }).enabled;
    }
    return true;
}

export function setEntityActive(world: World, entity: Entity, active: boolean): void {
    if (active) {
        if (world.has(entity, Disabled)) {
            world.remove(entity, Disabled);
        }
    } else {
        if (!world.has(entity, Disabled)) {
            world.insert(entity, Disabled, {});
        }
    }
}

export function isEntityActive(world: World, entity: Entity): boolean {
    return !world.has(entity, Disabled);
}
