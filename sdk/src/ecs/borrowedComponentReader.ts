// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { BuiltinComponentDef } from './component';
import type { World } from './world';
import type { Entity } from '../types';

type ComponentReaderWorld = Pick<World, 'get'> & Partial<Pick<World, 'resolveGetter' | 'speculating'>>;

/** Resolve a borrowed component reader for a synchronous traversal. */
export function borrowedComponentReader<T>(world: ComponentReaderWorld, component: BuiltinComponentDef<T>): (entity: Entity) => T {
    const read = (entity: Entity) => world.get(entity, component);
    const fast = world.resolveGetter?.(component) as ((entity: Entity) => T) | null | undefined;
    // World.get records dependency reads during a speculative transaction.
    return fast ? entity => world.speculating ? read(entity) : fast(entity) : read;
}
