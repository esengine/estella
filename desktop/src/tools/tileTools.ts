// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tileTools.ts
 * @brief The tilemap paint tools — brush / erase / rect / line / bucket / eyedropper /
 *        terrain. Active only when a TilemapLayer is selected (the host resolves that);
 *        each operates on the selected layer via SceneCommands' tile-paint stroke API.
 *        The brush is a {@link TileStamp}, so a single click stamps a 1×1 tile and a
 *        palette marquee stamps a whole pattern (with per-cell flip/rotate flags).
 *        Drag tools (brush/erase/terrain) share one stroke driver; gesture tools
 *        (rect/line/bucket) commit once on release.
 */
import {
  TilemapAPI, tileIdOf, encodeTile, singleStamp, type TileStamp,
  buildTerrainIndices, resolveAutotile, TERRAIN_NEIGHBORS, type TerrainIndices,
} from 'esengine';
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands, type TilePaint } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint, type PaintTool } from '@/store/tilemapPaintStore';
import { TilePaintPreview } from './tilePreview';
import type { EditorTool, PointerInput } from './EditorTool';

// Cursor (client px) → tile grid coords on a TilemapLayer entity: client→world via
// the editor camera, then world→tile around the layer's world origin (its Transform).
export function cursorTile(clientX: number, clientY: number, sourceId: number): { x: number; y: number } | null {
  const rt = SceneModel.runtimeFor(sourceId);
  const wp = ViewportController.canvasToWorld(clientX, clientY);
  const ep = rt != null ? ViewportController.getEntityWorldXY(rt) : null;
  if (rt == null || !wp || !ep) return null;
  const t = TilemapAPI.worldToTile(rt, wp.x, wp.y, ep.x, ep.y);
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
}

const selectedTilemap = (): number | null => useSelection.getState().selectedId;
const activeStamp = (): TileStamp => useTilemapPaint.getState().stamp;
const mod = (n: number, m: number): number => ((n % m) + m) % m;

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

/** The stamp cell to lay at world tile (x, y) when tiling the pattern continuously. */
function tiledCell(stamp: TileStamp, x: number, y: number): number {
  return stamp.cells[mod(y, stamp.h) * stamp.w + mod(x, stamp.w)];
}

/** The stamp's non-empty cells — the random mode's sampling pool. */
function stampPool(stamp: TileStamp): number[] {
  return stamp.cells.filter((c) => tileIdOf(c) !== 0);
}

/** Point-tool edits at (x, y): the stamp footprint, or ONE sampled tile in random mode.
 *  Exported for tests (like lineCells). */
export function brushEdits(stamp: TileStamp, x: number, y: number): TilePaint[] {
  if (useTilemapPaint.getState().randomBrush) {
    const pool = stampPool(stamp);
    return pool.length ? [{ x, y, tileId: pool[(Math.random() * pool.length) | 0] }] : [];
  }
  return stampEdits(stamp, x, y);
}

/** Area-tool cell chooser: pattern-tiled normally, per-cell random sample in random mode.
 *  Exported for tests (like lineCells). */
export function cellPicker(stamp: TileStamp): (x: number, y: number) => number {
  if (useTilemapPaint.getState().randomBrush) {
    const pool = stampPool(stamp);
    return pool.length ? () => pool[(Math.random() * pool.length) | 0] : () => 0;
  }
  return (x, y) => tiledCell(stamp, x, y);
}

/**
 * The tile coords inside the ellipse inscribed in the (x0,y0)-(x1,y1) box (inclusive,
 * unordered corners). Cell centers test against the ellipse equation with the radii
 * pulled in a quarter-cell (w/2 − 0.25) — the classic pixel-circle tweak, so a 3×3
 * reads as a plus (corners out) instead of a filled square while 2×2 stays full.
 * Exported for tests (like lineCells).
 */
export function ellipseCells(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = Math.max(0.25, (maxX - minX + 1) / 2 - 0.25);
  const ry = Math.max(0.25, (maxY - minY + 1) / 2 - 0.25);
  const cells: { x: number; y: number }[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) cells.push({ x, y });
    }
  }
  return cells;
}

