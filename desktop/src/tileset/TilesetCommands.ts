// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilesetCommands.ts
 * @brief   Undoable mutations on the open .estileset.
 *          Each routes through TilesetDocument.edit → one EditorHistory snapshot step;
 *          the panel never mutates the asset directly.
 */

import { serializeTileset } from 'esengine';
import type { TilesetAsset, TilesetTerrain, TerrainMode } from 'esengine';
import { TilesetDocument } from './TilesetDocument';
import { Toasts } from '@/store/Toasts';

type GridPatch = Partial<Pick<TilesetAsset, 'tileWidth' | 'tileHeight' | 'margin' | 'spacing' | 'columns'>>;

/** Drop a tile entry that no longer carries any metadata, keeping the map sparse. */
function pruneEmpty(asset: TilesetAsset, id: number): void {
  const t = asset.tiles[id];
  if (t && !t.collision && !t.properties && !t.animation && !t.terrain) delete asset.tiles[id];
}

export const TilesetCommands = {
  /** Edit the atlas grid geometry (tile size / margin / spacing / columns). */
  setGrid(patch: GridPatch): void {
    TilesetDocument.edit('Edit Tile Grid', (a) => {
      for (const k of Object.keys(patch) as (keyof GridPatch)[]) {
        const v = patch[k];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) a[k] = Math.floor(v);
      }
      // tile size / columns must stay positive.
      if (a.tileWidth < 1) a.tileWidth = 1;
      if (a.tileHeight < 1) a.tileHeight = 1;
      if (a.columns < 1) a.columns = 1;
    });
  },

  /** Set box collision on/off for a set of tiles as ONE undo step (a paint stroke). */
  paintCollision(tileIds: number[], on: boolean): void {
    if (tileIds.length === 0) return;
    TilesetDocument.edit(on ? 'Add Tile Collision' : 'Remove Tile Collision', (a) => {
      for (const id of tileIds) {
        if (id <= 0) continue;
        if (on) a.tiles[id] = { ...(a.tiles[id] ?? {}), collision: { type: 'box' } };
        else if (a.tiles[id]?.collision) {
          delete a.tiles[id].collision;
          pruneEmpty(a, id);
        }
      }
    });
  },

  /** Add a terrain (autotile) set; returns the new set's index. */
  addTerrain(name: string, mode: TerrainMode): void {
    TilesetDocument.edit('Add Terrain', (a) => {
      const terrains = a.terrains ?? (a.terrains = []);
      terrains.push({ name: name || `Terrain ${terrains.length + 1}`, mode });
    });
  },

  /** Edit a terrain set's name / mode / color. */
  updateTerrain(set: number, patch: Partial<TilesetTerrain>): void {
    TilesetDocument.edit('Edit Terrain', (a) => {
      const t = a.terrains?.[set];
      if (!t) return;
      if (typeof patch.name === 'string') t.name = patch.name;
      if (patch.mode === 'edge' || patch.mode === 'corner') t.mode = patch.mode;
      if (typeof patch.color === 'string') t.color = patch.color;
    });
  },

  /** Remove a terrain set, dropping its tiles' membership and reindexing higher sets. */
  removeTerrain(set: number): void {
    TilesetDocument.edit('Remove Terrain', (a) => {
      if (!a.terrains?.[set]) return;
      a.terrains.splice(set, 1);
      for (const key of Object.keys(a.tiles)) {
        const id = Number(key);
        const tt = a.tiles[id].terrain;
        if (!tt) continue;
        if (tt.set === set) { delete a.tiles[id].terrain; pruneEmpty(a, id); }
        else if (tt.set > set) tt.set -= 1;
      }
      if (a.terrains.length === 0) delete a.terrains;
    });
  },

  /**
   * Set a tile's terrain membership + peering mask as ONE undo step. `set === null`
   * removes the tile from any terrain.
   */
  setTileTerrain(id: number, set: number | null, mask: number): void {
    if (id <= 0) return;
    TilesetDocument.edit('Edit Tile Terrain', (a) => {
      if (set === null) {
        if (a.tiles[id]?.terrain) { delete a.tiles[id].terrain; pruneEmpty(a, id); }
        return;
      }
      a.tiles[id] = { ...(a.tiles[id] ?? {}), terrain: { set, mask: mask & 0xff } };
    });
  },

  /** Persist the open tileset to its file. */
  async save(): Promise<void> {
    const asset = TilesetDocument.asset;
    const path = TilesetDocument.filePath;
    if (!asset || !path) return;
    try {
      await window.estella.fs.write(path, JSON.stringify(serializeTileset(asset), null, 2) + '\n');
      TilesetDocument.markSaved();
      Toasts.push('已保存瓦片集', 'info');
    } catch (e) {
      Toasts.push(`保存瓦片集失败：${String(e)}`, 'error');
    }
  },
};
