// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    deferredInstances.ts
 * @brief   Which entities of a world are virtual instances not yet opened, and what each would be made from.
 *
 * Loading a scene that has virtual prefab instances (prefab/deferred.ts) makes only their roots. This is where those roots are
 * remembered: per world, by entity, so that `UIPages` (or any caller) can open one when it is wanted. A record goes with its entity:
 * once the entity is despawned there is nothing to open.
 */
import type { DeferredRecord } from '../prefab/deferred';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

const records = new WeakMap<World, Map<Entity, DeferredRecord>>();

/**
 * Whether the page was asked to make virtual instances whole (`?expand-virtual` in its address): a switch for looking at a game as
 * the editor shows it (an authoring preview, a pixel check of every page) and for ruling virtual instances in or out when something
 * is wrong. A page without an address (a test host, a device) answers no.
 */
export function expandVirtualRequested(): boolean {
    try {
        return new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').has('expand-virtual');
    } catch {
        return false;
    }
}

/** Remember the virtual instances a scene was loaded with: `entities` is the scene's id -> entity map the load answered. */
export function registerDeferredInstances(world: World, list: readonly DeferredRecord[] | undefined, entities: ReadonlyMap<number, Entity>): void {
    if (!list || list.length === 0) return;
    let own = records.get(world);
    if (!own) records.set(world, own = new Map());
    for (const record of list) {
        const entity = entities.get(record.id);
        if (entity === undefined) continue;
        own.set(entity, record);
    }
}

/** What `entity` would be made from, if it is a virtual instance. */
export function deferredRecord(world: World, entity: Entity): DeferredRecord | undefined {
    const own = records.get(world);
    const record = own?.get(entity);
    if (record === undefined) return undefined;
    if (!world.valid(entity)) { own!.delete(entity); return undefined; }
    return record;
}

/** Every virtual instance of the world, in the order they were registered. */
export function deferredEntities(world: World): Entity[] {
    const own = records.get(world);
    if (!own) return [];
    const out: Entity[] = [];
    for (const entity of [...own.keys()]) { if (world.valid(entity)) out.push(entity); else own.delete(entity); }
    return out;
}
