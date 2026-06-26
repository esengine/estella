// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tileClipboard.ts
 * @brief Copy / cut / delete / paste for the tilemap select tool. A selection is lifted
 *        into a {@link TileStamp} (raw cells, flip flags preserved), so paste just makes
 *        it the active brush and switches to the brush tool — reusing the stamp paint
 *        path. Copy/cut/delete read & write the selected region on the selected layer.
 */
import { TilemapAPI, type TileStamp } from 'esengine';
import { SceneCommands, type TilePaint } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint, type TileRect } from '@/store/tilemapPaintStore';

/** The selected layer's source id + its live runtime entity, or null. */
function activeLayer(): { sourceId: number; rt: number } | null {
  const sourceId = useSelection.getState().selectedId;
  if (sourceId == null) return null;
  const rt = SceneModel.runtimeFor(sourceId);
  return rt == null ? null : { sourceId, rt };
}

const order = (r: TileRect) => ({
  x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1),
  x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1),
});

/** Lift the current selection into a stamp (raw cells incl. flip flags). */
export function readSelectionStamp(): TileStamp | null {
  const sel = useTilemapPaint.getState().selection;
  const layer = activeLayer();
  if (!sel || !layer) return null;
  const { x0, y0, x1, y1 } = order(sel);
  const cells: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) cells.push(TilemapAPI.getTile(layer.rt, x, y));
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cells };
}

export function copySelection(): void {
  const stamp = readSelectionStamp();
  if (stamp) useTilemapPaint.getState().setClipboard(stamp);
}

/** Clear every cell in the selection as one undo step. */
export function deleteSelection(): void {
  const sel = useTilemapPaint.getState().selection;
  const layer = activeLayer();
  if (!sel || !layer) return;
  const { x0, y0, x1, y1 } = order(sel);
  const edits: TilePaint[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) edits.push({ x, y, tileId: 0 });
  }
  if (edits.length > 0) SceneCommands.paintTiles(layer.sourceId, edits);
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

/** Paste = make the clipboard the active brush + switch to the brush tool to place it. */
export function pasteClipboard(): void {
  const { clipboard, setStamp, setTool } = useTilemapPaint.getState();
  if (!clipboard) return;
  setStamp(clipboard);
  setTool('brush');
}
