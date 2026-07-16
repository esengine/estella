// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    layerTilesetModel.ts
 * @brief   Resolve a scene `TilemapLayer`'s `.estileset` reference(s) into the runtime
 *          {@link TilesetModel} — the SAME model `resolveTilesetModel` builds at Play, so
 *          the editor's tile-collision overlay draws exactly what will spawn. Kept out of
 *          `TilemapPlugin`'s private per-entity map (the plugin resolves for the running
 *          world; the editor re-resolves independently for a picture).
 */
import { resolveTilesetModel, type TilesetModel, type ResolvedTileset } from 'esengine';
import { SceneModel } from '@/engine/SceneModel';
import { ProjectStore } from '@/project/ProjectStore';
import { loadTilesetAsset } from '@/tileset/loadTileset';

/** The `.estileset` ref(s) a TilemapLayer entity references — its `tilesetAssets` list
 *  (multi-tileset) or singular `tilesetAsset`, as @uuid refs (paths resolved by the caller). */
export function layerTilesetRefs(sourceId: number | null): string[] {
  if (sourceId == null) return [];
  const layer = SceneModel.entityBySource(sourceId)?.components.find((c) => c.type === 'TilemapLayer');
  if (!layer) return [];
  const data = layer.data as Record<string, unknown>;
  const list = data.tilesetAssets;
  if (Array.isArray(list)) return list.filter((r): r is string => typeof r === 'string' && r !== '');
  return typeof data.tilesetAsset === 'string' && data.tilesetAsset ? [data.tilesetAsset] : [];
}

/** Natural pixel height of an image URL — lets a tileset's tile count (and thus its
 *  global firstId span) be derived when the asset has no explicit `tileCount`. */
function imageHeight(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight);
    img.onerror = () => resolve(0);
    img.src = url;
  });
}

/**
 * Load + resolve a layer's tileset refs into the runtime {@link TilesetModel}. The list
 * is resolved together (contiguous firstId ranges) exactly like the runtime; each atlas'
 * height is loaded only when the asset lacks a `tileCount`, so single-tileset layers
 * (firstId 1) never touch the network. Returns null when nothing resolves.
 */
export async function loadLayerTilesetModel(refs: string[]): Promise<TilesetModel | null> {
  const list: ResolvedTileset[] = [];
  for (const ref of refs) {
    const path = ProjectStore.assetInfo(ref)?.path;
    if (!path) continue;
    let asset;
    try {
      asset = await loadTilesetAsset(path);
    } catch {
      continue; // skip an unreadable tileset
    }
    let textureHeight: number | undefined;
    if (!(typeof asset.tileCount === 'number' && asset.tileCount > 0)) {
      const texPath = ProjectStore.assetInfo(asset.texture)?.path;
      if (texPath) {
        const h = await imageHeight(`estella://project/${texPath}`);
        if (h > 0) textureHeight = h;
      }
    }
    list.push({ asset, textureHandle: 0, textureHeight });
  }
  if (list.length === 0) return null;
  return resolveTilesetModel(list);
}
