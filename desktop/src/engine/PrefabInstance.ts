// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expandEntry, collapseEntry } from 'esengine';
import type {
  PrefabData,
  ProcessedEntity,
  PrefabEntityId,
  SceneData,
  PrefabInstanceEntry,
} from 'esengine';

/**
 * Prefab instance scene⇄model boundary (editor side).
 *
 * The pure expand/collapse DELTA core — `expandInstance` / `collapseInstance` /
 * `expandEntry` / `collapseEntry` and the `PrefabInstanceDelta` /
 * `PrefabInstanceEntry` / `AddedEntity` types — now lives in the ENGINE
 * (`esengine`, sdk/src/prefab/sceneInstance.ts) so the editor and the runtime
 * scene loader (`loadSceneWithAssets` — play == ship) share
 * ONE implementation and can never diverge. This module re-exports that core
 * and adds the editor-only layer on top: the SceneModel's per-entity instance
 * TAGS and the tag-producing whole-scene expand/collapse the ProjectStore runs
 * on load/save.
 *
 * (The runtime's own whole-scene expansion is `expandScenePrefabs` in the engine
 * `scene.ts` — tag-free, since the runtime never saves. The editor keeps its own
 * tagging variant below because the model must collapse instances back on save.)
 */

// Re-export the shared delta core so existing `@/engine/PrefabInstance` imports
// keep resolving (single source — the implementation is in the engine).
export { expandInstance, collapseInstance, expandEntry, collapseEntry } from 'esengine';
export type { AddedEntity, PrefabInstanceDelta, PrefabInstanceEntry } from 'esengine';

type SceneEntity = SceneData['entities'][number];

/** A prefab-instance tag carried by each expanded model entity (origin + grouping). */
export interface InstanceTag {
  instanceRoot: number;
  prefabId: PrefabEntityId;
  prefab?: string; // set only on the instance root
}

// ── Scene file ⇄ model (whole-scene expand/collapse over a prefab loader) ────
// Load EXPANDS each prefab-instance entry into ordinary tagged entities; save
// COLLAPSES each tagged instance subtree back to one entry. The prefab loader is
// injected (ProjectStore reads `.esprefab` via the AssetDatabase) so this stays
// pure + unit-testable.

type LoadPrefab = (ref: string) => Promise<PrefabData | null>;

/**
 * A LOCAL prefab snapshot for one whole-scene expand/collapse pass: `warm(ref)`
 * loads a prefab plus its transitive variant bases / nested refs into an owned
 * map; `resolve(ref)` reads that map SYNChronously (what flattenPrefab needs for
 * variant / nested expansion). The map is local — NOT the shared ProjectStore
 * cache — so a concurrent asset revalidation that clears that cache mid-pass
 * can't pull a variant's base out from under an in-flight flatten.
 */
function prefabSnapshot(loadPrefab: LoadPrefab): {
  warm: (ref: string) => Promise<void>;
  resolve: (ref: string) => PrefabData | null;
} {
  const map = new Map<string, PrefabData>();
  const warm = async (ref: string): Promise<void> => {
    if (map.has(ref)) return;
    const p = await loadPrefab(ref);
    if (!p) return;
    map.set(ref, p);
    if (p.basePrefab) await warm(p.basePrefab);
    for (const e of p.entities) {
      const nested = e.nestedPrefab?.prefabPath;
      if (nested) await warm(nested);
    }
  };
  return { warm, resolve: (ref) => map.get(ref) ?? null };
}

/** A prefab-instance entry as it appears in a scene file (carries a `prefab` ref). */
function isPrefabEntry(e: unknown): e is PrefabInstanceEntry {
  return !!e && typeof e === 'object' && typeof (e as { prefab?: unknown }).prefab === 'string';
}

const toSceneEntity = (e: ProcessedEntity): SceneEntity =>
  ({ id: e.id, name: e.name, parent: e.parent, children: e.children, components: e.components, visible: e.visible }) as unknown as SceneEntity;

