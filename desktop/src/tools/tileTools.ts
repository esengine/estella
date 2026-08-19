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
  buildWangIndices, resolveWang, type WangIndex, type TilesetAsset,
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
  const ep = rt != null ? ViewportController.getEntityWorldPos(rt) : null;
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

/** A gid's random-brush weight from its owning palette tileset (tile `probability`). */
function tileWeight(gid: number): number {
  const ts = useTilemapPaint.getState().tilesets;
  for (let i = ts.length - 1; i >= 0; i--) {
    if (ts[i].firstId <= gid) {
      const p = ts[i].asset.tiles[gid - ts[i].firstId + 1]?.probability;
      return typeof p === 'number' && p >= 0 ? p : 1;
    }
  }
  return 1;
}

/** Weighted sampler over the pool (per-tile `probability`; all-zero falls back to uniform).
 *  Exported for tests (like lineCells). */
export function weightedSampler(pool: number[], weightOf: (gid: number) => number = tileWeight): () => number {
  const weights = pool.map((c) => weightOf(tileIdOf(c)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return () => pool[(Math.random() * pool.length) | 0];
  return () => {
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  };
}

/** Point-tool edits at (x, y): the stamp footprint, or ONE sampled tile in random mode.
 *  Exported for tests (like lineCells). */
export function brushEdits(stamp: TileStamp, x: number, y: number): TilePaint[] {
  if (useTilemapPaint.getState().randomBrush) {
    const pool = stampPool(stamp);
    if (!pool.length) return [];
    return [{ x, y, tileId: weightedSampler(pool)() }];
  }
  return stampEdits(stamp, x, y);
}

/** Area-tool cell chooser: pattern-tiled normally, per-cell random sample in random mode.
 *  Exported for tests (like lineCells). */
export function cellPicker(stamp: TileStamp): (x: number, y: number) => number {
  if (useTilemapPaint.getState().randomBrush) {
    const pool = stampPool(stamp);
    return pool.length ? weightedSampler(pool) : () => 0;
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

/**
 * The ellipse OUTLINE: the inscribed ellipse's cells minus the ellipse one cell
 * smaller on every side (Alt-hollow mode). Degenerate boxes (≤2 wide/tall) have
 * no interior, so the ring is the full set. Exported for tests (like lineCells).
 */
export function ellipseRing(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const full = ellipseCells(x0, y0, x1, y1);
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  if (maxX - minX < 2 || maxY - minY < 2) return full;
  const inner = new Set(ellipseCells(minX + 1, minY + 1, maxX - 1, maxY - 1).map((c) => `${c.x},${c.y}`));
  return full.filter((c) => !inner.has(`${c.x},${c.y}`));
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

/**
 * Read the raw cell (id + flip flags) under the cursor into the brush; on a
 * multi-tileset layer also switches the palette tab to the gid's owning tileset
 * so the brush ghost resolves. Shared by the eyedropper tool and alt-picking.
 */
function pickTileIntoBrush(clientX: number, clientY: number): void {
  const selId = selectedTilemap();
  if (selId == null) return;
  const tile = cursorTile(clientX, clientY, selId);
  const rt = SceneModel.runtimeFor(selId);
  if (!tile || rt == null) return;
  const raw = TilemapAPI.getTile(rt, tile.x, tile.y);
  const gid = tileIdOf(raw);
  if (gid <= 0) return;
  const ps = useTilemapPaint.getState();
  let owner = ps.activeTileset;
  for (let i = 0; i < ps.tilesets.length; i++) {
    if (ps.tilesets[i].firstId <= gid) owner = i; else break;
  }
  if (owner !== ps.activeTileset) ps.setActiveTileset(owner);
  ps.setStamp(singleStamp(raw));
}

// ── Shared drag-stroke driver ────────────────────────────────────────────────
// begin() opens a per-stroke context (null aborts); onCell() runs once per newly
// entered tile during press+drag; end() commits. Used by brush/erase/terrain.
interface StrokeSpec<C> {
  id: string;
  /** Alt+click eyedrops instead of stroking (the raster-editor reflex). */
  altEyedrop?: boolean;
  begin(sourceId: number): C | null;
  onCell(ctx: C, x: number, y: number): void;
  end(ctx: C): void;
}

function makeStrokeTool<C>(spec: StrokeSpec<C>): EditorTool {
  let active: { ctx: C; sourceId: number; last: { x: number; y: number } } | null = null;
  return {
    id: spec.id,
    onPointerDown(p, ctx) {
      if (p.alt && spec.altEyedrop) {
        pickTileIntoBrush(p.clientX, p.clientY);
        return false; // one-shot pick, no stroke
      }
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
  altEyedrop: true,
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

// ── Terrain brush ────────────────────────────────────────────────────────────
// Two terrain models share one brush. PEERING (edge / corner blob) joins a cell to a
// single terrain and re-tiles by neighbour matching. WANG (corner) paints a COLOR onto the
// four corners around the cursor and re-tiles the affected cells by corner match — so one
// set blends many terrains on a half-cell corner grid. The active set's `mode` picks which.
// `base` = firstId − 1: cells store GLOBAL gids but the resolvers key by tileset-LOCAL id.

interface PeerCtx {
  kind: 'peer';
  sourceId: number;
  rt: number;
  set: number;
  indices: TerrainIndices;
  assigned: Map<string, number>;
  base: number;
}
interface WangCtx {
  kind: 'wang';
  sourceId: number;
  rt: number;
  set: number;
  /** The wang color being painted (1-based). */
  color: number;
  index: WangIndex;
  base: number;
  asset: TilesetAsset;
  /** Stroke-transient corner grid: vertex key "vx,vy" → color. */
  corners: Map<string, number>;
}
type TerrainStroke = PeerCtx | WangCtx;

// — peering —
function terrainAt(s: PeerCtx, x: number, y: number): number | null {
  const key = `${x},${y}`;
  if (s.assigned.has(key)) return s.assigned.get(key)!;
  const gid = tileIdOf(TilemapAPI.getTile(s.rt, x, y));
  if (gid === 0) return null;
  return s.indices.tileTerrain.get(gid - s.base) ?? null;
}

function recomputeTerrain(s: PeerCtx, x: number, y: number): void {
  const set = terrainAt(s, x, y);
  if (set == null) return;
  const index = s.indices.sets.get(set);
  if (!index) return;
  const neighbors = TERRAIN_NEIGHBORS.map((n) => terrainAt(s, x + n.dx, y + n.dy) === set);
  const local = resolveAutotile(index, neighbors);
  if (local > 0) SceneCommands.paintTileLive(s.sourceId, x, y, encodeTile(local + s.base));
}

/** Join (x,y) to the active terrain, then re-resolve it and its 8 neighbours. */
function stampTerrain(s: PeerCtx, x: number, y: number): void {
  s.assigned.set(`${x},${y}`, s.set);
  recomputeTerrain(s, x, y);
  for (const n of TERRAIN_NEIGHBORS) recomputeTerrain(s, x + n.dx, y + n.dy);
}

// — wang (corner) —
/** The wang corner colors of the tile at cell (gid), or null if it's not this set's wang tile. */
function wangTileCorners(asset: TilesetAsset, set: number, base: number, gid: number): number[] | null {
  if (gid <= 0) return null;
  const t = asset.tiles[gid - base]?.terrain;
  return t && t.set === set && t.corners ? t.corners : null;
}

/** The color at corner-grid vertex (vx,vy): the stroke's painted value, else derived from
 *  whichever placed tile owns that vertex (probing the 4 cells around it). */
function wangVertex(s: WangCtx, vx: number, vy: number): number {
  const painted = s.corners.get(`${vx},${vy}`);
  if (painted !== undefined) return painted;
  // Each vertex is the TL of cell (vx,vy), TR of (vx−1,vy), BL of (vx,vy−1), BR of (vx−1,vy−1).
  const probes: [number, number, number][] = [[vx, vy, 0], [vx - 1, vy, 1], [vx, vy - 1, 3], [vx - 1, vy - 1, 2]];
  for (const [cx, cy, ci] of probes) {
    const c = wangTileCorners(s.asset, s.set, s.base, tileIdOf(TilemapAPI.getTile(s.rt, cx, cy)));
    if (c) return c[ci] ?? 0;
  }
  return 0;
}

/** Paint the active color onto (tx,ty)'s 4 corners, then re-tile the 3×3 cells they touch. */
function stampWang(s: WangCtx, tx: number, ty: number): void {
  s.corners.set(`${tx},${ty}`, s.color);
  s.corners.set(`${tx + 1},${ty}`, s.color);
  s.corners.set(`${tx + 1},${ty + 1}`, s.color);
  s.corners.set(`${tx},${ty + 1}`, s.color);
  // Resolve all affected cells from the (post-paint) corner grid FIRST, then apply — so the
  // nine resolves don't see each other's mid-pass tile writes.
  const edits: [number, number, number][] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      const corners = [wangVertex(s, x, y), wangVertex(s, x + 1, y), wangVertex(s, x + 1, y + 1), wangVertex(s, x, y + 1)];
      if (corners[0] === 0 && corners[1] === 0 && corners[2] === 0 && corners[3] === 0) continue;
      const local = resolveWang(s.index, corners);
      if (local > 0) edits.push([x, y, local]);
    }
  }
  for (const [x, y, local] of edits) SceneCommands.paintTileLive(s.sourceId, x, y, encodeTile(local + s.base));
}

const terrainTool = makeStrokeTool<TerrainStroke>({
  id: 'tilemap.terrain',
  begin: (selId) => {
    const rt = SceneModel.runtimeFor(selId);
    const ps = useTilemapPaint.getState();
    const asset = ps.tilesetAsset;
    if (rt == null || !asset) return null;
    const base = (ps.tilesets[ps.activeTileset]?.firstId ?? 1) - 1;
    const terrain = asset.terrains?.[ps.terrainSet];
    if (terrain?.mode === 'wang') {
      const index = buildWangIndices(asset).sets.get(ps.terrainSet);
      if (!index) return null; // active wang set has no corner tiles yet
      SceneCommands.beginTilePaint(selId);
      return {
        kind: 'wang', sourceId: selId, rt, set: ps.terrainSet, color: ps.wangColor || 1,
        index, base, asset, corners: new Map(),
      };
    }
    const indices = buildTerrainIndices(asset);
    if (!indices.sets.has(ps.terrainSet)) return null; // active terrain has no tiles yet
    SceneCommands.beginTilePaint(selId);
    return { kind: 'peer', sourceId: selId, rt, set: ps.terrainSet, indices, assigned: new Map(), base };
  },
  onCell: (s, x, y) => {
    if (s.kind === 'wang') stampWang(s, x, y);
    else if (!s.assigned.has(`${x},${y}`)) stampTerrain(s, x, y);
  },
  end: () => SceneCommands.endTilePaint(),
});

// ── Gesture tools (commit once on release / click) ───────────────────────────

// Shift-constraints, matching every raster/tile editor's muscle memory: lines snap
// to the 8 compass directions, rect/ellipse boxes snap square (circle).

/** Snap (x,y) to the nearest horizontal / vertical / 45° ray from (sx,sy). */
export function octantSnap(sx: number, sy: number, x: number, y: number): { x: number; y: number } {
  const dx = x - sx;
  const dy = y - sy;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx >= 2 * ady) return { x, y: sy };
  if (ady >= 2 * adx) return { x: sx, y };
  const d = Math.max(adx, ady);
  return { x: sx + Math.sign(dx) * d, y: sy + Math.sign(dy) * d };
}

/** Snap (x,y) so the (sx,sy)-cornered box is square, keeping the drag quadrant. */
export function squareSnap(sx: number, sy: number, x: number, y: number): { x: number; y: number } {
  const d = Math.max(Math.abs(x - sx), Math.abs(y - sy));
  return { x: sx + (x >= sx ? d : -d), y: sy + (y >= sy ? d : -d) };
}

/** Rect fill: drag a rectangle, tile the active stamp across it on release (one step).
 *  Shift constrains the box square. */
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
      let tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile) return;
      if (p.shift) tile = squareSnap(stroke.startX, stroke.startY, tile.x, tile.y);
      TilePaintPreview.set({ kind: 'rect', x0: stroke.startX, y0: stroke.startY, x1: tile.x, y1: tile.y });
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      TilePaintPreview.clear();
      let tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (tile && p.shift) tile = squareSnap(stroke.startX, stroke.startY, tile.x, tile.y);
      if (tile) {
        const x0 = Math.min(stroke.startX, tile.x);
        const x1 = Math.max(stroke.startX, tile.x);
        const y0 = Math.min(stroke.startY, tile.y);
        const y1 = Math.max(stroke.startY, tile.y);
        const pick = cellPicker(activeStamp());
        const edits: TilePaint[] = [];
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            // Alt = hollow: keep the perimeter, skip the interior.
            if (p.alt && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
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

/** Line: drag from press to release, stamp the brush along the Bresenham line (one step).
 *  Shift constrains to horizontal / vertical / 45°. */
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
      let tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile) return;
      if (p.shift) tile = octantSnap(stroke.startX, stroke.startY, tile.x, tile.y);
      TilePaintPreview.set({ kind: 'line', cells: lineCells(stroke.startX, stroke.startY, tile.x, tile.y) });
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      TilePaintPreview.clear();
      let tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (tile && p.shift) tile = octantSnap(stroke.startX, stroke.startY, tile.x, tile.y);
      if (tile) {
        // One tiled cell per line cell (like rect/ellipse), so the thin-line preview
        // matches what lands — not the whole w×h footprint stamped at every point.
        const pick = cellPicker(activeStamp());
        const edits: TilePaint[] = [];
        for (const c of lineCells(stroke.startX, stroke.startY, tile.x, tile.y)) {
          const raw = pick(c.x, c.y);
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

/** Ellipse fill: drag the bounding box, fill its inscribed ellipse on release (one step).
 *  Shift constrains the box square — a circle. */
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
      let tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (!tile) return;
      if (p.shift) tile = squareSnap(stroke.startX, stroke.startY, tile.x, tile.y);
      const cells = (p.alt ? ellipseRing : ellipseCells)(stroke.startX, stroke.startY, tile.x, tile.y);
      TilePaintPreview.set({ kind: 'line', cells });
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      TilePaintPreview.clear();
      let tile = cursorTile(p.clientX, p.clientY, stroke.sourceId);
      if (tile && p.shift) tile = squareSnap(stroke.startX, stroke.startY, tile.x, tile.y);
      if (tile) {
        const minX = Math.min(stroke.startX, tile.x);
        const minY = Math.min(stroke.startY, tile.y);
        const pick = cellPicker(activeStamp());
        let cells = ellipseCells(stroke.startX, stroke.startY, tile.x, tile.y);
        if (p.alt) cells = ellipseRing(stroke.startX, stroke.startY, tile.x, tile.y);
        const edits: TilePaint[] = [];
        for (const c of cells) {
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

/**
 * Select: drag a marquee over the layer to define a tile-rect selection
 * (copy/cut/paste), and drag from INSIDE the selection to MOVE its tiles — a
 * floating cut that erases live, previews the target rect while dragging, and
 * lands as ONE undo step on release (Esc restores the pre-drag tiles).
 */
function makeSelectTool(): EditorTool {
  let anchor: { x: number; y: number } | null = null;
  let sourceId: number | null = null;
  let move: {
    sourceId: number;
    /** Region content lifted at grab time (raw cells incl. flip flags). */
    buf: number[];
    x0: number; y0: number; w: number; h: number;
    /** Grab point offset within the region, so it drags from where you grabbed it. */
    dx: number; dy: number;
    /** Target top-left (updates while dragging). */
    tx: number; ty: number;
  } | null = null;

  const inSelection = (t: { x: number; y: number }): { x0: number; y0: number; x1: number; y1: number } | null => {
    const sel = useTilemapPaint.getState().selection;
    if (!sel) return null;
    const x0 = Math.min(sel.x0, sel.x1);
    const x1 = Math.max(sel.x0, sel.x1);
    const y0 = Math.min(sel.y0, sel.y1);
    const y1 = Math.max(sel.y0, sel.y1);
    return t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1 ? { x0, y0, x1, y1 } : null;
  };

  return {
    id: 'tilemap.select',
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      const rt = SceneModel.runtimeFor(selId);
      const region = inSelection(tile);
      if (region && rt != null) {
        // Grab the region: lift its cells, erase them live, drag the block.
        const w = region.x1 - region.x0 + 1;
        const h = region.y1 - region.y0 + 1;
        const buf: number[] = [];
        for (let y = region.y0; y <= region.y1; y++) {
          for (let x = region.x0; x <= region.x1; x++) buf.push(TilemapAPI.getTile(rt, x, y));
        }
        SceneCommands.beginTilePaint(selId);
        for (let y = region.y0; y <= region.y1; y++) {
          for (let x = region.x0; x <= region.x1; x++) SceneCommands.paintTileLive(selId, x, y, 0);
        }
        move = {
          sourceId: selId, buf, x0: region.x0, y0: region.y0, w, h,
          dx: tile.x - region.x0, dy: tile.y - region.y0,
          tx: region.x0, ty: region.y0,
        };
        TilePaintPreview.set({ kind: 'rect', x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 });
        ctx.capture(p.pointerId);
        return true;
      }
      anchor = tile;
      sourceId = selId;
      useTilemapPaint.getState().setSelection({ x0: tile.x, y0: tile.y, x1: tile.x, y1: tile.y });
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (move) {
        const tile = cursorTile(p.clientX, p.clientY, move.sourceId);
        if (!tile) return;
        move.tx = tile.x - move.dx;
        move.ty = tile.y - move.dy;
        TilePaintPreview.set({
          kind: 'rect',
          x0: move.tx, y0: move.ty, x1: move.tx + move.w - 1, y1: move.ty + move.h - 1,
        });
        return;
      }
      if (!anchor || sourceId == null) return;
      const tile = cursorTile(p.clientX, p.clientY, sourceId);
      if (!tile) return;
      useTilemapPaint.getState().setSelection({ x0: anchor.x, y0: anchor.y, x1: tile.x, y1: tile.y });
    },
    onPointerUp(p, ctx) {
      ctx.release(p.pointerId);
      if (move) {
        TilePaintPreview.clear();
        // Land the lifted block at the target: erase + place is ONE stroke commit.
        for (let dy = 0; dy < move.h; dy++) {
          for (let dx = 0; dx < move.w; dx++) {
            const raw = move.buf[dy * move.w + dx];
            if (tileIdOf(raw) === 0) continue; // sparse — moved emptiness never erases the target
            SceneCommands.paintTileLive(move.sourceId, move.tx + dx, move.ty + dy, raw);
          }
        }
        SceneCommands.endTilePaint();
        useTilemapPaint.getState().setSelection({
          x0: move.tx, y0: move.ty, x1: move.tx + move.w - 1, y1: move.ty + move.h - 1,
        });
        move = null;
        return;
      }
      anchor = null;
      sourceId = null;
    },
    cancel() {
      if (move) {
        SceneCommands.cancelTilePaint(); // restore the lifted tiles, no undo entry
        TilePaintPreview.clear();
        move = null;
      }
      anchor = null;
      sourceId = null;
    },
  };
}

/** Eyedropper: one-shot — read the raw cell (id + flip flags) under the cursor into the brush. */
const eyedropperTool: EditorTool = {
  id: 'tilemap.eyedropper',
  onPointerDown(p) {
    pickTileIntoBrush(p.clientX, p.clientY);
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
