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
