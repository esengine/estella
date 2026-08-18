// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Local-space gizmo math: the handles standing in the entity's own frame
 *        (the Local/World coordinate-space toggle).
 *
 *        Local space is a ROTATION of the world axes, not an angle applied to the
 *        screen — the screen-angle form could only ever express a turn about Z,
 *        and it had to be negated at one call site and not the other.
 */
import { describe, it, expect } from 'vitest';
import { HEAD_ON, hitTestGizmo, constrainDelta, axisHandles, GIZMO } from '@/tools/gizmo';

const pivot = { x: 100, y: 100 };
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

/** A turn of `rad` about world Z — the rotation a 2D entity has. */
const spinZ = (rad: number) => ({ x: 0, y: 0, z: Math.sin(rad / 2), w: Math.cos(rad / 2) });
/** A turn of `rad` about world X — a pose no screen angle could describe. */
const spinX = (rad: number) => ({ x: Math.sin(rad / 2), y: 0, z: 0, w: Math.cos(rad / 2) });

const delta = { x: 3, y: 4, z: 0 };

describe('constrainDelta in a local frame', () => {
  it('is the world constraint with no rotation', () => {
    const a = constrainDelta('x', delta);
    close(a.x, 3); close(a.y, 0); close(a.z, 0);
    const b = constrainDelta('y', delta);
    close(b.x, 0); close(b.y, 4); close(b.z, 0);
    expect(constrainDelta('xy', delta)).toEqual(delta);
  });

  it('projects onto the rotated local axis (90° about Z)', () => {
    // Local X = world +Y: the x-handle slides along world +Y, so (3,4) → (0,4).
    const a = constrainDelta('x', delta, spinZ(Math.PI / 2));
    close(a.x, 0); close(a.y, 4); close(a.z, 0);
    // Local Y = world −X, so (3,4) → (3,0) — the same magnitude, the other axis.
    const b = constrainDelta('y', delta, spinZ(Math.PI / 2));
    close(b.x, 3); close(b.y, 0); close(b.z, 0);
  });

  // What the screen-angle form could not say at all.
  it('projects onto an axis turned out of the plane', () => {
    // 90° about X takes local Y onto world +Z, so a delta in z is what it keeps.
    const a = constrainDelta('y', { x: 3, y: 4, z: 7 }, spinX(Math.PI / 2));
    close(a.x, 0); close(a.y, 0); close(a.z, 7);
  });

  it('leaves a plane handle unconstrained in any frame', () => {
    expect(constrainDelta('xy', delta, spinZ(1.234))).toEqual(delta);
  });

  it('keeps only the component along a 45° local axis', () => {
    // Local X = (√½, √½, 0); a delta perpendicular to it projects to ~0.
    const a = constrainDelta('x', { x: 1, y: -1, z: 0 }, spinZ(Math.PI / 4));
    close(a.x, 0); close(a.y, 0); close(a.z, 0);
  });
});

describe('hitTestGizmo in a local frame', () => {
  it('no rotation is unchanged (world +X hits move.x)', () => {
    const h = hitTestGizmo('move', HEAD_ON, pivot, { x: pivot.x + GIZMO.axisLen, y: pivot.y });
    expect(h?.axis).toBe('x');
  });

  it('turns the x-arrow: at 90° about Z it points where world +Y does', () => {
    // Local X = world +Y, which is screen UP — the direction the arrow is drawn,
    // because both come from the same call.
    const up = { x: pivot.x, y: pivot.y - GIZMO.axisLen };
    expect(hitTestGizmo('move', HEAD_ON, pivot, up, spinZ(Math.PI / 2))?.axis).toBe('x');
    const worldX = { x: pivot.x + GIZMO.axisLen, y: pivot.y };
    expect(hitTestGizmo('move', HEAD_ON, pivot, worldX, spinZ(Math.PI / 2))?.axis).not.toBe('x');
  });

  // The aim and the drawing are one call, so they cannot disagree.
  it('aims at exactly where it draws the arrow', () => {
    for (const rot of [undefined, spinZ(0.7), spinX(0.9)]) {
      for (const h of axisHandles(HEAD_ON, rot)) {
        const tip = { x: pivot.x + h.dir.x * GIZMO.axisLen, y: pivot.y + h.dir.y * GIZMO.axisLen };
        expect(hitTestGizmo('move', HEAD_ON, pivot, tip, rot)?.axis).toBe(h.axis);
      }
    }
  });
});
