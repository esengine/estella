// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The tile-editing keyboard router (handleTilePaintKey) — the single dispatch
 *        point that fixes the old double-fire (a paint shortcut ALSO running the
 *        transform command bound to the same letter). Locks the modality: entry letters
 *        pick a paint tool; the transform-colliding letters (Q/W/R) are claimed only
 *        while painting, and Q/W double as the explicit exit — so the keys never both
 *        paint and switch the transform tool. SceneModel + the tile clipboard are mocked
 *        so this exercises the routing decisions, not the model.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tileFlagsOf } from 'esengine';

const model = vi.hoisted(() => ({
  entity: null as null | { components: { type: string; data: unknown }[] },
}));
vi.mock('@/engine/SceneModel', () => ({
  SceneModelImpl: class {},
  SceneModel: {
    subscribe: () => () => {},
    // Entity #1 is our tilemap; everything else is a plain (non-tile) entity.
    entityBySource: (id: number) => (id === 1 ? model.entity : null),
  },
}));

const clip = vi.hoisted(() => ({
  copySelection: vi.fn(),
  cutSelection: vi.fn(),
  deleteSelection: vi.fn(),
  pasteClipboard: vi.fn(),
}));
vi.mock('@/tools/tileClipboard', () => clip);

import { handleTilePaintKey, isTilemapSelected } from '@/tools/tileMode';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { useEditorStore } from '@/store/editorStore';

const paint = () => useTilemapPaint.getState();
const key = (k: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods }) as KeyboardEvent;

describe('tile-editing keyboard router', () => {
  beforeEach(() => {
    model.entity = { components: [{ type: 'TilemapLayer', data: { cellSize: { x: 16, y: 16 } } }] };
    useSelection.getState().select(1);
    paint().setBrushTile(1);
    paint().setTool(null);
    useEditorStore.getState().setTool('move');
    clip.copySelection.mockClear();
    clip.cutSelection.mockClear();
    clip.deleteSelection.mockClear();
    clip.pasteClipboard.mockClear();
  });

  it('is inert when no tilemap is selected (transform keys stay global)', () => {
    model.entity = null;
    expect(isTilemapSelected()).toBe(false);
    expect(handleTilePaintKey(key('b'))).toBe(false);
    expect(paint().tool).toBeNull();
  });

  it('entry letters pick a paint tool and consume the key', () => {
    const cases: [string, string][] = [
      ['b', 'brush'], ['e', 'erase'], ['u', 'rect'], ['l', 'line'],
      ['g', 'bucket'], ['m', 'select'], ['i', 'eyedropper'], ['t', 'terrain'],
    ];
    for (const [k, tool] of cases) {
      paint().setTool(null);
      expect(handleTilePaintKey(key(k))).toBe(true);
      expect(paint().tool).toBe(tool);
    }
  });

  it('E claims erase over the transform Rotate command whenever a tilemap is selected', () => {
    paint().setTool(null); // not painting yet
    expect(handleTilePaintKey(key('e'))).toBe(true);
    expect(paint().tool).toBe('erase');
  });

  it('R rotates the stamp while painting (consumed — never reaches transform Scale)', () => {
    paint().setTool('brush');
    paint().setStamp({ w: 2, h: 1, cells: [1, 2] });
    expect(handleTilePaintKey(key('r'))).toBe(true);
    expect(paint().stamp).toMatchObject({ w: 1, h: 2 });
  });

  it('H / V flip the stamp while painting', () => {
    paint().setTool('brush');
    paint().setStamp({ w: 2, h: 1, cells: [1, 2] });
    expect(handleTilePaintKey(key('h'))).toBe(true);
    expect(tileFlagsOf(paint().stamp.cells[0]).flipH).toBe(true);
  });

  it('Q / W exit paint mode back to the matching transform tool', () => {
    paint().setTool('brush');
    expect(handleTilePaintKey(key('q'))).toBe(true);
    expect(paint().tool).toBeNull();
    expect(useEditorStore.getState().tool).toBe('select');

    paint().setTool('brush');
    expect(handleTilePaintKey(key('w'))).toBe(true);
    expect(paint().tool).toBeNull();
    expect(useEditorStore.getState().tool).toBe('move');
  });

  it('leaves Q / W / R to the global transform commands when a tilemap is selected but not painting', () => {
    paint().setTool(null);
    expect(handleTilePaintKey(key('q'))).toBe(false);
    expect(handleTilePaintKey(key('w'))).toBe(false);
    expect(handleTilePaintKey(key('r'))).toBe(false);
  });

  it('routes tile clipboard keys for the select tool (not the entity clipboard)', () => {
    paint().setTool('select');
    expect(handleTilePaintKey(key('c', { metaKey: true }))).toBe(true);
    expect(clip.copySelection).toHaveBeenCalledTimes(1);
    expect(handleTilePaintKey(key('x', { metaKey: true }))).toBe(true);
    expect(clip.cutSelection).toHaveBeenCalledTimes(1);
    expect(handleTilePaintKey(key('Delete'))).toBe(true);
    expect(clip.deleteSelection).toHaveBeenCalledTimes(1);
  });

  it('paste routes to the tile clipboard from any paint tool', () => {
    paint().setTool('brush');
    expect(handleTilePaintKey(key('v', { metaKey: true }))).toBe(true);
    expect(clip.pasteClipboard).toHaveBeenCalledTimes(1);
  });

  it('leaves non-tile modifier chords (undo / save) to the global keymap', () => {
    paint().setTool('brush');
    expect(handleTilePaintKey(key('z', { metaKey: true }))).toBe(false);
    expect(handleTilePaintKey(key('s', { metaKey: true }))).toBe(false);
  });
});
