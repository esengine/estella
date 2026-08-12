// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pivot-handle math: dragging a sprite's pivot must not move the sprite.
 *
 * The whole point of the handle is choosing a turning point on art that is already
 * placed, so every case here asserts the same invariant — the artwork's corner is
 * where it was — rather than the formula that happens to produce it.
 */
import { describe, it, expect } from 'vitest';
import { pivotDrag, type PivotFrame } from '@/tools/gizmo';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

/** Where the sprite's local (0,0) corner sits in the world: `pos − R·(size·pivot)`,
 *  the same expression the renderer draws from. */
function corner(pos: { x: number; y: number }, rot: number, w: number, h: number, pivot: { x: number; y: number }) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const lx = -w * pivot.x, ly = -h * pivot.y;
  return { x: pos.x + lx * cos - ly * sin, y: pos.y + lx * sin + ly * cos };
}

const frame = (over: Partial<PivotFrame> = {}): PivotFrame => ({
  origin: { x: 0, y: 0 }, rot: 0, w: 200, h: 100, pivot: { x: 0.5, y: 0.5 }, ...over,
});

describe('pivotDrag', () => {
  it('is a no-op when the cursor has not left the handle', () => {
    const f = frame();
    const r = pivotDrag(f, f.origin);
    close(r.pivot.x, 0.5); close(r.pivot.y, 0.5);
    close(r.pos.x, 0); close(r.pos.y, 0);
  });

  it('reads the cursor as a fraction of the sprite, per axis', () => {
    // Half a width right and a quarter height up, on a 200×100 sprite.
    const r = pivotDrag(frame(), { x: 100, y: 25 });
    close(r.pivot.x, 1);
    close(r.pivot.y, 0.75);
  });

  it('leaves the artwork exactly where it was', () => {
    const f = frame();
    const before = corner({ x: 0, y: 0 }, f.rot, f.w, f.h, f.pivot);
    const r = pivotDrag(f, { x: 37, y: -19 });
    const after = corner(r.pos, f.rot, f.w, f.h, r.pivot);
    close(after.x, before.x); close(after.y, before.y);
  });

  it('leaves the artwork where it was under rotation and scale', () => {
    // w/h carry the world scale, so a scaled sprite is just a bigger denominator.
    const f = frame({ origin: { x: -40, y: 12 }, rot: Math.PI / 3, w: 200 * 2.5, h: 100 * 0.4 });
    const before = corner(f.origin, f.rot, f.w, f.h, f.pivot);
    const r = pivotDrag(f, { x: 128, y: -64 });
    const after = corner(r.pos, f.rot, f.w, f.h, r.pivot);
    close(after.x, before.x, 1e-8); close(after.y, before.y, 1e-8);
  });

  it('measures along the sprite\'s own axes, not the world\'s', () => {
    // At 90° the sprite's local +X points along world +Y and its local +Y along world
    // −X. A diagonal drag pins both axes AND both signs — an axis swapped or negated
    // here looks perfectly correct on every upright sprite.
    const r = pivotDrag(frame({ rot: Math.PI / 2 }), { x: 50, y: 100 });
    close(r.pivot.x, 1);
    close(r.pivot.y, 0);
  });

  it('lets the pivot leave the sprite, which is a legal hinge', () => {
    const r = pivotDrag(frame(), { x: -300, y: 0 });
    close(r.pivot.x, -1);
    expect(Number.isFinite(r.pivot.x)).toBe(true);
  });
});
