// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    vec3.ts
 * @brief   Vec3 helpers operating on the canonical `Vec3` ({x,y,z}) type. Pure:
 *          every op returns a new Vec3. Exposed as the `v3` namespace.
 */

import type { Vec3 } from '../types';

export const v3 = {
    create(x = 0, y = 0, z = 0): Vec3 { return { x, y, z }; },
    clone(a: Vec3): Vec3 { return { x: a.x, y: a.y, z: a.z }; },

    add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
    sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
    scale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; },
    mul(a: Vec3, b: Vec3): Vec3 { return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z }; },
    neg(a: Vec3): Vec3 { return { x: -a.x, y: -a.y, z: -a.z }; },

    dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; },
    cross(a: Vec3, b: Vec3): Vec3 {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x,
        };
    },

    len(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); },
    len2(a: Vec3): number { return a.x * a.x + a.y * a.y + a.z * a.z; },
    dist(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); },

    normalize(a: Vec3): Vec3 {
        const l = Math.hypot(a.x, a.y, a.z);
        return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
    },
    lerp(a: Vec3, b: Vec3, t: number): Vec3 {
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
        };
    },

    equals(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
        return Math.abs(a.x - b.x) <= epsilon
            && Math.abs(a.y - b.y) <= epsilon
            && Math.abs(a.z - b.z) <= epsilon;
    },
} as const;
