// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetRefs.ts
 * @brief Reverse lookup over the asset dependency graph — "which scenes/prefabs
 *        reference this asset" — so deleting an in-use asset can warn first. The
 *        graph (`deps`) is built main-side (assetDb) expressly for delete-detection;
 *        this is the pure, testable consumer.
 */

/** The structural slice of the asset index this needs (uuid↔path + dep edges). */
export interface AssetIndexLike {
  entries: Array<{ uuid: string; path: string }>;
  deps: Record<string, string[]>;
}

/**
 * Project-relative paths of the scenes/prefabs that reference the asset at `path`.
 * Empty if `path` isn't a tracked asset (e.g. a folder) or nothing references it.
 */
export function referencingPaths(index: AssetIndexLike, path: string): string[] {
  const target = index.entries.find((e) => e.path === path)?.uuid;
  if (!target) return [];
  const byUuid = new Map(index.entries.map((e) => [e.uuid, e.path]));
  const out: string[] = [];
  for (const [uuid, refs] of Object.entries(index.deps)) {
    if (!refs.includes(target)) continue;
    const p = byUuid.get(uuid);
    if (p && p !== path) out.push(p);
  }
  return out;
}

/** One asset/scene that references the asset being inspected or deleted. */
export interface AssetUsage {
  /** Project-relative path of the referencing document; null = the unsaved,
   *  still-untitled scene (it exists only in memory). */
  path: string | null;
  /** The reference lives in the unsaved in-memory scene, not (yet) on disk. */
  unsaved: boolean;
}

/**
 * Whether a JSON tree (a scene/asset document) references the asset identified
 * by `uuid` (as `@uuid:` or a bare uuid string) or by its exact project path
 * (path-valued slots, e.g. spine skeleton/atlas).
 */
export function valueReferencesAsset(
  value: unknown,
  target: { uuid: string | null; path: string },
): boolean {
  const uuid = target.uuid?.toLowerCase() ?? null;
  const walk = (v: unknown): boolean => {
    if (typeof v === 'string') {
      if (v === target.path) return true;
      if (!uuid) return false;
      const body = v.startsWith('@uuid:') ? v.slice('@uuid:'.length) : v;
      return body.toLowerCase() === uuid;
    }
    if (Array.isArray(v)) return v.some(walk);
    if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).some(walk);
    return false;
  };
  return walk(value);
}

/**
 * The full usage list for the asset at `path`: the on-disk dependency graph
 * (saved scenes/prefabs/materials/…) plus the UNSAVED in-memory scene — the
 * dep graph is built from files, so a reference added since the last save is
 * invisible to it and deleting would still break the open scene.
 */
export function collectAssetUsages(
  index: AssetIndexLike,
  path: string,
  liveScene?: { path: string | null; data: unknown } | null,
): AssetUsage[] {
  const disk: AssetUsage[] = referencingPaths(index, path).map((p) => ({ path: p, unsaved: false }));
  if (!liveScene?.data) return disk;
  const uuid = index.entries.find((e) => e.path === path)?.uuid ?? null;
  if (!valueReferencesAsset(liveScene.data, { uuid, path })) return disk;
  // A saved copy of the same scene already reports it — one row per document.
  if (liveScene.path && disk.some((d) => d.path === liveScene.path)) return disk;
  return [...disk, { path: liveScene.path, unsaved: true }];
}
