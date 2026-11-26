// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { AnyComponentDef, ComponentData } from './component';

/** @internal Only engine-owned projections may use this synchronous writer. */
export const componentProjection = Symbol('component projection');
export const readComponentProjection = Symbol('read component projection');

interface ComponentReadTarget {
    get(entity: Entity, def: AnyComponentDef): Record<string, unknown>;
    [readComponentProjection]?(entity: Entity, def: AnyComponentDef, into: Record<string, unknown>): void;
}

/** Copy a script or registry value while retaining the destination's nested records. */
export function copyComponentData(into: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const key of Object.keys(source)) {
        const value = source[key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(into[key] ??= {}, value);
        } else {
            into[key] = value;
        }
    }
}

export function readProjection(
    world: ComponentReadTarget, entity: Entity, def: AnyComponentDef, into: Record<string, unknown>,
): void {
    if (world[readComponentProjection]) world[readComponentProjection](entity, def, into);
    else copyComponentData(into, world.get(entity, def));
}

interface ComponentWriteTarget {
    set<C extends AnyComponentDef>(entity: Entity, def: C, data: ComponentData<C>): void;
    [componentProjection]?<C extends AnyComponentDef>(entity: Entity, def: C, data: ComponentData<C>): void;
}

/** @internal Store a complete record from an engine system while preserving pending asset fields. */
export function writeProjection<C extends AnyComponentDef>(
    world: ComponentWriteTarget, entity: Entity, def: C, data: ComponentData<C>,
): void {
    if (world[componentProjection]) world[componentProjection](entity, def, data);
    else world.set(entity, def, data);
}
