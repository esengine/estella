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
import { builtinComponentRegistry, getComponentRegistry, type AnyComponentDef } from '../ecs/component';
import type { AssetFieldType } from '../scene/scene';

/** One field of one live component, bound to the asset being replaced. */
export interface LiveAssetBinding {
    readonly entity: Entity;
    readonly component: AnyComponentDef;
    readonly field: string;
    readonly value: number | string;
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
export function* liveAssetBindings(
    world: World, type: AssetFieldType, value: number | string, other?: number | string,
): Generator<LiveAssetBinding> {
    if (!value) return;

    for (const component of getComponentRegistry().values()) {
        if (!component.assetFields.length) continue;
        const fields = component.assetFields.filter((f) => f.type === type);
        if (fields.length === 0) continue;
        for (const entity of world.getEntitiesWithComponents([component])) {
            if (world.isDestructionPending(entity)) continue;
            const data = world.get(entity, component) as Record<string, number | string>;
            for (const { field } of fields) {
                const bound = data[field];
                if (bound === value || (other !== undefined && bound === other)) {
                    yield { entity, component, field, value: bound };
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
    if (first && read(first)) return;
    for (const component of builtinComponentRegistry().values()) {
        if (component !== first && read(component)) return;
    }
    for (const component of world.getStoredScriptComponents(entity)) {
        if (component !== first && read(component)) return;
    }
}
