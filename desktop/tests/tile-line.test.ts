// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Bresenham tile-line enumeration — the line tool's committed tiles AND its
 *        live drag preview both walk this, so a regression would desync what the
 *        preview shows from what gets painted. Pins the endpoints, contiguity, and
 *        direction symmetry.
 */
import { describe, it, expect } from 'vitest';
import { lineCells } from '@/tools/tileTools';

const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;

describe('lineCells (Bresenham)', () => {
  it('a zero-length line is the single start cell', () => {
    expect(lineCells(3, 4, 3, 4)).toEqual([{ x: 3, y: 4 }]);
  });

  it('a horizontal line spans every column, inclusive', () => {
    expect(lineCells(0, 2, 3, 2)).toEqual([
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 },
    ]);
  });

  it('a vertical line spans every row, inclusive', () => {
    expect(lineCells(5, 0, 5, 3)).toEqual([
      { x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 },
    ]);
  });

  it('a 45° diagonal steps one cell per axis', () => {
    expect(lineCells(0, 0, 3, 3)).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 },
    ]);
  });

  it('always includes both endpoints and stays 8-connected', () => {
    const cells = lineCells(0, 0, 6, 2); // shallow slope
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells.at(-1)).toEqual({ x: 6, y: 2 });
    for (let i = 1; i < cells.length; i++) {
      expect(Math.abs(cells[i].x - cells[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(cells[i].y - cells[i - 1].y)).toBeLessThanOrEqual(1);
    }
  });

  it('reversing the endpoints keeps the length and swaps the endpoints', () => {
    // Bresenham may pick different mid cells each way; both are valid rasterizations.
    // The preview and the commit both walk start→end, so they never disagree.
    const fwd = lineCells(1, 1, 5, 3);
    const rev = lineCells(5, 3, 1, 1);
    expect(rev.length).toBe(fwd.length);
    expect(rev[0]).toEqual({ x: 5, y: 3 });
    expect(rev.at(-1)).toEqual({ x: 1, y: 1 });
  });
});
