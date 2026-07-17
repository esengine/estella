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
import { createFromSource, tilemapPrefab, type EntitySource, type TileGridConfig } from '@/engine/entitySources';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { ProjectStore } from '@/project/ProjectStore';
import { dockApi } from '@/layout/dockApi';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

/**
 * An EntitySource for a specific .estileset: cellSize is seeded from the tileset's tile
 * size, and afterCreate links the tileset live + opens the painter. `tileWidth/Height`
 * are read from the already-parsed tileset so `build` stays synchronous.
 */
function tilesetSource(
  tilesetPath: string, tilesetRef: string, tileWidth: number, tileHeight: number, grid?: TileGridConfig,
): EntitySource {
  return {
    id: `tileset:${tilesetPath}`,
    label: 'Tilemap',
    category: '2D',
    icon: Grid3x3,
    // tilesetRef bakes the link into the prefab; the Reconciler live-pushes it on
    // spawn/redo, so the map is a single undoable create with no wiring step.
    build: () => tilemapPrefab('Tilemap', { x: tileWidth, y: tileHeight }, tilesetRef, grid),
    afterCreate: (_ctx, rootId) => {
      useSelection.getState().select(rootId);
      useTilemapPaint.getState().setTileset(tilesetPath);
      useTilemapPaint.getState().setTool('brush');
      // Dock the painter to the side so the Viewport stays visible (a center tab would
      // hide what you paint on).
      dockApi.openSidePanel('tilemap', 'tilemap', t('panel.tilemap'), 'left', 300);
      Toasts.push(t('tile.toast.created'), 'info');
    },
  };
}

/** Create a TilemapLayer entity referencing the given .estileset, select it, and start
 *  painting. `grid` sets the orientation/stagger layout (defaults to orthogonal). */
export async function createTilemapFromTileset(tilesetPath: string, grid?: TileGridConfig): Promise<void> {
  const tilesetRef = ProjectStore.assetRef(tilesetPath); // .estileset → @uuid
  if (!tilesetRef) {
    Toasts.push(t('tile.toast.untracked'), 'error');
    return;
  }
  let asset;
  try {
    asset = parseTileset(JSON.parse(await window.estella.fs.read(tilesetPath)));
  } catch (e) {
    Toasts.push(t('tile.toast.readFailed', { error: String(e) }), 'error');
    return;
  }
  await createFromSource(
    tilesetSource(tilesetPath, tilesetRef, asset.tileWidth, asset.tileHeight, grid), { parent: null },
  );
}
