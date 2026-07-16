// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilesetCommands.ts
 * @brief   Undoable mutations on the open .estileset.
 *          Each routes through TilesetDocument.edit → one EditorHistory snapshot step;
 *          the panel never mutates the asset directly.
 */

import { serializeTileset } from 'esengine';
import type { TilesetAsset, TilesetTerrain, TerrainMode, TilesetAnimFrame } from 'esengine';
import { TilesetDocument } from './TilesetDocument';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

type GridPatch = Partial<Pick<TilesetAsset, 'tileWidth' | 'tileHeight' | 'margin' | 'spacing' | 'columns'>>;

/** Cross-cutting collision modifiers applied to whatever shape is painted/stamped. */
export interface TileCollisionMods {
  oneWay?: { nx: number; ny: number };
  sensor?: boolean;
  density?: number;
  friction?: number;
  restitution?: number;
}

/** Attach the present modifiers to a bare shape (absent ones stay at engine defaults). */
function withMods<T extends object>(shape: T, mods?: TileCollisionMods): T & TileCollisionMods {
  const out = { ...shape } as T & TileCollisionMods;
  if (!mods) return out;
  if (mods.oneWay) out.oneWay = mods.oneWay;
  if (mods.sensor) out.sensor = true;
  if (mods.density !== undefined) out.density = mods.density;
  if (mods.friction !== undefined) out.friction = mods.friction;
  if (mods.restitution !== undefined) out.restitution = mods.restitution;
  return out;
}

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

  /** Set box collision on/off for a set of tiles as ONE undo step (a paint stroke).
   *  `mods` (one-way / sensor / material) ride along on the painted boxes. */
  paintCollision(tileIds: number[], on: boolean, mods?: TileCollisionMods): void {
    if (tileIds.length === 0) return;
    TilesetDocument.edit(on ? 'Add Tile Collision' : 'Remove Tile Collision', (a) => {
      for (const id of tileIds) {
        if (id <= 0) continue;
        if (on) a.tiles[id] = { ...(a.tiles[id] ?? {}), collision: withMods({ type: 'box' as const }, mods) };
        else if (a.tiles[id]?.collision) {
          delete a.tiles[id].collision;
          pruneEmpty(a, id);
        }
      }
    });
  },

  /**
   * Set a tile's polygon collision outline (tile-local pixels) as ONE undo step. Fewer
   * than 3 points clears any polygon collision on the tile (parseTileset would drop it).
   */
  setTilePolygon(id: number, points: [number, number][], mods?: TileCollisionMods): void {
    if (id <= 0) return;
    TilesetDocument.edit('Edit Tile Collision Shape', (a) => {
      if (points.length >= 3) {
        a.tiles[id] = { ...(a.tiles[id] ?? {}), collision: withMods({ type: 'polygon' as const, points }, mods) };
      } else if (a.tiles[id]?.collision?.type === 'polygon') {
        delete a.tiles[id].collision;
        pruneEmpty(a, id);
      }
    });
  },

  /** Set a tile's circle collision (tile-local pixels) as ONE undo step; r ≤ 0 clears it. */
  setTileCircle(id: number, cx: number, cy: number, r: number, mods?: TileCollisionMods): void {
    if (id <= 0) return;
    TilesetDocument.edit('Edit Tile Collision Shape', (a) => {
      if (r > 0) {
        a.tiles[id] = { ...(a.tiles[id] ?? {}), collision: withMods({ type: 'circle' as const, cx, cy, r }, mods) };
      } else if (a.tiles[id]?.collision?.type === 'circle') {
        delete a.tiles[id].collision;
        pruneEmpty(a, id);
      }
    });
  },

  /** Stamp the same polygon onto a set of tiles as ONE undo step (preset drag-paint). */
  stampPolygons(tileIds: number[], points: [number, number][], mods?: TileCollisionMods): void {
    if (tileIds.length === 0 || points.length < 3) return;
    TilesetDocument.edit('Stamp Tile Collision', (a) => {
      for (const id of tileIds) {
        if (id <= 0) continue;
        const copy = points.map((p) => [p[0], p[1]] as [number, number]);
        a.tiles[id] = { ...(a.tiles[id] ?? {}), collision: withMods({ type: 'polygon' as const, points: copy }, mods) };
      }
    });
  },

  /** Stamp (on) or clear (off) a fitted circle on a set of tiles as ONE undo step. */
  stampCircles(tileIds: number[], on: boolean, cx: number, cy: number, r: number, mods?: TileCollisionMods): void {
    if (tileIds.length === 0) return;
    TilesetDocument.edit(on ? 'Stamp Tile Collision' : 'Remove Tile Collision', (a) => {
      for (const id of tileIds) {
        if (id <= 0) continue;
        if (on) {
          a.tiles[id] = { ...(a.tiles[id] ?? {}), collision: withMods({ type: 'circle' as const, cx, cy, r }, mods) };
        } else if (a.tiles[id]?.collision?.type === 'circle') {
          delete a.tiles[id].collision;
          pruneEmpty(a, id);
        }
      }
    });
  },

  /** Replace a tile's custom properties as ONE undo step; an empty record clears them. */
  setTileProperties(id: number, props: Record<string, string>): void {
    if (id <= 0) return;
    TilesetDocument.edit('Edit Tile Properties', (a) => {
      const clean = Object.fromEntries(Object.entries(props).filter(([k]) => k.trim() !== ''));
      if (Object.keys(clean).length > 0) {
        a.tiles[id] = { ...(a.tiles[id] ?? {}), properties: clean };
      } else if (a.tiles[id]?.properties) {
        delete a.tiles[id].properties;
        pruneEmpty(a, id);
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

  /**
   * Replace a tile's animation frame list as ONE undo step. An empty (or
   * all-invalid) list clears the animation; frames are sanitized to positive
   * integer tile ids and durations.
   */
  setTileAnimation(id: number, frames: TilesetAnimFrame[]): void {
    if (id <= 0) return;
    TilesetDocument.edit('Edit Tile Animation', (a) => {
      const clean = frames
        .filter((f) => f.tile > 0 && f.durationMs > 0)
        .map((f) => ({ tile: Math.floor(f.tile), durationMs: Math.round(f.durationMs) }));
      if (clean.length > 0) {
        a.tiles[id] = { ...(a.tiles[id] ?? {}), animation: clean };
      } else if (a.tiles[id]?.animation) {
        delete a.tiles[id].animation;
        pruneEmpty(a, id);
      }
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
      Toasts.push(t('tile.toast.saved'), 'info');
    } catch (e) {
      Toasts.push(t('tile.toast.saveFailed', { error: String(e) }), 'error');
    }
  },
};
