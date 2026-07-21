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
import { diffEntities } from './diff';
import type { DiffBaselineEntity } from './diff';
import { cloneComponents } from './clone';
import { applyOverridesToSource } from './override';
import { getComponent } from '../component';
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

    // `removed` records the ROOTS of deleted subtrees; expand the transitive
    // closure over the flattened tree so deleting a parent drops its whole
    // subtree (no orphaned, parent-less entities survive).
    const removed = removedClosure(entities, delta.removed);
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
 * The full set of stable ids to drop for a `removed` list of subtree roots:
 * each root plus every descendant, walked over the flattened entities' parent
 * links (in composed-address space, so it cascades through nested boundaries).
 */
function removedClosure(
    entities: readonly ProcessedEntity[],
    removedRoots: readonly PrefabEntityId[],
): Set<PrefabEntityId> {
    const addrById = new Map(entities.map((e) => [e.id, e.prefabEntityId]));
    const childrenByAddr = new Map<PrefabEntityId, PrefabEntityId[]>();
    for (const e of entities) {
        if (e.parent == null) continue;
        const parentAddr = addrById.get(e.parent);
        if (parentAddr === undefined) continue;
        const list = childrenByAddr.get(parentAddr);
        if (list) list.push(e.prefabEntityId);
        else childrenByAddr.set(parentAddr, [e.prefabEntityId]);
    }
    const closure = new Set<PrefabEntityId>();
    const queue = [...removedRoots];
    while (queue.length > 0) {
        const cur = queue.shift()!;
        if (closure.has(cur)) continue;
        closure.add(cur);
        for (const child of childrenByAddr.get(cur) ?? []) queue.push(child);
    }
    return closure;
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
    loadPrefab: SyncPrefabResolver = NO_NESTED,
): PrefabInstanceDelta {
    const { entities: baseline, parentOf } = collapseBaseline(prefab, loadPrefab);
    const { overrides, untracked, orphanedSourceIds } = diffEntities(baseline, expanded);
    const byId = new Map(expanded.map((e) => [e.id, e]));
    const added: AddedEntity[] = untracked.map((u) => ({
        prefabEntityId: u.prefabEntityId,
        name: u.name,
        components: u.components,
        visible: u.visible,
        parentId: u.parent != null ? (byId.get(u.parent)?.prefabEntityId ?? null) : null,
    }));
    // Record only the ROOTS of removed subtrees (a deleted entity whose baseline
    // parent is still present); expand recomputes the descendant closure.
    const removedSet = new Set(orphanedSourceIds);
    const removed = orphanedSourceIds.filter((id) => {
        const p = parentOf.get(id);
        return p == null || !removedSet.has(p);
    });
    return { prefab: prefabRef, overrides, added, removed };
}

/**
 * The pristine baseline to diff a collapsed instance against, plus each baseline
 * entity's parent (in stable-id space) for subtree-root minimisation. A FLAT
 * prefab's own `entities` list already IS that baseline (entity refs in
 * prefab-local id space); a nested prefab is flattened so its children exist in
 * composed-address space — `loadPrefab` resolves the nested refs synchronously,
 * so callers with nested prefabs must preload them.
 */
function collapseBaseline(
    prefab: PrefabData,
    loadPrefab: SyncPrefabResolver,
): { entities: DiffBaselineEntity[]; parentOf: Map<PrefabEntityId, PrefabEntityId | null> } {
    const hasNested = !!prefab.basePrefab || prefab.entities.some((e) => e.nestedPrefab);
    if (!hasNested) {
        const parentOf = new Map<PrefabEntityId, PrefabEntityId | null>();
        for (const e of prefab.entities) parentOf.set(e.prefabEntityId, e.parent);
        return { entities: prefab.entities, parentOf };
    }
    let nid = 0;
    const flat = flattenPrefab(prefab, [], { allocateId: () => nid++, loadPrefab }).entities;
    const addrById = new Map(flat.map((e) => [e.id, e.prefabEntityId]));
    const parentOf = new Map<PrefabEntityId, PrefabEntityId | null>();
    for (const e of flat) {
        parentOf.set(e.prefabEntityId, e.parent != null ? (addrById.get(e.parent) ?? null) : null);
    }
    return { entities: flat, parentOf };
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
    loadPrefab: SyncPrefabResolver = NO_NESTED,
): PrefabInstanceEntry {
    return { id: rootId, parent: sceneParent, ...collapseInstance(prefab, prefabRef, expanded, loadPrefab) };
}

// ── Apply-to-Prefab: fold a whole instance delta back into the asset ─────────

/** The structural + property parts of a delta applied by {@link applyDeltaToSource}. */
export interface SourceDelta {
    overrides: readonly PrefabOverride[];
    added: readonly AddedEntity[];
    removed: readonly PrefabEntityId[];
}

