// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    deferred.ts
 * @brief   Virtual prefab instances: seen when authoring, made when they are used.
 *
 * An instance whose root carries `deferred: true` in its metadata is a virtual node. The editor shows it expanded like any other
 * instance (nothing about authoring changes: it can be looked at, selected and edited without running anything), but a scene
 * that is loaded to run makes only its root, in the place it has, and keeps a record of what the rest would be made from. The
 * contents are made when somebody asks for them (`UIPages`, or `openDeferred`), under that same root.
 *
 * The mark is ordinary prefab metadata, so it can be set where it belongs: on a prefab's root (every use of the prefab is
 * virtual), on a nested slot (that mounting is), or as an override on one instance in a scene (that instance is).
 */
import type { PrefabData, PrefabOverride, ProcessedEntity } from './types';

/** The metadata key that makes an instance virtual. */
export const DEFERRED_KEY = 'deferred';

/** What stands in for a virtual instance until it is opened. `id` is the entity the root was made as. */
export interface DeferredRecord {
    id: number;
    /** The prefab the contents come from. */
    prefab: string;
    /** The overrides the instance carries, in the prefab's own address space. */
    overrides: PrefabOverride[];
}

/** Whether the instance of `prefab` with `overrides` is virtual: the root's mark as the prefab has it and the overrides leave it. */
export function isDeferredInstance(prefab: PrefabData, overrides: readonly PrefabOverride[]): boolean {
    const root = prefab.entities.find((e) => e.prefabEntityId === prefab.rootEntityId);
    let marked = root?.metadata?.[DEFERRED_KEY] === true;
    for (const o of overrides) {
        if (o.prefabEntityId !== prefab.rootEntityId || o.metadataKey !== DEFERRED_KEY) continue;
        if (o.type === 'metadata_set') marked = o.value === true;
        else if (o.type === 'metadata_removed') marked = false;
    }
    return marked;
}

/** Whether an instance's overrides only touch what a root-only stand-in has. Anything that moves entities about cannot wait. */
export function canDefer(overrides: readonly PrefabOverride[], prefab: PrefabData): boolean {
    return !overrides.some((o) => o.type === 'parent' && o.prefabEntityId !== prefab.rootEntityId);
}

/**
 * The prefab cut down to its root, with no children and no nested slots: what a virtual instance is made as. Null for a variant,
 * whose root is only known once its base has been merged; the caller then flattens it whole and cuts the result.
 */
export function rootOnly(prefab: PrefabData): PrefabData | null {
    if (prefab.basePrefab) return null;
    const root = prefab.entities.find((e) => e.prefabEntityId === prefab.rootEntityId);
    if (!root || root.nestedPrefab) return null;
    return { ...prefab, entities: [{ ...root, children: [] }] };
}

/** Overrides that address the root itself: the only ones a root-only stand-in can use. */
export function rootOverrides(prefab: PrefabData, overrides: readonly PrefabOverride[]): PrefabOverride[] {
    return overrides.filter((o) => o.prefabEntityId === prefab.rootEntityId);
}

/** An expanded instance cut down to its root: the same root, no children, nothing else. */
export function cutToRoot(entities: readonly ProcessedEntity[], rootId: number): ProcessedEntity[] {
    const root = entities.find((e) => e.id === rootId);
    return root ? [{ ...root, children: [] }] : [];
}
