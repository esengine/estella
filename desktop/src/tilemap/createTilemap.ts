// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    createTilemap.ts
 * @brief   Spawn a scene-embedded TilemapLayer entity from an .estileset —
 *          the Unity/Godot model: the tilemap is a real,
 *          paintable entity, the tileset is the reusable asset it references.
 */

import { parseTileset, collidableTileIds } from 'esengine';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { EditorHistory } from '@/engine/EditorHistory';
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

  // Preload the atlas texture so the Reconciler resolves its handle and the
  // TilemapSyncSystem (which needs a non-zero texture + dims) initializes the layer.
  const texInfo = ProjectStore.assetInfo(asset.texture);
  if (texInfo) await ProjectStore.assetRefForPath(texInfo.path, 'texture');

  const sourceId = SceneCommands.addEntity();
  if (sourceId == null) return;
  SceneCommands.addComponent(sourceId, 'TilemapLayer');
  SceneCommands.beginGesture('Configure Tilemap');
  SceneCommands.setField(sourceId, 'TilemapLayer', 'cellSize', 'vec2', [asset.tileWidth, asset.tileHeight]);
  SceneCommands.setField(sourceId, 'TilemapLayer', 'tileset', 'string', asset.texture); // texture @uuid → handle
  SceneCommands.setField(sourceId, 'TilemapLayer', 'tilesetColumns', 'number', asset.columns);
  // The .estileset link (editor palette restore + T4 runtime collision). Not a C++
  // field — carried losslessly in the model like the chunks blob.
  SceneCommands.setField(sourceId, 'TilemapLayer', 'tilesetAsset', 'string', tilesetRef);
  SceneCommands.endGesture();

  // Bake the tileset's collidable tile ids onto the layer (out-of-band model data the
  // runtime reads to spawn colliders — T4). Its own undo step so redo restores it.
  const collIds = collidableTileIds(asset);
  if (collIds.length > 0) {
    SceneModel.setField(sourceId, 'TilemapLayer', 'collidableTileIds', collIds);
    EditorHistory.record(
      'Bake Tilemap Collision',
      () => SceneModel.setField(sourceId, 'TilemapLayer', 'collidableTileIds', collIds),
      () => SceneModel.setField(sourceId, 'TilemapLayer', 'collidableTileIds', []),
    );
  }

  useSelection.getState().select(sourceId);
  useTilemapPaint.getState().setTileset(tilesetPath);
  useTilemapPaint.getState().setTool('brush');
  dockApi.revealAndExpand('tilemap');
  Toasts.push('已创建瓦片地图 — 选择刷子在视口绘制', 'info');
}
