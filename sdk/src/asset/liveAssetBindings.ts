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
import { builtinComponentRegistry, getComponentRegistry, isBuiltinComponent, type AnyComponentDef } from '../ecs/component';
import { collectMaterialTextures } from './surfaceTextureUses';
import type { AssetFieldType } from '../scene/scene';

/** One field of one live component, bound to the asset being replaced. */
export interface LiveAssetBinding {
    readonly entity: Entity;
    readonly component: AnyComponentDef;
    readonly field: string;
    readonly value: number | string;
    readonly measuresTextureDensity?: boolean;
}

/** Component names carrying at least one field of any of these asset types —
 *  what a system walking those bindings reaches for, from the same declaration. */
export function componentsBindingAssetTypes(world: World, types: readonly string[]): string[] {
    const names = new Set<string>();
    const add = (name: string, component: AnyComponentDef): void => {
        if (component.assetFields.some(f => types.includes(f.type))) names.add(name);
    };
    for (const [name, component] of getComponentRegistry()) add(name, component);
    for (const component of world.getStoredScriptComponents()) add(component._name, component);
    return [...names];
}

/** Native fields come from the core catalogue. Script rows retain their own declaration across reloads. */
function* storedBindingComponents(world: World, entity?: Entity): Generator<AnyComponentDef> {
    for (const component of builtinComponentRegistry().values()) {
        if (isBuiltinComponent(component)) yield component;
    }
    yield* world.getStoredScriptComponents(entity);
}

/** Active fields whose renderer does not report texel demand need their imported pixels. */
export function collectUnmeasuredTextures(world: World, into: Set<number>): void {
    const materials = new Set<number>();
    for (const component of storedBindingComponents(world)) {
        const fields = component.assetFields.filter(f => !f.measuresTextureDensity && (f.type === 'texture' || f.type === 'material'));
        if (!fields.length) continue;
        const native = isBuiltinComponent(component);
        const entities = native ? world.getEntitiesWithComponents([component]) : world.getStoredComponentEntities(component);
        for (const entity of entities) {
            if ((!native && !world.isEntityActive(entity)) || world.isDestructionPending(entity)) continue;
            const data = world.get(entity, component);
            for (const { type, field } of fields) {
                const handle = data[field];
                if (typeof handle === 'number' && handle > 0) (type === 'texture' ? into : materials).add(handle);
            }
        }
    }
    for (const material of materials) collectMaterialTextures(material, into);
}

/** Script definitions share an id by name. A synchronous observer may replace the row with a new declaration. */
export function hasBindingDeclaration(world: World, entity: Entity, component: AnyComponentDef): boolean {
    if (isBuiltinComponent(component)) return true;
    for (const stored of world.getStoredScriptComponents(entity)) {
        if (stored._id === component._id) return stored === component;
    }
    return false;
}

/**
 * Every live binding of `value` — the asset a replacement is about to migrate.
 *
 * An empty value (0 / '') is refused rather than matched: it is what an UNBOUND
 * field holds, so matching it would hand back every field of every entity that
 * never referenced the asset at all.
 */
export function* liveAssetBindings(
    world: World, type: AssetFieldType, value: number | string, other?: number | string,
): Generator<LiveAssetBinding> {
    if (!value) return;

    for (const component of storedBindingComponents(world)) {
        if (!component.assetFields.length) continue;
        const fields = component.assetFields.filter((f) => f.type === type);
        if (fields.length === 0) continue;
        for (const entity of world.getStoredComponentEntities(component)) {
            if (world.isDestructionPending(entity)) continue;
            const data = world.get(entity, component) as Record<string, number | string>;
            for (const { field, measuresTextureDensity } of fields) {
                const bound = data[field];
                if (bound === value || (other !== undefined && bound === other)) {
                    yield { entity, component, field, value: bound, measuresTextureDensity };
                }
            }
        }
    }
}

/** Read actual rows, starting with the edited component. A visitor that has found all its handles can stop. */
export function visitEntityAssetBindings(
    world: World, entity: Entity, visit: (type: AssetFieldType, value: unknown) => boolean | void, first?: AnyComponentDef,
): void {
    const read = (component: AnyComponentDef): boolean => {
        if (!component.assetFields.length || !world.has(entity, component)) return false;
        const data = world.get(entity, component) as Record<string, unknown>;
        return component.assetFields.some(({ field, type }) => visit(type, data[field]) === true);
    };
    if (first && hasBindingDeclaration(world, entity, first) && read(first)) return;
    for (const component of storedBindingComponents(world, entity)) {
        if (component !== first && read(component)) return;
    }
}
