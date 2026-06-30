// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Local-space gizmo math: axis-rotated hit-testing + local-frame delta
 *        constraint (the Local/World coordinate-space toggle).
 */
import { describe, it, expect } from 'vitest';
import { hitTestGizmo, constrainLocalDelta, constrainWorldDelta, GIZMO } from '@/tools/gizmo';

const pivot = { x: 100, y: 100 };
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('constrainLocalDelta', () => {
  it('matches constrainWorldDelta at angle 0', () => {
    // Per-component (signed-zero: -0 is numerically equal but `toEqual` distinguishes it).
    const [ax, ay] = constrainLocalDelta('x', 3, 4, 0);
    close(ax, 3); close(ay, 0);
    const [bx, by] = constrainLocalDelta('y', 3, 4, 0);
    close(bx, 0); close(by, 4);
    expect(constrainLocalDelta('xy', 3, 4, 0)).toEqual([3, 4]);
  });

  it('projects onto the rotated local axis (90°)', () => {
    // Local X = (0,1): the x-handle slides along world +Y, so (3,4) → (0,4).
    const [x1, y1] = constrainLocalDelta('x', 3, 4, Math.PI / 2);
    close(x1, 0); close(y1, 4);
    // Local Y = (-1,0): the y-handle slides along world −X, so (3,4) → (3,0).
    const [x2, y2] = constrainLocalDelta('y', 3, 4, Math.PI / 2);
    close(x2, 3); close(y2, 0);
  });

  it('leaves xy unconstrained at any angle', () => {
    expect(constrainLocalDelta('xy', 3, 4, 1.234)).toEqual([3, 4]);
  });

  it('keeps only the component along a 45° local axis', () => {
    // Local X = (√½, √½); a delta perpendicular to it projects to ~0.
    const [x, y] = constrainLocalDelta('x', 1, -1, Math.PI / 4);
    close(x, 0); close(y, 0);
  });
});

describe('hitTestGizmo with axisAngleRad', () => {
  it('angle 0 is unchanged (world +X hits move.x)', () => {
    const h = hitTestGizmo('move', pivot, { x: pivot.x + GIZMO.axisLen, y: pivot.y }, 0);
    expect(h?.axis).toBe('x');
  });

  it('rotates the x-arrow: at 90° the x-handle points along screen +Y', () => {
    // rotDir((1,0), 90°) = (0,1) → xEnd at (100, 100+axisLen).
    const onRotatedX = hitTestGizmo('move', pivot, { x: pivot.x, y: pivot.y + GIZMO.axisLen }, Math.PI / 2);
    expect(onRotatedX?.axis).toBe('x');
    // The old world +X spot is no longer the x-handle.
    const offWorldX = hitTestGizmo('move', pivot, { x: pivot.x + GIZMO.axisLen, y: pivot.y }, Math.PI / 2);
    expect(offWorldX?.axis).not.toBe('x');
  });
});