/** The tile coords a Bresenham line from (x0,y0) to (x1,y1) passes through (inclusive). */
export function lineCells(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return cells;
}

// ── Shared drag-stroke driver ────────────────────────────────────────────────
// begin() opens a per-stroke context (null aborts); onCell() runs once per newly
// entered tile during press+drag; end() commits. Used by brush/erase/terrain.
interface StrokeSpec<C> {
  id: string;
  begin(sourceId: number): C | null;
  onCell(ctx: C, x: number, y: number): void;
  end(ctx: C): void;
}

function makeStrokeTool<C>(spec: StrokeSpec<C>): EditorTool {
  let active: { ctx: C; sourceId: number; last: { x: number; y: number } } | null = null;
  return {
    id: spec.id,
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      const c = spec.begin(selId);
      if (c == null) return false;
      spec.onCell(c, tile.x, tile.y);
      active = { ctx: c, sourceId: selId, last: { x: tile.x, y: tile.y } };
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!active) return;
      const tile = cursorTile(p.clientX, p.clientY, active.sourceId);
      if (!tile) return;
      if (tile.x === active.last.x && tile.y === active.last.y) return;
      // Fill every cell from the last sample to this one so a fast drag can't skip cells
      // (Bresenham). `last` is already painted, so drop the first point of the line.
      for (const c of lineCells(active.last.x, active.last.y, tile.x, tile.y).slice(1)) {
        spec.onCell(active.ctx, c.x, c.y);
      }
      active.last = { x: tile.x, y: tile.y };
    },
    onPointerUp(p, ctx) {
      if (!active) return;
      ctx.release(p.pointerId);
      spec.end(active.ctx);
      active = null;
    },
    cancel() {
      if (!active) return;
      // Discard the live drag: restore the pre-stroke chunk blob, no model write / no
      // undo step. brush/erase/terrain all open the stroke via beginTilePaint, so one
      // shared cancel covers them (their per-stroke ctx is dropped with `active`).
      SceneCommands.cancelTilePaint();
      active = null;
    },
  };
}

const brushTool = makeStrokeTool<number>({
  id: 'tilemap.brush',
  begin: (selId) => { SceneCommands.beginTilePaint(selId); return selId; },
  onCell: (selId, x, y) => {
    for (const e of brushEdits(activeStamp(), x, y)) SceneCommands.paintTileLive(selId, e.x, e.y, e.tileId);
  },
  end: () => SceneCommands.endTilePaint(),
});

const eraseTool = makeStrokeTool<number>({
  id: 'tilemap.erase',
  begin: (selId) => { SceneCommands.beginTilePaint(selId); return selId; },
  // Erase the active brush's footprint (its w×h), so a multi-tile stamp erases a
  // block — the eraser size matches the brush the palette shows.
  onCell: (selId, x, y) => {
    const s = activeStamp();
    for (let dy = 0; dy < s.h; dy++) {
      for (let dx = 0; dx < s.w; dx++) SceneCommands.paintTileLive(selId, x + dx, y + dy, 0);
    }
  },
  end: () => SceneCommands.endTilePaint(),
});

// ── Terrain (autotile) brush ─────────────────────────────────────────────────
interface TerrainCtx {
  sourceId: number;
  rt: number;
  set: number;
  indices: TerrainIndices;
  assigned: Map<string, number>;
}

function terrainAt(s: TerrainCtx, x: number, y: number): number | null {
  const key = `${x},${y}`;
  if (s.assigned.has(key)) return s.assigned.get(key)!;
  const id = tileIdOf(TilemapAPI.getTile(s.rt, x, y));
  return s.indices.tileTerrain.get(id) ?? null;
}

function recomputeTerrain(s: TerrainCtx, x: number, y: number): void {
  const set = terrainAt(s, x, y);
  if (set == null) return;
  const index = s.indices.sets.get(set);
  if (!index) return;
  const neighbors = TERRAIN_NEIGHBORS.map((n) => terrainAt(s, x + n.dx, y + n.dy) === set);
  const tileId = resolveAutotile(index, neighbors);
  if (tileId > 0) SceneCommands.paintTileLive(s.sourceId, x, y, encodeTile(tileId));
}