const toProcessed = (e: SceneEntity, prefabId: PrefabEntityId): ProcessedEntity => ({
  id: e.id,
  prefabEntityId: prefabId,
  name: e.name,
  parent: e.parent,
  children: e.children,
  components: e.components as ProcessedEntity['components'],
  visible: e.visible ?? true,
});

/**
 * Expand a scene's prefab-instance entries into ordinary entities + their tags.
 * Non-prefab entities pass through. An unresolvable prefab ref drops the entry
 * (logged by the caller). Returns the fully-expanded scene + the tags to apply.
 */
export async function expandScenePrefabs(
  scene: SceneData,
  loadPrefab: LoadPrefab,
  allocateId: () => number,
): Promise<{ scene: SceneData; tags: Array<{ id: number; tag: InstanceTag }> }> {
  const snap = prefabSnapshot(loadPrefab);
  const out: SceneEntity[] = [];
  const tags: Array<{ id: number; tag: InstanceTag }> = [];
  for (const raw of scene.entities as unknown[]) {
    if (!isPrefabEntry(raw)) {
      out.push(raw as SceneEntity);
      continue;
    }
    await snap.warm(raw.prefab); // load the instance prefab + all its deps into the local snapshot
    const prefab = snap.resolve(raw.prefab);
    if (!prefab) continue; // unresolved prefab — skip (caller warns)
    // expandEntry resolves variant bases / nested refs SYNChronously from the snapshot.
    const { entities, rootId } = expandEntry(prefab, raw, allocateId, snap.resolve);
    for (const pe of entities) {
      const se = toSceneEntity(pe);
      // The instance entry carries the outliner folder of its root (editor-only,
      // dropped by the prefab core) — re-attach it so folders survive load.
      if (pe.id === rootId) {
        const folder = (raw as { folder?: string }).folder;
        if (folder) (se as { folder?: string }).folder = folder;
      }
      out.push(se);
      tags.push({
        id: pe.id,
        tag: { instanceRoot: rootId, prefabId: pe.prefabEntityId, prefab: pe.id === rootId ? raw.prefab : undefined },
      });
    }
  }
  return { scene: { ...scene, entities: out } as SceneData, tags };
}

/**
 * Collapse a model's prefab-instance subtrees back to one entry each (the inverse
 * of {@link expandScenePrefabs}). `tagOf` is the model's instance-tag lookup;
 * non-instance entities pass through.
 */
export async function collapseScenePrefabs(
  entities: readonly SceneEntity[],
  tagOf: (id: number) => InstanceTag | undefined,
  loadPrefab: LoadPrefab,
): Promise<SceneEntity[]> {
  const snap = prefabSnapshot(loadPrefab);
  const groups = new Map<number, SceneEntity[]>();
  const out: SceneEntity[] = [];
  for (const e of entities) {
    const tag = tagOf(e.id);
    if (!tag) {
      out.push(e);
      continue;
    }
    const g = groups.get(tag.instanceRoot);
    if (g) g.push(e);
    else groups.set(tag.instanceRoot, [e]);
  }
  for (const [rootId, group] of groups) {
    const rootTag = tagOf(rootId);
    const root = group.find((e) => e.id === rootId);
    if (rootTag?.prefab) await snap.warm(rootTag.prefab);
    const prefab = rootTag?.prefab ? snap.resolve(rootTag.prefab) : null;
    if (!rootTag?.prefab || !prefab || !root) {
      out.push(...group); // not a resolvable instance — keep raw (lossless)
      continue;
    }
    const processed = group.map((e) => toProcessed(e, tagOf(e.id)!.prefabId));
    // collapseEntry re-flattens the prefab for its baseline; the resolver expands
    // a variant base / nested refs so a variant instance round-trips on save.
    const entry = collapseEntry(prefab, rootTag.prefab, processed, rootId, root.parent ?? null, snap.resolve) as unknown as SceneEntity;
    // Carry the instance root's outliner folder onto the collapsed entry (lossless).
    const folder = (root as { folder?: string }).folder;
    if (folder) (entry as { folder?: string }).folder = folder;
    out.push(entry);
  }
  return out;
}
