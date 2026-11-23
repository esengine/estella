// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { AnyComponentDef, ComponentData } from './component';

/** @internal Only engine-owned projections may use this synchronous writer. */
export const componentProjection = Symbol('component projection');

interface ComponentWriteTarget {
    set<C extends AnyComponentDef>(entity: Entity, def: C, data: ComponentData<C>): void;
    [componentProjection]?<C extends AnyComponentDef>(entity: Entity, def: C, data: ComponentData<C>): void;
}

/** @internal Store a complete record from the sampler or composer synchronously. */
export function writeProjection<C extends AnyComponentDef>(
    world: ComponentWriteTarget, entity: Entity, def: C, data: ComponentData<C>,
): void {
    if (world[componentProjection]) world[componentProjection](entity, def, data);
    else world.set(entity, def, data);
}