/** Join (x,y) to the active terrain, then re-resolve it and its 8 neighbours. */
function stampTerrain(s: TerrainCtx, x: number, y: number): void {
  s.assigned.set(`${x},${y}`, s.set);
  recomputeTerrain(s, x, y);
  for (const n of TERRAIN_NEIGHBORS) recomputeTerrain(s, x + n.dx, y + n.dy);
}

const terrainTool = makeStrokeTool<TerrainCtx>({
  id: 'tilemap.terrain',
  begin: (selId) => {
    const rt = SceneModel.runtimeFor(selId);
    const ps = useTilemapPaint.getState();
    const asset = ps.tilesetAsset;
    if (rt == null || !asset) return null;
    const indices = buildTerrainIndices(asset);
    if (!indices.sets.has(ps.terrainSet)) return null; // active terrain has no tiles yet
    SceneCommands.beginTilePaint(selId);
    return { sourceId: selId, rt, set: ps.terrainSet, indices, assigned: new Map() };
  },
  onCell: (s, x, y) => { if (!s.assigned.has(`${x},${y}`)) stampTerrain(s, x, y); },
  end: () => SceneCommands.endTilePaint(),
});

// ── Gesture tools (commit once on release / click) ───────────────────────────

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
      TilePaintPreview.set({ kind: 'rect', x0: tile.x, y0: tile.y, x1: tile.x, y1: tile.y });
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile) return;
      TilePaintPreview.set({ kind: 'rect', x0: stroke.startX, y0: stroke.startY, x1: tile.x, y1: tile.y });
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      TilePaintPreview.clear();
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (tile) {
        const x0 = Math.min(stroke.startX, tile.x);
        const x1 = Math.max(stroke.startX, tile.x);
        const y0 = Math.min(stroke.startY, tile.y);
        const y1 = Math.max(stroke.startY, tile.y);
        const pick = cellPicker(activeStamp());
        const edits: TilePaint[] = [];
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const raw = pick(x - x0, y - y0);
            if (tileIdOf(raw) === 0) continue;
            edits.push({ x, y, tileId: raw });
          }
        }
        if (edits.length > 0) SceneCommands.paintTiles(stroke.sourceId, edits);
      }
      stroke = null;
    },
    cancel() { stroke = null; TilePaintPreview.clear(); },
  };
}

/** Line: drag from press to release, stamp the brush along the Bresenham line (one step). */
function makeLineTool(): EditorTool {
  let stroke: { sourceId: number; startX: number; startY: number } | null = null;
  return {
    id: 'tilemap.line',
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      stroke = { sourceId: selId, startX: tile.x, startY: tile.y };
      TilePaintPreview.set({ kind: 'line', cells: [{ x: tile.x, y: tile.y }] });
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile) return;
      TilePaintPreview.set({ kind: 'line', cells: lineCells(stroke.startX, stroke.startY, tile.x, tile.y) });
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      TilePaintPreview.clear();
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (tile) {
        const stamp = activeStamp();
        const edits: TilePaint[] = [];
        for (const c of lineCells(stroke.startX, stroke.startY, tile.x, tile.y)) {
          for (const e of brushEdits(stamp, c.x, c.y)) edits.push(e);
        }
        if (edits.length > 0) SceneCommands.paintTiles(stroke.sourceId, edits);
      }
      stroke = null;
    },
    cancel() { stroke = null; TilePaintPreview.clear(); },
  };
}

