// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tileTools.ts
 * @brief The tilemap paint tools — brush / erase / rect / eyedropper. Active only
 *        when a TilemapLayer is selected (the host resolves that); each operates
 *        on the selected layer via SceneCommands' tile-paint stroke API.
 */
import { TilemapAPI } from 'esengine';
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

/** Brush (paints brushTileId) / Erase (paints 0): a live stroke, one undo step. */
function makeBrushTool(id: string, erase: boolean): EditorTool {
  let stroke: { sourceId: number; last: string } | null = null;
  const tileId = () => (erase ? 0 : useTilemapPaint.getState().brushTileId);
  return {
    id,
    onPointerDown(p, ctx) {
      const selId = selectedTilemap();
      if (selId == null) return false;
      const tile = cursorTile(p.clientX, p.clientY, selId);
      if (!tile) return false;
      SceneCommands.beginTilePaint(selId);
      SceneCommands.paintTileLive(selId, tile.x, tile.y, tileId());
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
      SceneCommands.paintTileLive(stroke.sourceId, tile.x, tile.y, tileId());
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

/** Rect fill: drag a rectangle, fill it with brushTileId on release (one step). */
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
        const tileId = useTilemapPaint.getState().brushTileId;
        const edits: TilePaint[] = [];
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) edits.push({ x, y, tileId });
        SceneCommands.paintTiles(stroke.sourceId, edits);
      }
      stroke = null;
    },
    cancel() {
      stroke = null;
    },
  };
}

/** Eyedropper: one-shot — read the tile under the cursor into the active brush. */
const eyedropperTool: EditorTool = {
  id: 'tilemap.eyedropper',
  onPointerDown(p) {
    const selId = selectedTilemap();
    if (selId == null) return false;
    const tile = cursorTile(p.clientX, p.clientY, selId);
    if (!tile) return false;
    const rt = SceneModel.runtimeFor(selId);
    const id = rt != null ? TilemapAPI.getTile(rt, tile.x, tile.y) : 0;
    if (id > 0) useTilemapPaint.getState().setBrush(id);
    return false; // no ongoing stroke
  },
  onPointerMove() {},
  onPointerUp() {},
};

/** Tile tools keyed by PaintTool (brush/erase/rect/eyedropper). */
export const TILE_TOOLS: Record<PaintTool, EditorTool> = {
  brush: makeBrushTool('tilemap.brush', false),
  erase: makeBrushTool('tilemap.erase', true),
  rect: makeRectTool(),
  eyedropper: eyedropperTool,
};

export type { PointerInput };
