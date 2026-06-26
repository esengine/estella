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
  let active: { ctx: C; sourceId: number; last: string } | null = null;
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
      active = { ctx: c, sourceId: selId, last: `${tile.x},${tile.y}` };
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!active) return;
      const tile = cursorTile(p.clientX, p.clientY, active.sourceId);
      if (!tile) return;
      const key = `${tile.x},${tile.y}`;
      if (key === active.last) return;
      spec.onCell(active.ctx, tile.x, tile.y);
      active.last = key;
    },
    onPointerUp(p, ctx) {
      if (!active) return;
      ctx.release(p.pointerId);
      spec.end(active.ctx);
      active = null;
    },
    cancel() {
      if (!active) return;
      // No mid-stroke tile rollback yet; commit what is painted (matches pointercancel).
      spec.end(active.ctx);
      active = null;
    },
  };
}

const brushTool = makeStrokeTool<number>({
  id: 'tilemap.brush',
  begin: (selId) => { SceneCommands.beginTilePaint(selId); return selId; },
  onCell: (selId, x, y) => {
    for (const e of stampEdits(activeStamp(), x, y)) SceneCommands.paintTileLive(selId, e.x, e.y, e.tileId);
  },
  end: () => SceneCommands.endTilePaint(),
});

const eraseTool = makeStrokeTool<number>({
  id: 'tilemap.erase',
  begin: (selId) => { SceneCommands.beginTilePaint(selId); return selId; },
  onCell: (selId, x, y) => SceneCommands.paintTileLive(selId, x, y, 0),
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
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove() {
      // Rect previews on release (no live fill).
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
            const raw = tiledCell(stamp, x - x0, y - y0);
            if (tileIdOf(raw) === 0) continue;
            edits.push({ x, y, tileId: raw });
          }
        }
        if (edits.length > 0) SceneCommands.paintTiles(stroke.sourceId, edits);
      }
      stroke = null;
    },
    cancel() { stroke = null; },
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
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove() {},
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      const tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (tile) {
        const stamp = activeStamp();
        const edits: TilePaint[] = [];
        let x = stroke.startX;
        let y = stroke.startY;
        const dx = Math.abs(tile.x - x);
        const dy = -Math.abs(tile.y - y);
        const sx = x < tile.x ? 1 : -1;
        const sy = y < tile.y ? 1 : -1;
        let err = dx + dy;
        for (;;) {
          for (const e of stampEdits(stamp, x, y)) edits.push(e);
          if (x === tile.x && y === tile.y) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x += sx; }
          if (e2 <= dx) { err += dx; y += sy; }
        }
        if (edits.length > 0) SceneCommands.paintTiles(stroke.sourceId, edits);
      }
      stroke = null;
    },
    cancel() { stroke = null; },
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
    const NEI: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const raw = tiledCell(stamp, x, y);
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
    if (capped) Toasts.push(`油漆桶到达 ${BUCKET_CAP} 格上限，已部分填充`, 'warn');
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
  line: makeLineTool(),
  bucket: bucketTool,
  select: makeSelectTool(),
  eyedropper: eyedropperTool,
  terrain: terrainTool,
};

export type { PointerInput };
