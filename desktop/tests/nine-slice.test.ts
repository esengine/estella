// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The 9-slice border editor's geometry. Pure functions, no DOM: the
 *        letterbox fit, the box↔texture conversion a drag goes through, and the
 *        clamping rule that keeps a centre slice alive.
 */
import { describe, it, expect } from 'vitest';
import {
  fitRect, clampEdge, clampBorder, edgeFromPointer, guidePosition, pickEdge,
  hasBorder, borderFromImporter, type SliceBorder,
} from '@/project/nineSlice';

const B = (left = 0, right = 0, top = 0, bottom = 0): SliceBorder => ({ left, right, top, bottom });

describe('fitRect', () => {
  it('letterboxes a wide texture into a square box and centres it', () => {
    const f = fitRect(200, 100, 100, 100);
    expect(f.scale).toBe(0.5);
    expect(f).toMatchObject({ x: 0, y: 25, w: 100, h: 50 });
  });

  it('pillarboxes a tall texture', () => {
    const f = fitRect(100, 200, 100, 100);
    expect(f).toMatchObject({ x: 25, y: 0, w: 50, h: 100, scale: 0.5 });
  });

  it('degenerates safely on a zero-sized texture or box', () => {
    expect(fitRect(0, 100, 50, 50)).toMatchObject({ w: 0, h: 0 });
    expect(fitRect(100, 100, 0, 50)).toMatchObject({ w: 0, h: 0 });
  });
});

describe('clampEdge', () => {
  it('snaps to whole pixels and floors at zero', () => {
    expect(clampEdge(12.4, 0, 100)).toBe(12);
    expect(clampEdge(-5, 0, 100)).toBe(0);
  });

  it('leaves at least one pixel of centre slice against the opposite edge', () => {
    // 100 wide with a 40px opposite border → this edge may reach 59, not 60.
    expect(clampEdge(999, 40, 100)).toBe(59);
    expect(clampEdge(59, 40, 100)).toBe(59);
  });

  it('collapses to zero when the opposite edge already fills the texture', () => {
    expect(clampEdge(10, 100, 100)).toBe(0);
  });
});

describe('clampBorder', () => {
  it('passes a legal border through untouched', () => {
    expect(clampBorder(B(10, 12, 8, 9), 64, 64)).toEqual(B(10, 12, 8, 9));
  });

  it('reins in a hand-edited .meta whose borders overlap', () => {
    const c = clampBorder(B(60, 60, 0, 0), 64, 64);
    expect(c.left).toBe(60);
    expect(c.right).toBe(3); // 64 - 60 - 1
  });
});

describe('edgeFromPointer', () => {
  // A 100x100 texture drawn 1:1 at the box origin.
  const fit = fitRect(100, 100, 100, 100);

  it('measures left/top from the near edge', () => {
    expect(edgeFromPointer('left', { x: 20, y: 50 }, fit, B(), 100, 100)).toBe(20);
    expect(edgeFromPointer('top', { x: 50, y: 15 }, fit, B(), 100, 100)).toBe(15);
  });

  it('measures right/bottom from the FAR edge', () => {
    expect(edgeFromPointer('right', { x: 70, y: 50 }, fit, B(), 100, 100)).toBe(30);
    expect(edgeFromPointer('bottom', { x: 50, y: 80 }, fit, B(), 100, 100)).toBe(20);
  });

  it('converts through the letterbox scale and offset', () => {
    const half = fitRect(200, 200, 100, 100); // scale 0.5, no offset
    expect(edgeFromPointer('left', { x: 20, y: 0 }, half, B(), 200, 200)).toBe(40);
    const boxed = fitRect(100, 50, 100, 100); // scale 1, y offset 25
    expect(edgeFromPointer('top', { x: 0, y: 35 }, boxed, B(), 100, 50)).toBe(10);
  });

  it('cannot be dragged past its opposite edge', () => {
    expect(edgeFromPointer('left', { x: 95, y: 50 }, fit, B(0, 30), 100, 100)).toBe(69);
  });

  it('is a no-op on a degenerate fit', () => {
    expect(edgeFromPointer('left', { x: 10, y: 10 }, fitRect(0, 0, 0, 0), B(7), 0, 0)).toBe(7);
  });
});

describe('guidePosition', () => {
  it('round-trips with edgeFromPointer', () => {
    const fit = fitRect(128, 64, 256, 256); // scale 2, y offset 64
    const border = B(12, 20, 5, 9);
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const at = guidePosition(edge, border, fit, 128, 64);
      const p = edge === 'left' || edge === 'right' ? { x: at, y: 0 } : { x: 0, y: at };
      expect(edgeFromPointer(edge, p, fit, border, 128, 64)).toBe(border[edge]);
    }
  });
});

describe('pickEdge', () => {
  const fit = fitRect(100, 100, 100, 100);
  const border = B(20, 20, 20, 20);

  it('grabs the guide under the pointer', () => {
    expect(pickEdge({ x: 21, y: 50 }, border, fit, 100, 100)).toBe('left');
    expect(pickEdge({ x: 79, y: 50 }, border, fit, 100, 100)).toBe('right');
    expect(pickEdge({ x: 50, y: 22 }, border, fit, 100, 100)).toBe('top');
  });

  it('grabs nothing in open space, so a stray click cannot nudge a border', () => {
    expect(pickEdge({ x: 50, y: 50 }, border, fit, 100, 100)).toBeNull();
  });

  it('honours the slop radius', () => {
    expect(pickEdge({ x: 28, y: 50 }, border, fit, 100, 100, 2)).toBeNull();
    expect(pickEdge({ x: 28, y: 50 }, border, fit, 100, 100, 10)).toBe('left');
  });
});

describe('reading a border', () => {
  it('hasBorder is false only when every edge is zero', () => {
    expect(hasBorder(B())).toBe(false);
    expect(hasBorder(B(0, 0, 1))).toBe(true);
  });

  it('borderFromImporter tolerates a missing or junk block', () => {
    expect(borderFromImporter(null)).toEqual(B());
    expect(borderFromImporter({})).toEqual(B());
    expect(borderFromImporter({ sliceBorder: { left: 8, right: 'x', top: null } })).toEqual(B(8));
    expect(borderFromImporter({ sliceBorder: { left: 4, right: 5, top: 6, bottom: 7 } })).toEqual(B(4, 5, 6, 7));
  });
});
