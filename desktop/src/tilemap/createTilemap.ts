// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    createTilemap.ts
 * @brief   Spawn a scene-embedded TilemapLayer entity from an .estileset —
 *          the Unity/Godot model: the tilemap is a real,
 *          paintable entity, the tileset is the reusable asset it references.
 */

import { parseTileset } from 'esengine';
import { SceneCommands } from '@/engine/SceneCommands';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { ProjectStore } from '@/project/ProjectStore';
import { dockApi } from '@/layout/dockApi';
import { Toasts } from '@/store/Toasts';

/** Create a TilemapLayer entity referencing the given .estileset, select it, and start painting. */
export async function createTilemapFromTileset(tilesetPath: string): Promise<void> {
  const tilesetRef = ProjectStore.assetRef(tilesetPath); // .estileset → @uuid
  if (!tilesetRef) {
    Toasts.push('该瓦片集未被项目追踪', 'error');
    return;
  }
  let asset;
  try {
    asset = parseTileset(JSON.parse(await window.estella.fs.read(tilesetPath)));
  } catch (e) {
    Toasts.push(`读取瓦片集失败：${String(e)}`, 'error');
    return;
  }

  const sourceId = SceneCommands.addEntity();
  if (sourceId == null) return;
  SceneCommands.addComponent(sourceId, 'TilemapLayer');
  SceneCommands.beginGesture('Configure Tilemap');
  // cellSize is a per-layer authoring choice SEEDED from the tileset's tile size;
  // everything else — render table (texture/columns), animations, collision —
  // derives LIVE from the .estileset reference (tilemap sync resolves it and calls
  // setTilesets), so editing the tileset updates every map that references it.
  // The old flow copied texture/columns onto the component and baked
  // collidableTileIds into the model: three snapshots that went stale the moment
  // the tileset changed.
  SceneCommands.setField(sourceId, 'TilemapLayer', 'cellSize', 'vec2', [asset.tileWidth, asset.tileHeight]);
  SceneCommands.endGesture();
  // The .estileset link. Not a C++ field — carried losslessly in the model like the
  // chunks blob. setLayerTilesets also pushes it to the runtime plugin live (the
  // reconciler can't project an out-of-band field), so the fresh layer resolves its
  // render table and is paintable immediately, without a reload.
  SceneCommands.setLayerTilesets(sourceId, [tilesetRef]);

  useSelection.getState().select(sourceId);
  useTilemapPaint.getState().setTileset(tilesetPath);
  useTilemapPaint.getState().setTool('brush');
  // The painter is a palette companion to viewport painting — dock it to the side
  // so the Viewport stays visible (a center tab would hide what you paint on).
  dockApi.openSidePanel('tilemap', 'tilemap', 'Tilemap', 'left', 300);
  Toasts.push('已创建瓦片地图 — 选择刷子在视口绘制', 'info');
}
