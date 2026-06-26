// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tileTools.ts
 * @brief The tilemap paint tools — brush / erase / rect / eyedropper. Active only
 *        when a TilemapLayer is selected (the host resolves that); each operates on the
 *        selected layer via SceneCommands' tile-paint stroke API. The brush is a
 *        {@link TileStamp}, so a single click stamps a 1×1 tile and a palette marquee
 *        stamps a whole pattern (with per-cell flip/rotate flags preserved).
 */
import {
  TilemapAPI, tileIdOf, encodeTile, singleStamp, type TileStamp,
  buildTerrainIndices, resolveAutotile, TERRAIN_NEIGHBORS, type TerrainIndices,
} from 'esengine';
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands, type TilePaint } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint, type PaintTool } from '@/store/tilemapPaintStore';
import type { EditorTool, PointerInput } from './EditorTool';

// Cursor (client px) → tile grid coords on a TilemapLayer entity: client→world via
// the editor camera, then world→tile around the layer's world origin (its Transform).
function cursorTile(clientX: number, clientY: number, sourceId: number): { x: number; y: number } | null {
  const rt = SceneModel.runtimeFor(sourceId);
  const wp = ViewportController.canvasToWorld(clientX, clientY);
  const ep = rt != null ? ViewportController.getEntityXY(rt) : null;
  if (rt == null || !wp || !ep) return null;
  const t = TilemapAPI.worldToTile(rt, wp.x, wp.y, ep.x, ep.y);
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
}

const selectedTilemap = (): number | null => useSelection.getState().selectedId;
const activeStamp = (): TileStamp => useTilemapPaint.getState().stamp;

/** Edits for the non-empty cells of `stamp` anchored (top-left) at tile (ox, oy). */
function stampEdits(stamp: TileStamp, ox: number, oy: number): TilePaint[] {
  const edits: TilePaint[] = [];
  for (let dy = 0; dy < stamp.h; dy++) {
    for (let dx = 0; dx < stamp.w; dx++) {
      const raw = stamp.cells[dy * stamp.w + dx];
      if (tileIdOf(raw) === 0) continue; // sparse — empty cells leave the map untouched
      edits.push({ x: ox + dx, y: oy + dy, tileId: raw });
    }
  }
  return edits;
}

/** Brush: stamps the active pattern as a live stroke (one undo step). */
function makeBrushTool(): EditorTool {
  let stroke: { sourceId: number; last: string } | null = null;
  const stampAt = (id: number, ox: number, oy: number) => {
    for (const e of stampEdits(activeStamp(), ox, oy)) {
      SceneCommands.paintTileLive(id, e.x, e.y, e.tileId);
    }
  };
  return {
    id: 'tilemap.brush',
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      SceneCommands.beginTilePaint(selId);
      stampAt(selId, tile.x, tile.y);
      stroke = { sourceId: selId, last: `${tile.x},${tile.y}` };
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile) return;
      const key = `${tile.x},${tile.y}`;
      if (key === stroke.last) return;
      stampAt(stroke.sourceId, tile.x, tile.y);
      stroke.last = key;
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      SceneCommands.endTilePaint();
      stroke = null;
    },
    cancel() {
      if (!stroke) return;
      // No mid-stroke tile rollback yet; commit what is painted (matches pointercancel).
      SceneCommands.endTilePaint();
      stroke = null;
    },
  };
}

/** Erase: clears the cell under the cursor — a live stroke, one undo step. */
function makeEraseTool(): EditorTool {
  let stroke: { sourceId: number; last: string } | null = null;
  return {
    id: 'tilemap.erase',
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      SceneCommands.beginTilePaint(selId);
      SceneCommands.paintTileLive(selId, tile.x, tile.y, 0);
      stroke = { sourceId: selId, last: `${tile.x},${tile.y}` };
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile) return;
      const key = `${tile.x},${tile.y}`;
      if (key === stroke.last) return;
      SceneCommands.paintTileLive(stroke.sourceId, tile.x, tile.y, 0);
      stroke.last = key;
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      SceneCommands.endTilePaint();
      stroke = null;
    },
    cancel() {
      if (!stroke) return;
      SceneCommands.endTilePaint();
      stroke = null;
    },
  };
}

