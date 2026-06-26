// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sceneInstance.ts
 * @brief   Prefab instance ⇄ scene-delta boundary (the canonical expand/collapse core)
 *
 * A prefab instance is persisted as a DELTA over its prefab asset and lives,
 * once loaded, as EXPANDED ordinary entities. This module is the lossless
 * boundary between the two, built on the engine's own prefab data layer
 * (`flattenPrefab` / `diffAgainstSource`):
 *
 *   expand:   prefab asset + delta  →  flat instance entities
 *   collapse: flat instance entities →  delta
 *
 * It is the SINGLE source for that transform — both the runtime scene loader
 * (`scene.ts` `loadSceneWithAssets`, for `play == ship`) and the editor's
 * model layer build on it, so the two never diverge.
 *
 * A `{prefab, overrides}` pair alone is NOT enough — `PrefabOverride` cannot
 * express structural edits — so the delta also carries `added` (entities added
 * under the instance) and `removed` (prefab children deleted in the instance),
 * sourced from `diffAgainstSource`'s `untracked` / `orphanedSourceIds`. Both
 * structural buckets reference entities by stable `prefabEntityId`, so the round
 * trip survives the id reallocation that `flattenPrefab` performs.
 *
 * Pure data (no World / wasm) — unit-testable as the data-loss safety net.
 */

import { flattenPrefab } from './flatten';
import { diffAgainstSource } from './diff';
import { cloneComponents } from './clone';
import { PREFAB_FORMAT_VERSION } from './migrate';
import type {
    PrefabData,
    PrefabEntityData,
    PrefabOverride,
    PrefabEntityId,
    ProcessedEntity,
    ComponentData,
} from './types';

/** Sync nested-prefab resolver passed through to `flattenPrefab`. */
export type SyncPrefabResolver = (path: string) => PrefabData | null;

const NO_NESTED: SyncPrefabResolver = () => null;

/** An entity added under a prefab instance (not part of the prefab asset). */
export interface AddedEntity {
    /** Stable instance-local identity (its prefabEntityId — absent from the asset). */
    prefabEntityId: PrefabEntityId;
    name: string;
    components: ComponentData[];
    visible: boolean;
    /** Parent by stable id — a prefab entity OR another added entity; null = under the instance root. */
    parentId: PrefabEntityId | null;
}

/** The persisted form of a prefab instance: a minimal delta over the asset. */
export interface PrefabInstanceDelta {
    /** `@uuid:` ref to the prefab asset. */
    prefab: string;
    /** Property / component / name / visibility / metadata edits. */
    overrides: PrefabOverride[];
    /** Entities added under the instance (not in the asset). */
    added: AddedEntity[];
    /** Prefab children deleted in this instance (by their asset prefabEntityId). */
    removed: PrefabEntityId[];
}

/** A prefab instance as it lives in the scene FILE: a delta + where it attaches. */
export interface PrefabInstanceEntry extends PrefabInstanceDelta {
    /** The instance root's stable scene source id. */
    id: number;
    /** The instance root's scene parent (its attach point), or null = scene root. */
    parent: number | null;
}

/**
 * Expand a prefab asset + instance delta into flat instance entities, allocating
 * ids via `allocateId`. Reuses `flattenPrefab` (which applies the overrides),
 * drops `removed` prefab entities, and appends `added` entities re-linked by
 * their stable parent id. `loadPrefab` resolves nested prefab refs (callers that
 * know the prefab is flat may omit it).
 */
export function expandInstance(
    prefab: PrefabData,
    delta: PrefabInstanceDelta,
    allocateId: () => number,
    loadPrefab: SyncPrefabResolver = NO_NESTED,
): { entities: ProcessedEntity[]; rootId: number } {
    const { entities, rootId } = flattenPrefab(prefab, delta.overrides, {
        allocateId,
        loadPrefab,
    });

    const removed = new Set(delta.removed);
    const kept = entities.filter((e) => !removed.has(e.prefabEntityId));

    // prefabEntityId → runtime id, for both kept prefab entities and added ones.
    const idByPrefabId = new Map<PrefabEntityId, number>();
    for (const e of kept) idByPrefabId.set(e.prefabEntityId, e.id);

    // Allocate added ids first so parent refs resolve regardless of order.
    const added: ProcessedEntity[] = delta.added.map((a) => {
        const id = allocateId();
        idByPrefabId.set(a.prefabEntityId, id);
        return {
            id,
            prefabEntityId: a.prefabEntityId,
            name: a.name,
            parent: rootId,
            children: [],
            components: a.components,
            visible: a.visible,
        };
    });
    delta.added.forEach((a, i) => {
        added[i].parent = a.parentId != null ? (idByPrefabId.get(a.parentId) ?? rootId) : rootId;
    });

    const all = [...kept, ...added];
    rebuildChildren(all);
    return { entities: all, rootId };
}