/** Ellipse fill: drag the bounding box, fill its inscribed ellipse on release (one step). */
function makeEllipseTool(): EditorTool {
  let stroke: { sourceId: number; startX: number; startY: number } | null = null;
  return {
    id: 'tilemap.ellipse',
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      stroke = { sourceId: selId, startX: tile.x, startY: tile.y };
      TilePaintPreview.set({ kind: 'line', cells: [{ x: tile.x, y: tile.y }] });
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile) return;
      TilePaintPreview.set({ kind: 'line', cells: ellipseCells(stroke.startX, stroke.startY, tile.x, tile.y) });
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      TilePaintPreview.clear();
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (tile) {
        const minX = Math.min(stroke.startX, tile.x);
        const minY = Math.min(stroke.startY, tile.y);
        const pick = cellPicker(activeStamp());
        const edits: TilePaint[] = [];
        for (const c of ellipseCells(stroke.startX, stroke.startY, tile.x, tile.y)) {
          const raw = pick(c.x - minX, c.y - minY);
          if (tileIdOf(raw) === 0) continue;
          edits.push({ x: c.x, y: c.y, tileId: raw });
        }
        if (edits.length > 0) SceneCommands.paintTiles(stroke.sourceId, edits);
      }
      stroke = null;
    },
    cancel() { stroke = null; TilePaintPreview.clear(); },
  };
}

// Bound the flood fill so an empty-target fill on an infinite layer can't run away.
const BUCKET_CAP = 16384;

/** Bucket: flood-fill the contiguous same-id region from the cursor, tiling the stamp. */
const bucketTool: EditorTool = {
  id: 'tilemap.bucket',
  onPointerDown(p) {
    const selId = selectedTilemap();
    if (selId == null) return false;
    const rt = SceneModel.runtimeFor(selId);
    const tile = cursorTile(p.clientX, p.clientY, selId);
    if (rt == null || !tile) return false;
    const stamp = activeStamp();
    const target = tileIdOf(TilemapAPI.getTile(rt, tile.x, tile.y));
    // A 1×1 brush of the target id would fill in place — nothing to do.
    if (stamp.w === 1 && stamp.h === 1 && tileIdOf(stamp.cells[0]) === target) return false;

    const visited = new Set<string>([`${tile.x},${tile.y}`]);
    const queue: [number, number][] = [[tile.x, tile.y]];
    const edits: TilePaint[] = [];
    let capped = false;
    const pick = cellPicker(stamp);
    const NEI: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const raw = pick(x, y);
      if (tileIdOf(raw) !== 0) edits.push({ x, y, tileId: raw });
      if (visited.size >= BUCKET_CAP) { capped = true; break; }
      for (const [dx, dy] of NEI) {
        const nx = x + dx;
        const ny = y + dy;
        const k = `${nx},${ny}`;
        if (visited.has(k)) continue;
        if (tileIdOf(TilemapAPI.getTile(rt, nx, ny)) !== target) continue;
        visited.add(k);
        queue.push([nx, ny]);
      }
    }
    if (edits.length > 0) SceneCommands.paintTiles(selId, edits);
    if (capped) Toasts.push(t('tile.toast.bucketCap', { cap: BUCKET_CAP }), 'warn');
    return false; // one-shot, no drag
  },
  onPointerMove() {},
  onPointerUp() {},
};

/** Select: drag a marquee over the layer to define a tile-rect selection (copy/cut/paste). */
function makeSelectTool(): EditorTool {
  let anchor: { x: number; y: number } | null = null;
  let sourceId: number | null = null;
  return {
    id: 'tilemap.select',
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      anchor = tile;
      sourceId = selId;
      useTilemapPaint.getState().setSelection({ x0: tile.x, y0: tile.y, x1: tile.x, y1: tile.y });
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!anchor || sourceId == null) return;
      const tile = cursorTile(p.clientX, p.clientY, sourceId);
      if (!tile) return;
      useTilemapPaint.getState().setSelection({ x0: anchor.x, y0: anchor.y, x1: tile.x, y1: tile.y });
    },
    onPointerUp(p, ctx) {
      ctx.release(p.pointerId);
      anchor = null;
      sourceId = null;
    },
    cancel() {
      anchor = null;
      sourceId = null;
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

/** Tile tools keyed by PaintTool. */
export const TILE_TOOLS: Record<PaintTool, EditorTool> = {
  brush: brushTool,
  erase: eraseTool,
  rect: makeRectTool(),
  ellipse: makeEllipseTool(),
  line: makeLineTool(),
  bucket: bucketTool,
  select: makeSelectTool(),
  eyedropper: eyedropperTool,
  terrain: terrainTool,
};

export type { PointerInput };
