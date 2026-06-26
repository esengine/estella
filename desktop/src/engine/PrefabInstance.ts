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
  const out: SceneEntity[] = [];
  const tags: Array<{ id: number; tag: InstanceTag }> = [];
  for (const raw of scene.entities as unknown[]) {
    if (!isPrefabEntry(raw)) {
      out.push(raw as SceneEntity);
      continue;
    }
    const prefab = await loadPrefab(raw.prefab);
    if (!prefab) continue; // unresolved prefab — skip (caller warns)
    const { entities, rootId } = expandEntry(prefab, raw, allocateId);
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
    const prefab = rootTag?.prefab ? await loadPrefab(rootTag.prefab) : null;
    if (!rootTag?.prefab || !prefab || !root) {
      out.push(...group); // not a resolvable instance — keep raw (lossless)
      continue;
    }
    const processed = group.map((e) => toProcessed(e, tagOf(e.id)!.prefabId));
    const entry = collapseEntry(prefab, rootTag.prefab, processed, rootId, root.parent ?? null) as unknown as SceneEntity;
    // Carry the instance root's outliner folder onto the collapsed entry (lossless).
    const folder = (root as { folder?: string }).folder;
    if (folder) (entry as { folder?: string }).folder = folder;
    out.push(entry);
  }
  return out;
}
