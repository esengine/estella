// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tileMode.ts
 * @brief The single source of truth for "am I in tile-editing context" and the ONE
 *        keyboard handler for tile painting. Centralising the keymap here (instead of
 *        a second `window` keydown listener in the painter panel) is what makes tile
 *        keys work regardless of which panels are mounted AND lets the global keymap
 *        give them priority — so a paint shortcut no longer double-fires the transform
 *        command bound to the same letter (e.g. `R` rotating the stamp AND silently
 *        switching the transform tool to Scale).
 *
 * Modality: a tilemap being SELECTED is the tile context. Non-colliding letters
 * (B/U/O/L/G/M/I/T, plus E for erase) enter a paint tool from there. The letters that
 * collide with the transform tools (Q/W/E/R) are consumed for painting ONLY while a
 * paint tool is active, and Q/W then double as the explicit exit back to
 * select/move — so there is never a hidden "painting yet the toolbar says Scale" state.
 */
import { SceneModel } from '@/engine/SceneModel';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';
import { useTilemapPaint, type PaintTool } from '@/store/tilemapPaintStore';
import { activeMode } from '@/mode/activeMode';
import { copySelection, cutSelection, deleteSelection, pasteClipboard } from './tileClipboard';
import type { ToolMode } from '@/types';

/** True when the primary selection is a TilemapLayer entity — the tile-editing context. */
export function isTilemapSelected(): boolean {
  const id = useSelection.getState().selectedId;
  return id != null
    && !!SceneModel.entityBySource(id)?.components.some((c) => c.type === 'TilemapLayer');
}

/** True when a paint tool is active in tilemap mode — i.e. clicks paint, not select. */
export function isTilePaintMode(): boolean {
  return activeMode().toolset === 'tilemap' && useTilemapPaint.getState().tool != null;
}

/** The selected tilemap layer's authoring cell size, or null if none is selected. */
export function selectedTilemapCellSize(): { x: number; y: number } | null {
  const id = useSelection.getState().selectedId;
  if (id == null) return null;
  const layer = SceneModel.entityBySource(id)?.components.find((c) => c.type === 'TilemapLayer');
  const cell = (layer?.data as { cellSize?: { x: number; y: number } } | undefined)?.cellSize;
  return cell && cell.x > 0 ? cell : null;
}

/** Leave paint mode and hand the pointer back to a transform tool (the explicit exit). */
export function exitTilePaint(transform: ToolMode = 'select'): void {
  useTilemapPaint.getState().setTool(null);
  useEditorStore.getState().setTool(transform);
}

/** Single-key hint shown on each paint tool button — one key per tool, no collisions
 *  among themselves (Q/W/E/R stay the transform tools until you're actually painting). */
export const TILE_TOOL_KEY: Record<PaintTool, string> = {
  brush: 'B', erase: 'E', rect: 'U', ellipse: 'O', line: 'L', bucket: 'G', select: 'M', eyedropper: 'I', terrain: 'T',
};

// Keys that select a paint tool from the tile context whether or not one is active yet.
// Deliberately excludes the transform letters except E (erasing is worth the override —
// tilemaps are rarely keyboard-rotated; rotate/scale stay reachable via the toolbar).
const ENTRY_KEY: Record<string, PaintTool> = {
  b: 'brush', e: 'erase', u: 'rect', o: 'ellipse', l: 'line', g: 'bucket', m: 'select', i: 'eyedropper', t: 'terrain',
};

/**
 * The tile-context keyboard handler. Returns true if it consumed the event, in which
 * case the caller must {@link KeyboardEvent.preventDefault} and NOT dispatch the global
 * command bound to the same key. A no-op (returns false) whenever no tilemap is selected.
 */
export function handleTilePaintKey(e: KeyboardEvent): boolean {
  if (!isTilemapSelected()) return false;
  const paint = useTilemapPaint.getState();
  const painting = paint.tool != null;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();

  // Tile-scoped clipboard — consume so the entity clipboard commands don't also run
  // (⌘C over a tile selection copies the region, not the tilemap entity).
  if (painting) {
    if (paint.tool === 'select') {
      if (mod && k === 'c') { copySelection(); return true; }
      if (mod && k === 'x') { cutSelection(); return true; }
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) { deleteSelection(); return true; }
    }
    if (mod && k === 'v') { pasteClipboard(); return true; }
  }
  // Leave every other modifier chord (undo/save/…) to the global keymap.
  if (mod || e.altKey) return false;

  // Enter / switch paint tool.
  const entry = ENTRY_KEY[k];
  if (entry) { paint.setTool(entry); return true; }

  // The rest only bind while painting, so transform Q/W/E/R work normally otherwise.
  if (!painting) return false;
  if (k === 'r') { paint.rotateCW(); return true; }
  if (k === 'h') { paint.flipH(); return true; }
  if (k === 'v') { paint.flipV(); return true; }
  if (k === 'q') { exitTilePaint('select'); return true; }
  if (k === 'w') { exitTilePaint('move'); return true; }
  return false;
}
