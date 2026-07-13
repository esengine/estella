// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Ellipse tile enumeration — the ellipse tool's committed tiles AND its live
 *        drag preview both walk this (like lineCells for the line tool). Pins the
 *        small-size shapes (the quarter-cell radius pull-in that keeps a 3×3 a plus,
 *        not a filled square), degenerate boxes, symmetry, and corner ordering; plus
 *        the saved-stamp library's parse/add/remove contract.
 */
import { describe, it, expect } from 'vitest';
import { ellipseCells } from '@/tools/tileTools';
import { parseStampLibrary, serializeStampLibrary, addStamp, removeStampAt } from '@/tools/stampLibrary';

const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
const keys = (cells: { x: number; y: number }[]) => new Set(cells.map(key));

describe('ellipseCells', () => {
  it('a 1×1 box is the single cell', () => {
    expect(ellipseCells(2, 3, 2, 3)).toEqual([{ x: 2, y: 3 }]);
  });

  it('a 2×2 box stays fully filled (too small to round)', () => {
    expect(ellipseCells(0, 0, 1, 1)).toHaveLength(4);
  });

  it('a 3×3 box rounds to a plus — corners out', () => {
    const got = keys(ellipseCells(0, 0, 2, 2));
    expect(got).toEqual(new Set(['1,0', '0,1', '1,1', '2,1', '1,2']));
  });

  it('a 1×n box degenerates to a full line', () => {
    expect(ellipseCells(4, 0, 4, 4)).toHaveLength(5);
  });

  it('is corner-order independent and axis-symmetric', () => {
    const a = keys(ellipseCells(0, 0, 6, 4));
    expect(keys(ellipseCells(6, 4, 0, 0))).toEqual(a);
    // symmetric about the box centre (3, 2)
    for (const c of ellipseCells(0, 0, 6, 4)) {
      expect(a.has(`${6 - c.x},${4 - c.y}`)).toBe(true);
    }
  });

  it('a larger circle excludes corners but keeps the axis extremes', () => {
    const got = keys(ellipseCells(0, 0, 6, 6));
    expect(got.has('3,0')).toBe(true);
    expect(got.has('0,3')).toBe(true);
    expect(got.has('0,0')).toBe(false);
    expect(got.has('6,6')).toBe(false);
  });
});

describe('stamp library', () => {
  const stamp = { w: 2, h: 1, cells: [5, 9] };

  it('adds with auto-names and round-trips through serialization', () => {
    const lib = addStamp(addStamp([], stamp), { w: 1, h: 1, cells: [3] });
    expect(lib.map((e) => e.name)).toEqual(['S1', 'S2']);
    expect(parseStampLibrary(serializeStampLibrary(lib))).toEqual(lib);
  });

  it('deduplicates an identical stamp and reuses freed names', () => {
    let lib = addStamp([], stamp);
    expect(addStamp(lib, { w: 2, h: 1, cells: [5, 9] })).toBe(lib); // same cells → unchanged
    lib = addStamp(lib, { w: 1, h: 1, cells: [3] });
    lib = removeStampAt(lib, 0); // frees S1
    expect(addStamp(lib, stamp).map((e) => e.name)).toEqual(['S2', 'S1']);
  });

  it('drops garbage blobs and malformed entries', () => {
    expect(parseStampLibrary(null)).toEqual([]);
    expect(parseStampLibrary('not json')).toEqual([]);
    expect(parseStampLibrary('{"a":1}')).toEqual([]);
    const mixed = JSON.stringify([
      { name: 'ok', stamp },
      { name: 'bad', stamp: { w: 2, h: 2, cells: [1] } }, // cells ≠ w*h
      { stamp },                                          // no name
    ]);
    expect(parseStampLibrary(mixed).map((e) => e.name)).toEqual(['ok']);
  });
});
