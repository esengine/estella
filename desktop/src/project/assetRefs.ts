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
