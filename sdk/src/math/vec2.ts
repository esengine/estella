// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    vec2.ts
 * @brief   Vec2 helpers — the single TS source for 2D vector math, operating on
 *          the canonical `Vec2` ({x,y}) type. Pure: every op returns a new Vec2.
 *          Exposed as the `v2` namespace (e.g. `v2.add(a, b)`).
 */

import type { Vec2 } from '../types';

export const v2 = {
    create(x = 0, y = 0): Vec2 { return { x, y }; },
    clone(a: Vec2): Vec2 { return { x: a.x, y: a.y }; },

    add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; },
    sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; },
    /** Multiply by a scalar. */
    scale(a: Vec2, s: number): Vec2 { return { x: a.x * s, y: a.y * s }; },
    /** Component-wise multiply. */
    mul(a: Vec2, b: Vec2): Vec2 { return { x: a.x * b.x, y: a.y * b.y }; },
    neg(a: Vec2): Vec2 { return { x: -a.x, y: -a.y }; },

    dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; },
    /** 2D cross product (z component of the 3D cross). */
    cross(a: Vec2, b: Vec2): number { return a.x * b.y - a.y * b.x; },

    len(a: Vec2): number { return Math.hypot(a.x, a.y); },
    len2(a: Vec2): number { return a.x * a.x + a.y * a.y; },
    dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); },
    dist2(a: Vec2, b: Vec2): number { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },

    /** Unit vector, or {0,0} for a zero vector. */
    normalize(a: Vec2): Vec2 {
        const l = Math.hypot(a.x, a.y);
        return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
    },
    /** Linear interpolate a→b by t (t not clamped). */
    lerp(a: Vec2, b: Vec2, t: number): Vec2 {
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    },

    /** Angle in radians (atan2(y, x)). */
    angle(a: Vec2): number { return Math.atan2(a.y, a.x); },
    /** Vector from an angle (radians) and length. */
    fromAngle(radians: number, length = 1): Vec2 {
        return { x: Math.cos(radians) * length, y: Math.sin(radians) * length };
    },
    /** Rotate by `radians` about the origin. */
    rotate(a: Vec2, radians: number): Vec2 {
        const c = Math.cos(radians), s = Math.sin(radians);
        return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
    },
    /** Left perpendicular (90° CCW). */
    perp(a: Vec2): Vec2 { return { x: -a.y, y: a.x }; },

    equals(a: Vec2, b: Vec2, epsilon = 1e-6): boolean {
        return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
    },
} as const;
