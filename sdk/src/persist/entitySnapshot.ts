// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entitySnapshot.ts
 * @brief   One entity's state as JSON, and back. Built on the scene format's
 *          own per-entity primitive, so it saves what a scene saves — builtin
 *          and script components alike, out-of-band state such as tilemap
 *          chunks folded in, runtime-only components left out — and restores
 *          through the same loader a scene uses.
 */
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { getComponent, Name } from '../ecs/component';
import { mapEntityRefField } from '../ecs/entityRefField';
import { cloneJsonValue } from '../util/cloneJsonValue';
import { loadComponent, visitSerializedComponents, type SceneComponentData } from '../scene/scene';

export interface EntitySnapshot {
    name?: string;
    components: SceneComponentData[];
}

export interface EntitySnapshotOptions {
    /** Only these component types. Omitted, every one a scene would save. */
    include?: readonly string[];
    /** Never these. `NetGhost` and the `Persistent` marker are always left out,
     *  and `Replicated` keeps only what outlives the process: its archetype, and
     *  no owner (a connection id means nothing after a restart) or netId. */
    exclude?: readonly string[];
}

/** What a snapshot never carries: identity that belongs to the running process. */
const PROCESS_STATE = new Set(['NetGhost', 'Persistent']);

/** A restored replica gets its identity from the new process. Only its archetype travels. */
function replicaSnapshot(comp: SceneComponentData): SceneComponentData {
    return { type: comp.type, data: { netId: 0, owner: 0, archetype: comp.data.archetype ?? '' } };
}

/**
 * Snapshot one entity. A field that refers to another entity is written as 0:
 * entity handles mean nothing in another process, so a reference that has to
 * survive a restart is the game's to store as its own key.
 */
export function snapshotEntity(world: World, entity: Entity, options: EntitySnapshotOptions = {}): EntitySnapshot {
    const include = options.include ? new Set(options.include) : null;
    const exclude = new Set(options.exclude ?? []);
    const components: SceneComponentData[] = [];
    visitSerializedComponents(world, entity, (comp, definition) => {
        if (PROCESS_STATE.has(definition._name) || exclude.has(comp.type)) return;
        if (include && !include.has(comp.type)) return;
        if (definition._name === 'Replicated') {
            components.push(replicaSnapshot(comp));
            return;
        }
        for (const field of definition.entityFields) {
            if (field in comp.data) comp.data[field] = mapEntityRefField(comp.data[field], ref => typeof ref === 'number' ? 0 : ref);
        }
        components.push(comp);
    });
    const name = (world.tryGet(entity, Name) as { value?: string } | null)?.value;
    return name ? { name, components } : { components };
}

/**
 * Put a snapshot's state onto `into`, or onto a new entity. Components the
 * snapshot names are written over. An existing replica keeps its identity,
 * and process-local markers in older saves are discarded. The loader warns
 * about unregistered types.
 */
export function restoreEntity(world: World, snapshot: EntitySnapshot, into?: Entity): Entity {
    const e = into ?? world.spawn(snapshot.name || undefined);
    for (const comp of snapshot.components) {
        const definition = getComponent(comp.type);
        if (PROCESS_STATE.has(definition?._name ?? comp.type)) continue;
        if (definition?._name === 'Replicated') {
            if (into === undefined || !world.has(e, definition)) loadComponent(world, e, replicaSnapshot(comp), snapshot.name);
        } else {
            loadComponent(world, e, { type: comp.type, data: cloneJsonValue(comp.data) }, snapshot.name);
        }
    }
    return e;
}