/** Rebuild every entity's `children` array from its `parent` link (consistency). */
export function rebuildChildren(entities: ProcessedEntity[]): void {
    const byId = new Map(entities.map((e) => [e.id, e]));
    for (const e of entities) e.children = [];
    for (const e of entities) {
        if (e.parent != null) byId.get(e.parent)?.children.push(e.id);
    }
}

/**
 * Collapse expanded instance entities back to a delta. `diffAgainstSource`
 * yields the override list + the structural buckets (`untracked` → added,
 * `orphanedSourceIds` → removed), with added parents recorded by stable id.
 */
export function collapseInstance(
    prefab: PrefabData,
    prefabRef: string,
    expanded: readonly ProcessedEntity[],
): PrefabInstanceDelta {
    const { overrides, untracked, orphanedSourceIds } = diffAgainstSource(prefab, expanded);
    const byId = new Map(expanded.map((e) => [e.id, e]));
    const added: AddedEntity[] = untracked.map((u) => ({
        prefabEntityId: u.prefabEntityId,
        name: u.name,
        components: u.components,
        visible: u.visible,
        parentId: u.parent != null ? (byId.get(u.parent)?.prefabEntityId ?? null) : null,
    }));
    return { prefab: prefabRef, overrides, added, removed: orphanedSourceIds };
}

// ── Scene-entry boundary ────────────────────────────────────────────────────
// A prefab instance is ONE entry in the scene file and an expanded subtree in
// the loaded scene. The instance root keeps a stable scene id across save/load
// (other entities may parent to it); the internal entities are re-allocated each
// load.

/**
 * Expand a scene instance entry into flat entities: flatten the asset + delta,
 * pin the instance root to the entry's stable `id` (re-allocating only the
 * internal entities), and attach the root under the entry's scene `parent`.
 */
export function expandEntry(
    prefab: PrefabData,
    entry: PrefabInstanceEntry,
    allocateId: () => number,
    loadPrefab: SyncPrefabResolver = NO_NESTED,
): { entities: ProcessedEntity[]; rootId: number } {
    const { entities, rootId } = expandInstance(prefab, entry, allocateId, loadPrefab);
    // Pin the root to the persisted scene id (external refs target it); internal
    // entities keep their fresh ids. Remap the root id + any parent pointing at it.
    for (const e of entities) {
        if (e.id === rootId) e.id = entry.id;
        if (e.parent === rootId) e.parent = entry.id;
    }
    const root = entities.find((e) => e.id === entry.id);
    if (root) root.parent = entry.parent; // attach under the scene parent
    rebuildChildren(entities);
    return { entities, rootId: entry.id };
}

/**
 * Collapse an expanded instance subtree (root `rootId`, attached under
 * `sceneParent`) back to a scene entry — the inverse of {@link expandEntry}.
 */
export function collapseEntry(
    prefab: PrefabData,
    prefabRef: string,
    expanded: readonly ProcessedEntity[],
    rootId: number,
    sceneParent: number | null,
): PrefabInstanceEntry {
    return { id: rootId, parent: sceneParent, ...collapseInstance(prefab, prefabRef, expanded) };
}

// ── Authoring: live entities → a new prefab asset ───────────────────────────

/** A scene/model entity subtree, as fed to {@link extractPrefab} (id-keyed). */
export interface ExtractEntity {
    id: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible?: boolean;
}

/**
 * Build a fresh {@link PrefabData} from a live entity subtree (the inverse of
 * instantiation — "Create Prefab from selection"). Source ids are remapped to
 * stable string `prefabEntityId`s (root first → rootEntityId), parent/child
 * links are remapped within the subtree (the root detaches → parent null), and
 * components are deep-cloned so the asset owns its own data. Emits the current
 * prefab format, so no migration runs on load.
 *
 * NOTE: component fields that REFERENCE another entity by id are left as-is —
 * remapping internal entity links to prefab ids is a later refinement; the
 * common case (no intra-prefab entity refs) round-trips exactly.
 */
export function extractPrefab(
    entities: readonly ExtractEntity[],
    rootId: number,
    name: string,
): PrefabData {
    // Root first so it gets a deterministic id and reads first in the file.
    const ordered = [...entities].sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : 0));
    const idMap = new Map<number, string>();
    ordered.forEach((e, i) => idMap.set(e.id, String(i)));
    const inSubtree = (sid: number | null): boolean => sid != null && idMap.has(sid);

    const prefabEntities: PrefabEntityData[] = ordered.map((e) => ({
        prefabEntityId: idMap.get(e.id)!,
        name: e.name,
        parent: e.id === rootId ? null : inSubtree(e.parent) ? idMap.get(e.parent!)! : null,
        children: e.children.filter((c) => idMap.has(c)).map((c) => idMap.get(c)!),
        components: cloneComponents(e.components),
        visible: e.visible ?? true,
    }));

    return {
        version: PREFAB_FORMAT_VERSION,
        name,
        rootEntityId: idMap.get(rootId)!,
        entities: prefabEntities,
    };
}
