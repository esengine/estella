// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    createTilemap.ts
 * @brief   Spawn a scene-embedded TilemapLayer entity from an .estileset through the
 *          unified create pipeline (REARCH ENTITY_CREATION E3): `build` yields the
 *          Transform+TilemapLayer prefab (cellSize seeded from the tileset, one undo
 *          step); `afterCreate` links the tileset (out-of-band + live-push, its own
 *          undoable 'Set Tilesets' step so redo re-pushes) and opens the painter. The
 *          tileset stays the reusable asset the map references (Unity/Godot model).
 */
import { parseTileset } from 'esengine';
import { Grid3x3 } from 'lucide-react';
import { SceneCommands } from '@/engine/SceneCommands';
import { createFromSource, tilemapPrefab, type EntitySource } from '@/engine/entitySources';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { ProjectStore } from '@/project/ProjectStore';
import { dockApi } from '@/layout/dockApi';
import { Toasts } from '@/store/Toasts';

/**
 * An EntitySource for a specific .estileset: cellSize is seeded from the tileset's tile
 * size, and afterCreate links the tileset live + opens the painter. `tileWidth/Height`
 * are read from the already-parsed tileset so `build` stays synchronous.
 */
function tilesetSource(tilesetPath: string, tilesetRef: string, tileWidth: number, tileHeight: number): EntitySource {
  return {
    id: `tileset:${tilesetPath}`,
    label: 'Tilemap',
    category: '2D',
    icon: Grid3x3,
    build: () => tilemapPrefab('Tilemap', { x: tileWidth, y: tileHeight }),
    afterCreate: (_ctx, rootId) => {
      // The .estileset link is out-of-band (carried in the model like the chunks blob).
      // setLayerTilesets writes it AND live-pushes to the plugin so the fresh layer
      // resolves its render table and is paintable immediately. It records its own
      // 'Set Tilesets' undo step, so redo re-pushes (no reload needed).
      SceneCommands.setLayerTilesets(rootId, [tilesetRef]);
      useSelection.getState().select(rootId);
      useTilemapPaint.getState().setTileset(tilesetPath);
      useTilemapPaint.getState().setTool('brush');
      // Dock the painter to the side so the Viewport stays visible (a center tab would
      // hide what you paint on).
      dockApi.openSidePanel('tilemap', 'tilemap', 'Tilemap', 'left', 300);
      Toasts.push('Created tilemap — pick a brush to paint in the viewport', 'info');
    },
  };
}

/** Create a TilemapLayer entity referencing the given .estileset, select it, and start painting. */
export async function createTilemapFromTileset(tilesetPath: string): Promise<void> {
  const tilesetRef = ProjectStore.assetRef(tilesetPath); // .estileset → @uuid
  if (!tilesetRef) {
    Toasts.push('Tileset is not tracked by the project', 'error');
    return;
  }
  let asset;
  try {
    asset = parseTileset(JSON.parse(await window.estella.fs.read(tilesetPath)));
  } catch (e) {
    Toasts.push(`Failed to read tileset: ${String(e)}`, 'error');
    return;
  }
  await createFromSource(tilesetSource(tilesetPath, tilesetRef, asset.tileWidth, asset.tileHeight), { parent: null });
}
