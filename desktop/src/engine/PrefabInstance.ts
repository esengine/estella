import { flattenPrefab, diffAgainstSource } from 'esengine';
import type { PrefabData, PrefabOverride, ProcessedEntity, PrefabEntityId } from 'esengine';

/**
 * Prefab instance expand/collapse (REARCH_PREFABS.md §3-4, PF2 core).
 *
 * A prefab instance is persisted as a DELTA over its prefab asset and lives in
 * the editor model as EXPANDED entities. This module is the lossless boundary
 * between the two, built on the engine's own prefab data layer
 * (`flattenPrefab` / `diffAgainstSource`):
 *
 *   expand:   prefab asset + delta  →  flat instance entities (for the SceneModel)
 *   collapse: flat instance entities →  delta (for the scene file)
 *
 * A `{prefab, overrides}` pair alone is NOT enough — `PrefabOverride` cannot
 * express structural edits — so the delta also carries `added` (entities added
 * under the instance) and `removed` (prefab children deleted in the instance),
 * sourced from `diffAgainstSource`'s `untracked` / `orphanedSourceIds`. Both
 * structural buckets reference entities by stable `prefabEntityId`, so the round
 * trip survives the id reallocation that `flattenPrefab` performs.
 *
 * Pure data (no World / wasm) — unit-tested as the data-loss safety net before
 * the save path is wired.
 */

/** An entity added under a prefab instance (not part of the prefab asset). */
export interface AddedEntity {
  /** Stable instance-local identity (its prefabEntityId — absent from the asset). */
  prefabEntityId: PrefabEntityId;
  name: string;
  components: ProcessedEntity['components'];
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

/**
 * Expand a prefab asset + instance delta into flat instance entities, allocating
 * ids via `allocateId`. Reuses `flattenPrefab` (which applies the overrides),
 * drops `removed` prefab entities, and appends `added` entities re-linked by
 * their stable parent id. The returned entities are ready to map into the model.
 */
export function expandInstance(
  prefab: PrefabData,
  delta: PrefabInstanceDelta,
  allocateId: () => number,
): { entities: ProcessedEntity[]; rootId: number } {
  const { entities, rootId } = flattenPrefab(prefab, delta.overrides, {
    allocateId,
    loadPrefab: () => null, // nested prefabs: PF2-later
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
function rebuildChildren(entities: ProcessedEntity[]): void {
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

// ── Scene ⇄ model boundary ──────────────────────────────────────────────────
// A prefab instance is ONE entry in the scene file and an expanded subtree in
// the model. The instance root keeps a stable scene id across save/load (other
// entities may parent to it); the internal entities are re-allocated each load.

/** A prefab instance as it lives in the scene FILE: a delta + where it attaches. */
export interface PrefabInstanceEntry extends PrefabInstanceDelta {
  /** The instance root's stable scene source id. */
  id: number;
  /** The instance root's scene parent (its attach point), or null = scene root. */
  parent: number | null;
}

/**
 * Expand a scene instance entry into model entities: flatten the asset + delta,
 * pin the instance root to the entry's stable `id` (re-allocating only the
 * internal entities), and attach the root under the entry's scene `parent`.
 */
export function expandEntry(
  prefab: PrefabData,
  entry: PrefabInstanceEntry,
  allocateId: () => number,
): { entities: ProcessedEntity[]; rootId: number } {
  const { entities, rootId } = expandInstance(prefab, entry, allocateId);
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
