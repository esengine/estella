// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { octantSnap, squareSnap } from '@/tools/tileTools';

describe('octantSnap (Shift-constrained lines)', () => {
  it('snaps near-horizontal drags onto the row', () => {
    expect(octantSnap(0, 0, 10, 2)).toEqual({ x: 10, y: 0 });
  });
  it('snaps near-vertical drags onto the column', () => {
    expect(octantSnap(0, 0, -2, 9)).toEqual({ x: 0, y: 9 });
  });
  it('snaps diagonal-ish drags to a 45° ray with max extent', () => {
    expect(octantSnap(0, 0, 7, 5)).toEqual({ x: 7, y: 7 });
    expect(octantSnap(3, 3, -4, 8)).toEqual({ x: 3 - 7, y: 3 + 7 });
  });
});

describe('squareSnap (Shift-constrained rect/ellipse)', () => {
  it('squares the box to the larger extent, keeping the drag quadrant', () => {
    expect(squareSnap(0, 0, 5, 2)).toEqual({ x: 5, y: 5 });
    expect(squareSnap(10, 10, 6, 12)).toEqual({ x: 6, y: 14 });
  });
});

import { ellipseRing, weightedSampler } from '@/tools/tileTools';
import { encodeTile } from 'esengine';

describe('ellipseRing (Alt-hollow ellipse)', () => {
  it('keeps only the outline for boxes with an interior', () => {
    const ring = ellipseRing(0, 0, 4, 4);
    const keys = new Set(ring.map((c) => `${c.x},${c.y}`));
    expect(keys.has('2,2')).toBe(false); // centre carved out
    expect(keys.has('2,0')).toBe(true);  // top of the ring survives
    expect(keys.has('0,2')).toBe(true);
  });
  it('degenerates to the full set when there is no interior', () => {
    expect(ellipseRing(0, 0, 1, 1).length).toBe(4);
  });
});

describe('weightedSampler (tile probability)', () => {
  const pool = [encodeTile(1), encodeTile(2)];
  it('never picks a zero-weight tile when another has weight', () => {
    const pick = weightedSampler(pool, (gid) => (gid === 1 ? 0 : 1));
    for (let i = 0; i < 50; i++) expect(pick()).toBe(pool[1]);
  });
  it('falls back to uniform when every weight is zero', () => {
    const pick = weightedSampler(pool, () => 0);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(pick());
    expect(seen.size).toBe(2);
  });
});
