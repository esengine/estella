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
import { Disabled, getComponent, getComponentRegistry, renderableComponents, Transform, type AnyComponentDef, type RenderableComponentDef } from './component';
import { UINode, UIDisplay } from '../ui/core/ui-node';

interface VisibilitySource {
    name: string;
    definition: AnyComponentDef;
    rank: number;
    field: string;
    hiddenValue: false | UIDisplay.None;
    shownValue: true | UIDisplay.Flex;
}

const uiVisibility: VisibilitySource = {
    name: UINode._name, definition: UINode, rank: -1, field: 'display',
    hiddenValue: UIDisplay.None, shownValue: UIDisplay.Flex,
};
const visibilityIndexes = new WeakMap<readonly RenderableComponentDef[], ReadonlyMap<string, VisibilitySource>>();

/** @internal Visibility fields keyed by the catalogue names returned by component inspection. */
export function entityVisibilityIndex(): ReadonlyMap<string, VisibilitySource> {
    const renderers = renderableComponents();
    const cached = visibilityIndexes.get(renderers);
    if (cached) return cached;
    const ranks = new Map<RenderableComponentDef, number>();
    for (const [rank, definition] of renderers.entries()) {
        if (!ranks.has(definition)) ranks.set(definition, rank);
    }
    const index = new Map<string, VisibilitySource>();
    for (const name of getComponentRegistry().keys()) {
        const definition = getComponent(name) as RenderableComponentDef;
        const rank = ranks.get(definition);
        if (rank === undefined) continue;
        index.set(name, { name, definition, rank, field: definition.renderableField, hiddenValue: false, shownValue: true });
    }
    index.set(uiVisibility.name, uiVisibility);
    visibilityIndexes.set(renderers, index);
    return index;
}

/** @internal UI display takes priority, followed by the first registered renderer present. */
export function entityVisibilitySource(
    types: readonly string[], index = entityVisibilityIndex(),
): VisibilitySource | undefined {
    let primary: VisibilitySource | undefined;
    for (const type of types) {
        const candidate = index.get(type);
        if (candidate === uiVisibility) return candidate;
        if (candidate && (!primary || candidate.rank < primary.rank)) primary = candidate;
    }
    return primary;
}

/**
 * Whether hiding this entity would do anything — it has a UI node, or at least
 * one renderer of its own. False for a bare transform, whose children draw but
 * which has nothing of its own to hide.
 */
export function hasVisibility(world: World, entity: Entity): boolean {
    return entityVisibilitySource(world.getComponentTypes(entity)) !== undefined;
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
    const types = world.getComponentTypes(entity);
    const index = entityVisibilityIndex();
    const sources = types.includes(uiVisibility.name) ? [uiVisibility]
        : types.map(type => index.get(type)).filter(source => source !== undefined).sort((a, b) => a.rank - b.rank);
    for (const { definition, field, hiddenValue, shownValue } of sources) {
        const data = world.get(entity, definition) as Record<string, unknown>;
        data[field] = visible ? shownValue : hiddenValue;
        world.set(entity, definition, data as never);
    }
}

/** The reading {@link setEntityVisible} writes. An entity with nothing to hide is visible. */
export function isEntityVisible(world: World, entity: Entity): boolean {
    const source = entityVisibilitySource(world.getComponentTypes(entity));
    return !source || (world.get(entity, source.definition) as Record<string, unknown>)[source.field] !== source.hiddenValue;
}

/**
 * Switch `entity` off, or back on. Everything under it goes with it — a
 * character switched off with its sword still swinging is not switched off —
 * and the subtree is DERIVED, so switching the character back on does not
 * un-switch a sword the author had switched off on its own.
 */
export function setEntityActive(world: World, entity: Entity, active: boolean): void {
    if (!world.valid(entity)) return;
    if (active) {
        if (world.has(entity, Disabled)) world.remove(entity, Disabled);
    } else if (!world.has(entity, Disabled)) {
        world.insert(entity, Disabled, {});
    }
    world.getCppRegistry()?.setEntityEnabled?.(entity, active);
}

/** Whether this entity ITSELF is switched on. An ancestor's switch takes it out
 *  of every query without changing this — see {@link setEntityActive}. */
export function isEntityActive(world: World, entity: Entity): boolean {
    return world.valid(entity) && (world.getCppRegistry()?.isEntityEnabled?.(entity) ?? !world.has(entity, Disabled));
}

/**
 * Take `entity` out of its parent's hierarchy and leave it where it was.
 *
 * A bare {@link World.removeParent} keeps the LOCAL transform — a position
 * relative to a parent that is no longer there, so the entity jumps. The world
 * transform, as of the last transform pass, becomes the local one.
 */
export function detachPreservingWorldTransform(world: World, entity: Entity): void {
    const transform = world.tryGet(entity, Transform);
    world.removeParent(entity);
    if (!transform) return;
    world.set(entity, Transform, {
        ...transform,
        position: { ...transform.worldPosition },
        rotation: { ...transform.worldRotation },
        scale: { ...transform.worldScale },
    });
}
