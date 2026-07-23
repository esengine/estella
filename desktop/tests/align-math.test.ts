// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { alignTargets, distributeTargets, type AlignBox } from '../src/tools/alignMath';

// Three boxes on one row (y-up, all at cy=5, height 10):
//   A  left 0..10   (w10, cx 5)
//   B  left 20..40  (w20, cx 30)
//   C  left 100..110 (w10, cx 105)
const row = (): AlignBox[] => [
  { minX: 0, maxX: 10, minY: 0, maxY: 10, cx: 5, cy: 5 },
  { minX: 20, maxX: 40, minY: 0, maxY: 10, cx: 30, cy: 5 },
  { minX: 100, maxX: 110, minY: 0, maxY: 10, cx: 105, cy: 5 },
];

describe('alignTargets', () => {
  it('left aligns every left edge to the minimum, preserving y', () => {
    const t = alignTargets(row(), 'left');
    // left edge → 0, so cx = 0 + halfWidth
    expect(t.map((p) => p.cx)).toEqual([5, 10, 5]);
    expect(t.every((p) => p.cy === 5)).toBe(true);
  });

  it('right aligns every right edge to the maximum', () => {
    const t = alignTargets(row(), 'right');
    // right edge → 110, so cx = 110 - halfWidth
    expect(t.map((p) => p.cx)).toEqual([105, 100, 105]);
  });

  it('hcenter puts every center on the union-bbox center', () => {
    const t = alignTargets(row(), 'hcenter');
    expect(t.map((p) => p.cx)).toEqual([55, 55, 55]); // (0+110)/2
  });

  it('top/bottom/vmiddle move on y only (y-up: top = maxY)', () => {
    const boxes: AlignBox[] = [
      { minX: 0, maxX: 10, minY: 0, maxY: 10, cx: 5, cy: 5 },
      { minX: 0, maxX: 10, minY: 40, maxY: 60, cx: 5, cy: 50 },
    ];
    expect(alignTargets(boxes, 'top').map((p) => p.cy)).toEqual([55, 50]); // top → 60
    expect(alignTargets(boxes, 'bottom').map((p) => p.cy)).toEqual([5, 10]); // bottom → 0 (B: 50+(0-40))
    expect(alignTargets(boxes, 'vmiddle').map((p) => p.cy)).toEqual([30, 30]); // (0+60)/2
    expect(alignTargets(boxes, 'top').every((p) => p.cx === 5)).toBe(true);
  });
});

describe('distributeTargets', () => {
  it('spreads interior boxes to equal edge gaps, extremes fixed', () => {
    const t = distributeTargets(row(), 'h');
    // span 110, widths 40, gap = 70/2 = 35: A stays, B.left→45 (cx 55), C stays.
    expect(t.map((p) => p.cx)).toEqual([5, 55, 105]);
    // gaps A→B and B→C are equal (35 each)
    const boxesAfter = row().map((b, i) => ({ ...b, minX: t[i].cx - (b.maxX - b.minX) / 2, maxX: t[i].cx + (b.maxX - b.minX) / 2 }));
    boxesAfter.sort((a, b) => a.minX - b.minX);
    expect(boxesAfter[1].minX - boxesAfter[0].maxX).toBeCloseTo(boxesAfter[2].minX - boxesAfter[1].maxX, 6);
  });

  it('is a no-op below three boxes', () => {
    const two = row().slice(0, 2);
    expect(distributeTargets(two, 'h')).toEqual(two.map((b) => ({ cx: b.cx, cy: b.cy })));
  });

  it('distributes vertically on y', () => {
    const col: AlignBox[] = [
      { minX: 0, maxX: 10, minY: 0, maxY: 10, cx: 5, cy: 5 },
      { minX: 0, maxX: 10, minY: 30, maxY: 50, cx: 5, cy: 40 },
      { minX: 0, maxX: 10, minY: 100, maxY: 110, cx: 5, cy: 105 },
    ];
    const t = distributeTargets(col, 'v');
    // span 110, heights 40, gap 35: bottom stays (cy5), mid.bottom→45 (cy55), top stays.
    expect(t.map((p) => p.cy)).toEqual([5, 55, 105]);
  });
});