/**
 * Bake a complete instance delta into a prefab's source — the STRUCTURAL
 * "Apply to Prefab". `applyOverridesToSource` only folds property/component/
 * name/visibility/metadata edits; this also inserts `added` entities (linked
 * under their parent) and deletes `removed` subtree roots and their descendants
 * (never the prefab root), so an instance's structural changes truly enter the
 * asset. Pure: `source` is not mutated. Nested-scoped ids (composed `slot/…`
 * addresses) that don't exist on this source are skipped — structural apply
 * targets the top-level asset.
 */
export function applyDeltaToSource(source: PrefabData, delta: SourceDelta): PrefabData {
    // 1. Property / component / name / visibility / metadata overrides.
    let next = applyOverridesToSource(source, delta.overrides);

    // 2. Removed: drop each removed subtree root + descendants (never the root),
    //    and unlink them from any parent's children list.
    if (delta.removed.length > 0) {
        const childrenOf = new Map<PrefabEntityId, PrefabEntityId[]>();
        for (const e of next.entities) childrenOf.set(e.prefabEntityId, e.children);
        const remove = new Set<PrefabEntityId>();
        const queue = delta.removed.filter((id) => id !== next.rootEntityId);
        while (queue.length > 0) {
            const cur = queue.shift()!;
            if (remove.has(cur)) continue;
            remove.add(cur);
            for (const c of childrenOf.get(cur) ?? []) queue.push(c);
        }
        if (remove.size > 0) {
            next = {
                ...next,
                entities: next.entities
                    .filter((e) => !remove.has(e.prefabEntityId))
                    .map((e) => ({ ...e, children: e.children.filter((c) => !remove.has(c)) })),
            };
        }
    }

    // 3. Added: append new entities and link each under its parent (root default).
    if (delta.added.length > 0) {
        const entities: PrefabEntityData[] = next.entities.map((e) => ({ ...e, children: [...e.children] }));
        const byId = new Map<PrefabEntityId, PrefabEntityData>();
        for (const e of entities) byId.set(e.prefabEntityId, e);
        for (const a of delta.added) {
            const entity: PrefabEntityData = {
                prefabEntityId: a.prefabEntityId,
                name: a.name,
                parent: a.parentId ?? next.rootEntityId,
                children: [],
                components: cloneComponents([...a.components]),
                visible: a.visible,
            };
            entities.push(entity);
            byId.set(a.prefabEntityId, entity);
        }
        for (const a of delta.added) {
            const parent = byId.get(a.parentId ?? next.rootEntityId);
            if (parent && !parent.children.includes(a.prefabEntityId)) parent.children.push(a.prefabEntityId);
        }
        next = { ...next, entities };
    }

    return next;
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
 * Component fields that REFERENCE another entity (declared via the component's
 * `entityFields` metadata) are remapped to prefab-local ids when the target is
 * inside the subtree; instantiation maps them back (see remapComponentEntityRefs).
 * A reference pointing outside the subtree is left numeric and will dangle.
 */
/** Capture-side twin of remapComponentEntityRefs: runtime id → prefab-local id. */
function captureEntityRefs(
    components: ComponentData[],
    idMap: Map<number, string>,
): ComponentData[] {
    for (const comp of components) {
        const def = getComponent(comp.type);
        if (!def || def.entityFields.length === 0) continue;
        for (const field of def.entityFields) {
            const value = comp.data[field];
            if (typeof value === 'number' && idMap.has(value)) {
                comp.data[field] = idMap.get(value)!;
            }
        }
    }
    return components;
}

export function extractPrefab(
    entities: readonly ExtractEntity[],
    rootId: number,
    name: string,
    makeId: () => PrefabEntityId = () => crypto.randomUUID(),
): PrefabData {
    // Root first so it reads first in the file. Ids are minted by `makeId`
    // (UUIDs by default) so a newly authored prefab's entity identities are
    // globally unique — two prefabs, or two instantiations of one, never share
    // a `prefabEntityId` and so never collide when nested (see PREFAB_ADDRESS_SEP).
    const ordered = [...entities].sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : 0));
    const idMap = new Map<number, string>();
    ordered.forEach((e) => idMap.set(e.id, makeId()));
    const inSubtree = (sid: number | null): boolean => sid != null && idMap.has(sid);

    const prefabEntities: PrefabEntityData[] = ordered.map((e) => ({
        prefabEntityId: idMap.get(e.id)!,
        name: e.name,
        parent: e.id === rootId ? null : inSubtree(e.parent) ? idMap.get(e.parent!)! : null,
        children: e.children.filter((c) => idMap.has(c)).map((c) => idMap.get(c)!),
        components: captureEntityRefs(cloneComponents(e.components), idMap),
        visible: e.visible ?? true,
    }));

    return {
        version: PREFAB_FORMAT_VERSION,
        name,
        rootEntityId: idMap.get(rootId)!,
        entities: prefabEntities,
    };
}
