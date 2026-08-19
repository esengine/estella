// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    quat.ts
 * @brief   Quaternion helpers operating on the canonical `Quat` ({w,x,y,z})
 *          type. Pure: every op returns a new Quat. Exposed as the `q` namespace.
 *
 * A rotation is a quaternion everywhere it is stored, and every place that lets
 * someone name one in a friendlier way — a Z angle in a 2D scene, three euler
 * degrees in the inspector, a rotation channel in a timeline — is a way IN, not
 * a second representation. Each such entry point that rebuilt the whole
 * quaternion from its own axis flattened the other two; keeping the conversions
 * here is what lets those entries compose instead of overwrite.
 */

import type { Quat, Vec3 } from '../types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export const q = {
    create(w = 1, x = 0, y = 0, z = 0): Quat { return { w, x, y, z }; },
    clone(a: Quat): Quat { return { w: a.w, x: a.x, y: a.y, z: a.z }; },

    /** `a` applied after `b` (a·b) — a world-space turn composes on the left. */
    mul(a: Quat, b: Quat): Quat {
        return {
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        };
    },

    /** A turn of `rad` about one axis. */
    axis(axis: 'x' | 'y' | 'z', rad: number): Quat {
        const s = Math.sin(rad / 2);
        return {
            w: Math.cos(rad / 2),
            x: axis === 'x' ? s : 0,
            y: axis === 'y' ? s : 0,
            z: axis === 'z' ? s : 0,
        };
    },

    /**
     * Unit length. Interpolating quaternions component-wise leaves a shorter
     * one, and writing that scales the model — so anything that lerps must end
     * here.
     */
    normalize(a: Quat): Quat {
        const len = Math.hypot(a.w, a.x, a.y, a.z);
        if (len === 0) return { w: 1, x: 0, y: 0, z: 0 };
        return { w: a.w / len, x: a.x / len, y: a.y / len, z: a.z / len };
    },

    dot(a: Quat, b: Quat): number { return a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z; },

    /** Negated. `-q` and `q` are the same rotation; which one is stored decides
     *  whether a component-wise interpolation takes the short arc or the long one. */
    neg(a: Quat): Quat { return { w: -a.w, x: -a.x, y: -a.y, z: -a.z }; },

    /** The opposite turn. For a unit quaternion — which every stored rotation is
     *  — this is the inverse, and a world direction taken into a local frame by it. */
    conjugate(a: Quat): Quat { return { w: a.w, x: -a.x, y: -a.y, z: -a.z }; },

    /** A vector turned by this rotation (q·v·q⁻¹, expanded). */
    rotate(a: Quat, v: Vec3): Vec3 {
        const tx = 2 * (a.y * v.z - a.z * v.y);
        const ty = 2 * (a.z * v.x - a.x * v.z);
        const tz = 2 * (a.x * v.y - a.y * v.x);
        return {
            x: v.x + a.w * tx + a.y * tz - a.z * ty,
            y: v.y + a.w * ty + a.z * tx - a.x * tz,
            z: v.z + a.w * tz + a.x * ty - a.y * tx,
        };
    },

    /**
     * A rotation as three degrees, applied X then Y then Z about fixed axes —
     * the order every DCC's inspector shows. A rotation purely about Z reads
     * back as (0, 0, angle) and rebuilds exactly.
     */
    toEuler(a: Quat): [number, number, number] {
        const { x, y, z, w } = a;
        const r00 = 1 - 2 * (y * y + z * z);
        const r10 = 2 * (x * y + w * z);
        const r20 = 2 * (x * z - w * y);
        const r21 = 2 * (y * z + w * x);
        const r22 = 1 - 2 * (x * x + y * y);
        const pitch = Math.asin(Math.max(-1, Math.min(1, -r20)));
        // At a pole the outer two axes name the same turn; charge it all to Z,
        // so the one a 2D scene uses survives a round trip through the pole.
        if (Math.abs(r20) > 0.999999) {
            const r01 = 2 * (x * y - w * z);
            const r11 = 1 - 2 * (x * x + z * z);
            return [0, pitch * RAD2DEG, Math.atan2(-r01, r11) * RAD2DEG];
        }
        return [Math.atan2(r21, r22) * RAD2DEG, pitch * RAD2DEG, Math.atan2(r10, r00) * RAD2DEG];
    },

    /** Inverse of {@link toEuler}. */
    fromEuler(deg: readonly number[]): Quat {
        const hx = ((deg[0] ?? 0) * DEG2RAD) / 2;
        const hy = ((deg[1] ?? 0) * DEG2RAD) / 2;
        const hz = ((deg[2] ?? 0) * DEG2RAD) / 2;
        const [cx, cy, cz] = [Math.cos(hx), Math.cos(hy), Math.cos(hz)];
        const [sx, sy, sz] = [Math.sin(hx), Math.sin(hy), Math.sin(hz)];
        return {
            w: cx * cy * cz + sx * sy * sz,
            x: sx * cy * cz - cx * sy * sz,
            y: cx * sy * cz + sx * cy * sz,
            z: cx * cy * sz - sx * sy * cz,
        };
    },

    /**
     * The shortest turn taking `from` to `to`; either may be any length. A
     * direction is a way of naming a rotation, so it comes in here — what is
     * stored stays the rotation. Roll about the axis is unconstrained by the pair
     * and is left at none, which is what an aim has to say about it.
     */
    rotationTo(from: Vec3, to: Vec3): Quat {
        const fl = Math.hypot(from.x, from.y, from.z);
        const tl = Math.hypot(to.x, to.y, to.z);
        if (fl === 0 || tl === 0) return { w: 1, x: 0, y: 0, z: 0 };
        const f = { x: from.x / fl, y: from.y / fl, z: from.z / fl };
        const t = { x: to.x / tl, y: to.y / tl, z: to.z / tl };
        const d = f.x * t.x + f.y * t.y + f.z * t.z;
        if (d >= 1 - 1e-9) return { w: 1, x: 0, y: 0, z: 0 };
        // Opposite: every axis perpendicular to `from` is a half turn taking it to
        // `to`, so pick one that exists for any `from` rather than a fixed axis it
        // could be parallel to.
        if (d <= -1 + 1e-9) {
            const axis = Math.abs(f.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
            const px = f.y * axis.z - f.z * axis.y;
            const py = f.z * axis.x - f.x * axis.z;
            const pz = f.x * axis.y - f.y * axis.x;
            return this.normalize({ w: 0, x: px, y: py, z: pz });
        }
        return this.normalize({
            w: 1 + d,
            x: f.y * t.z - f.z * t.y,
            y: f.z * t.x - f.x * t.z,
            z: f.x * t.y - f.y * t.x,
        });
    },

    /** Set the Z turn, keeping whatever the other two axes say — the 2D way in. */
    setAngleZ(a: Quat | undefined, deg: number): Quat {
        const e = a ? this.toEuler(a) : [0, 0, 0];
        return this.fromEuler([e[0], e[1], deg]);
    },

    /** The Z turn of a 2D rotation, in radians. */
    angleZ(a: Pick<Quat, 'z' | 'w'>): number { return 2 * Math.atan2(a.z, a.w); },
};
