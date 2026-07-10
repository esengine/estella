// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tile-random-brush.test.ts
 * @brief Random brush mode: point tools lay ONE tile sampled from the stamp's
 *        non-empty cells; area tools sample per cell. Off = the classic
 *        pattern behavior (footprint stamp / continuous tiling).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { encodeTile, type TileStamp } from 'esengine';
import { brushEdits, cellPicker } from '@/tools/tileTools';
import { useTilemapPaint } from '@/store/tilemapPaintStore';

const A = encodeTile(3);
const B = encodeTile(7);
// A 2×2 stamp with one EMPTY cell — random sampling must never lay a 0.
const stamp: TileStamp = { w: 2, h: 2, cells: [A, B, 0, encodeTile(9)] };
const pool = new Set([A, B, encodeTile(9)]);

beforeEach(() => useTilemapPaint.setState({ randomBrush: false }));

describe('random brush', () => {
  it('off: brush lays the full stamp footprint at the anchor', () => {
    const edits = brushEdits(stamp, 10, 20);
    expect(edits).toHaveLength(3); // the empty cell stays sparse
    expect(edits[0]).toEqual({ x: 10, y: 20, tileId: A });
  });

  it('on: brush lays exactly one sampled tile at the cursor cell', () => {
    useTilemapPaint.setState({ randomBrush: true });
    for (let i = 0; i < 32; i++) {
      const edits = brushEdits(stamp, 5, 6);
      expect(edits).toHaveLength(1);
      expect(edits[0].x).toBe(5);
      expect(edits[0].y).toBe(6);
      expect(pool.has(edits[0].tileId)).toBe(true);
    }
  });

  it('on: an all-empty stamp paints nothing instead of zeros', () => {
    useTilemapPaint.setState({ randomBrush: true });
    expect(brushEdits({ w: 1, h: 1, cells: [0] }, 0, 0)).toEqual([]);
  });

  it('off: area picker tiles the pattern continuously', () => {
    const pick = cellPicker(stamp);
    expect(pick(0, 0)).toBe(A);
    expect(pick(2, 0)).toBe(A); // wraps at stamp width
    expect(pick(1, 1)).toBe(encodeTile(9));
  });

  it('on: area picker samples the pool for every cell', () => {
    useTilemapPaint.setState({ randomBrush: true });
    const pick = cellPicker(stamp);
    for (let i = 0; i < 32; i++) expect(pool.has(pick(i, i))).toBe(true);
  });
});
