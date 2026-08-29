// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    liveAssetBindings.ts
 * @brief   Which live components are bound to one asset value, right now.
 *
 * @details Derived when it is asked for, never maintained. `sprite.texture = h`
 *          is an ordinary field write, so a registry kept alongside the World
 *          would be a second source of truth that game code silently
 *          invalidates. Asset replacement is rare enough to pay for the walk.
 *
 *          The walk is over `component.assetFields` — the same declaration that
 *          drives discovery, cook inclusion and `@uuid` resolution. A
 *          hand-written list of components would answer for the ones its author
 *          remembered: the built-in rebinder knew two of the seven fields that
 *          carry a texture, and no plugin or project component at all.
 */
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { getComponentRegistry, type AnyComponentDef } from '../ecs/component';
import type { AssetFieldType } from '../scene/scene';

/** One field of one live component, bound to the asset being replaced. */
export interface LiveAssetBinding {
    readonly entity: Entity;
    readonly component: AnyComponentDef;
    readonly field: string;
}

/** Component names carrying at least one field of any of these asset types —
 *  what a system walking those bindings reaches for, from the same declaration. */
export function componentsBindingAssetTypes(types: readonly string[]): string[] {
    const names: string[] = [];
    for (const [name, component] of getComponentRegistry()) {
        if (component.assetFields.some((f) => types.includes(f.type))) names.push(name);
    }
    return names;
}

/**
 * Every live binding of `value` — the asset a replacement is about to migrate.
 *
 * An empty value (0 / '') is refused rather than matched: it is what an UNBOUND
 * field holds, so matching it would hand back every field of every entity that
 * never referenced the asset at all.
 */
export function findLiveAssetBindings(
    world: World, type: AssetFieldType, value: unknown,
): LiveAssetBinding[] {
    const found: LiveAssetBinding[] = [];
    if (value === 0 || value === '' || value === null || value === undefined) return found;

    for (const component of getComponentRegistry().values()) {
        const fields = component.assetFields.filter((f) => f.type === type);
        if (fields.length === 0) continue;
        for (const entity of world.getEntitiesWithComponents([component])) {
            const data = world.get(entity, component) as Record<string, unknown>;
            for (const { field } of fields) {
                if (data[field] === value) found.push({ entity, component, field });
            }
        }
    }
    return found;
}

/** Every asset field this one entity carries, whatever the type. */
export function assetBindingsOf(world: World, entity: Entity): LiveAssetBinding[] {
    const found: LiveAssetBinding[] = [];
    for (const component of getComponentRegistry().values()) {
        if (component.assetFields.length === 0) continue;
        if (!world.has(entity, component)) continue;
        for (const { field } of component.assetFields) found.push({ entity, component, field });
    }
    return found;
}

/** Read one binding's current value — what a rollback has to put back. */
export function readLiveAssetBinding(world: World, binding: LiveAssetBinding): unknown {
    return (world.get(binding.entity, binding.component) as Record<string, unknown>)[binding.field];
}

/**
 * Point one binding at another asset.
 *
 * Through `world.set` rather than a mutation: an engine-backed component answers
 * a fresh object per `get`, so writing to that object stores nothing.
 */
export function writeLiveAssetBinding(
    world: World, binding: LiveAssetBinding, value: unknown,
): void {
    const data = world.get(binding.entity, binding.component) as Record<string, unknown>;
    data[binding.field] = value;
    world.set(binding.entity, binding.component, data as never);
}
