// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The tilemap paint store's brush is a TileStamp; flip/rotate transform it in
 *        place. Guards the store wiring over the SDK stamp algebra (which is unit-tested
 *        separately) — the painter + viewport tools read `stamp` straight off this store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { tileIdOf, tileFlagsOf } from 'esengine';
import { useTilemapPaint } from '@/store/tilemapPaintStore';

describe('tilemap paint store', () => {
  beforeEach(() => {
    useTilemapPaint.getState().setBrushTile(1);
  });

  it('setBrushTile makes a 1×1 stamp of that id with no flags', () => {
    useTilemapPaint.getState().setBrushTile(7);
    const s = useTilemapPaint.getState().stamp;
    expect(s).toMatchObject({ w: 1, h: 1 });
    expect(tileIdOf(s.cells[0])).toBe(7);
    expect(tileFlagsOf(s.cells[0])).toEqual({ flipH: false, flipV: false, flipD: false });
  });

  it('setStamp stores a multi-tile pattern', () => {
    useTilemapPaint.getState().setStamp({ w: 2, h: 1, cells: [1, 2] });
    expect(useTilemapPaint.getState().stamp).toEqual({ w: 2, h: 1, cells: [1, 2] });
  });

  it('flipH flips the stamp in place (4 ops over a 2×1 restores it)', () => {
    useTilemapPaint.getState().setStamp({ w: 2, h: 1, cells: [1, 2] });
    useTilemapPaint.getState().flipH();
    const s = useTilemapPaint.getState().stamp;
    expect(tileIdOf(s.cells[0])).toBe(2);
    expect(tileFlagsOf(s.cells[0]).flipH).toBe(true);
    useTilemapPaint.getState().flipH();
    expect(useTilemapPaint.getState().stamp).toEqual({ w: 2, h: 1, cells: [1, 2] });
  });

  it('rotateCW transposes dims; four rotations restore the brush', () => {
    useTilemapPaint.getState().setStamp({ w: 2, h: 1, cells: [1, 2] });
    useTilemapPaint.getState().rotateCW();
    expect(useTilemapPaint.getState().stamp).toMatchObject({ w: 1, h: 2 });
    useTilemapPaint.getState().rotateCW();
    useTilemapPaint.getState().rotateCW();
    useTilemapPaint.getState().rotateCW();
    expect(useTilemapPaint.getState().stamp).toEqual({ w: 2, h: 1, cells: [1, 2] });
  });
});