/** Rect fill: drag a rectangle, tile the active stamp across it on release (one step). */
function makeRectTool(): EditorTool {
  let stroke: { sourceId: number; startX: number; startY: number } | null = null;
  return {
    id: 'tilemap.rect',
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      stroke = { sourceId: selId, startX: tile.x, startY: tile.y };
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove() {
      // Rect previews on release (no live fill) — matches the prior behavior.
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (tile) {
        const x0 = Math.min(stroke.startX, tile.x);
        const x1 = Math.max(stroke.startX, tile.x);
        const y0 = Math.min(stroke.startY, tile.y);
        const y1 = Math.max(stroke.startY, tile.y);
        const stamp = activeStamp();
        const edits: TilePaint[] = [];
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const raw = stamp.cells[((y - y0) % stamp.h) * stamp.w + ((x - x0) % stamp.w)];
            if (tileIdOf(raw) === 0) continue;
            edits.push({ x, y, tileId: raw });
          }
        }
        if (edits.length > 0) SceneCommands.paintTiles(stroke.sourceId, edits);
      }
      stroke = null;
    },
    cancel() {
      stroke = null;
    },
  };
}

/**
 * Terrain brush: paint a logical terrain and autotile. Each painted cell joins the active
 * terrain; the cell and its 8 neighbours are re-resolved against the tileset's terrain
 * rules, so the right edge/corner tile is chosen automatically. A cell's terrain is the
 * in-stroke assignment if painted, else reverse-derived from its current tile.
 */
function makeTerrainTool(): EditorTool {
  let stroke:
    | { sourceId: number; rt: number; set: number; indices: TerrainIndices; assigned: Map<string, number> }
    | null = null;

  const terrainAt = (s: NonNullable<typeof stroke>, x: number, y: number): number | null => {
    const key = `${x},${y}`;
    if (s.assigned.has(key)) return s.assigned.get(key)!;
    const id = tileIdOf(TilemapAPI.getTile(s.rt, x, y));
    return s.indices.tileTerrain.get(id) ?? null;
  };

  const recompute = (s: NonNullable<typeof stroke>, x: number, y: number) => {
    const set = terrainAt(s, x, y);
    if (set == null) return;
    const index = s.indices.sets.get(set);
    if (!index) return;
    const neighbors = TERRAIN_NEIGHBORS.map((n) => terrainAt(s, x + n.dx, y + n.dy) === set);
    const tileId = resolveAutotile(index, neighbors);
    if (tileId > 0) SceneCommands.paintTileLive(s.sourceId, x, y, encodeTile(tileId));
  };

  const stampTerrain = (s: NonNullable<typeof stroke>, x: number, y: number) => {
    s.assigned.set(`${x},${y}`, s.set);
    recompute(s, x, y);
    for (const n of TERRAIN_NEIGHBORS) recompute(s, x + n.dx, y + n.dy);
  };

  return {
    id: 'tilemap.terrain',
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const rt = SceneModel.runtimeFor(selId);
      const ps = useTilemapPaint.getState();
      const asset = ps.tilesetAsset;
      if (rt == null || !asset) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      const indices = buildTerrainIndices(asset);
      if (!indices.sets.has(ps.terrainSet)) return false; // active terrain has no tiles yet
      SceneCommands.beginTilePaint(selId);
      stroke = { sourceId: selId, rt, set: ps.terrainSet, indices, assigned: new Map() };
      stampTerrain(stroke, tile.x, tile.y);
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile || stroke.assigned.has(`${tile.x},${tile.y}`)) return;
      stampTerrain(stroke, tile.x, tile.y);
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      SceneCommands.endTilePaint();
      stroke = null;
    },
    cancel() {
      if (!stroke) return;
      SceneCommands.endTilePaint();
      stroke = null;
    },
  };
}

/** Eyedropper: one-shot — read the raw cell (id + flip flags) under the cursor into the brush. */
const eyedropperTool: EditorTool = {
  id: 'tilemap.eyedropper',
  onPointerDown(p) {
    const selId = selectedTilemap();
    if (selId == null) return false;
    const tile = cursorTile(p.clientX, p.clientY, selId);
    if (!tile) return false;
    const rt = SceneModel.runtimeFor(selId);
    const raw = rt != null ? TilemapAPI.getTile(rt, tile.x, tile.y) : 0;
    if (tileIdOf(raw) > 0) useTilemapPaint.getState().setStamp(singleStamp(raw));
    return false; // no ongoing stroke
  },
  onPointerMove() {},
  onPointerUp() {},
};

/** Tile tools keyed by PaintTool (brush/erase/rect/eyedropper). */
export const TILE_TOOLS: Record<PaintTool, EditorTool> = {
  brush: makeBrushTool(),
  erase: makeEraseTool(),
  rect: makeRectTool(),
  eyedropper: eyedropperTool,
  terrain: makeTerrainTool(),
};

export type { PointerInput };
