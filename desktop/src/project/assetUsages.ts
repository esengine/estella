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
import { collectAssetUsages, type AssetUsage } from './assetRefs';

export type { AssetUsage };

/** Everything referencing the asset at `path` (disk graph + unsaved scene). */
export async function findAssetUsages(path: string): Promise<AssetUsage[]> {
  const scan = await window.estella.project.scanAssets();
  const data = SceneModel.current;
  return collectAssetUsages(
    scan.index,
    path,
    data ? { path: ProjectStore.getSnapshot()?.currentScene ?? null, data } : null,
  );
}
