// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetUsages.ts
 * @brief The impure glue over {@link collectAssetUsages}: scan the on-disk dep
 *        graph AND the live in-memory scene model, so both the delete confirm
 *        and Find Usages see references the last save doesn't know about yet.
 */
import { SceneModel } from '@/engine/SceneModel';
import { ProjectStore } from './ProjectStore';
import { collectAssetUsagesOfAll, type AssetUsage } from './assetRefs';

export type { AssetUsage };

/**
 * Everything referencing the asset at `path` (disk graph + unsaved scene).
 *
 * `preferCache` reads the already-built asset index instead of walking the disk —
 * for the passive ref-count badge that fires on every asset selection, where a
 * full main-process scan per click is wasteful. The authoritative walk (the
 * default) stays for the delete confirm and Find Usages, which must not miss a
 * reference. Falls back to the walk when there is no cache yet.
 */
export async function findAssetUsages(
  path: string,
  opts?: { preferCache?: boolean },
): Promise<AssetUsage[]> {
  return findAssetUsagesOfAll([path], opts);
}

/**
 * The same question asked of a whole selection, on ONE scan.
 *
 * Deleting from the Content Browser asked it per selected file, and the walk is
 * O(every file in the project) — seconds on an asset-heavy project, with the
 * main process blocked throughout. Twenty selected sprites meant twenty of those
 * back to back before the confirm dialog appeared at all, and a folder's worth
 * meant the editor did not come back.
 */
export async function findAssetUsagesOfAll(
  paths: readonly string[],
  opts?: { preferCache?: boolean },
): Promise<AssetUsage[]> {
  if (paths.length === 0) return [];
  const index = opts?.preferCache
    ? (await window.estella.project.cachedAssetIndex().catch(() => null))
        ?? (await window.estella.project.scanAssets()).index
    : (await window.estella.project.scanAssets()).index;
  const data = SceneModel.current;
  return collectAssetUsagesOfAll(
    index,
    paths,
    data ? { path: ProjectStore.getSnapshot()?.currentScene ?? null, data } : null,
  );
}
