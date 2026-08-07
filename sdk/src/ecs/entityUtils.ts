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
 *
 * WHICH components hiding reaches is not decided here: each declares itself
 * `renderable=<field>` at its ES_COMPONENT site, and {@link renderableComponents}
 * answers from the registry. Scene sleep/wake and the editor's eye read the same
 * declaration, so a renderer cannot be visible to one and invisible to another.
 */
import type { Entity } from '../types';
import type { World } from './world';
import { Disabled, renderableComponents } from './component';
import { UINode, UIDisplay, type UINodeData } from '../ui/core/ui-node';

/**
 * Whether hiding this entity would do anything — it has a UI node, or at least
 * one renderer of its own. False for a bare transform, whose children draw but
 * which has nothing of its own to hide.
 */
export function hasVisibility(world: World, entity: Entity): boolean {
    if (world.has(entity, UINode)) return true;
    return renderableComponents().some((comp) => world.has(entity, comp));
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
    for (const comp of renderableComponents()) {
        if (!world.has(entity, comp)) continue;
        const data = world.get(entity, comp) as Record<string, unknown>;
        data[comp.renderableField] = visible;
        world.set(entity, comp, data as never);
    }
}

/** The reading {@link setEntityVisible} writes. An entity with nothing to hide is visible. */
export function isEntityVisible(world: World, entity: Entity): boolean {
    if (world.has(entity, UINode)) {
        return (world.get(entity, UINode) as UINodeData).display !== UIDisplay.None;
    }
    for (const comp of renderableComponents()) {
        if (!world.has(entity, comp)) continue;
        return (world.get(entity, comp) as Record<string, unknown>)[comp.renderableField] !== false;
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
