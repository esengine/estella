// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    quatMix.ts
 * @brief   Averaging rotations, for everything in the animator that averages one.
 *
 * @details {q} and {-q} name the same rotation, so a naive average of two that
 *          are written a turn apart cancels toward the long way round instead of
 *          meeting them halfway. Every consumer here has to align hemispheres
 *          first, and three of them had written that out separately — the pose
 *          mixer, the layer stack and a blend's displacement. The rule is easy to
 *          get subtly right in one place and subtly wrong in the next, which is
 *          the kind of thing that belongs in one.
 */

export interface QuatLike { w: number; x: number; y: number; z: number }

export function isQuatLike(v: unknown): v is QuatLike {
    if (v === null || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return typeof o.w === 'number' && typeof o.x === 'number'
        && typeof o.y === 'number' && typeof o.z === 'number';
}

export function normalizeQuat(out: QuatLike): void {
    const len = Math.hypot(out.w, out.x, out.y, out.z);
    if (len < 1e-8) {
        out.w = 1; out.x = 0; out.y = 0; out.z = 0;
        return;
    }
    out.w /= len; out.x /= len; out.y /= len; out.z /= len;
}

/**
 * The representative of the pair {q, -q}. Applied to a RESULT this is what makes
 * a mix order-independent: aligning b to a or a to b differs only in overall
 * sign, and collapsing that leaves one answer.
 */
export function canonicalizeQuat(out: QuatLike): void {
    if (out.w > 0) return;
    if (out.w < 0 || out.x < 0
        || (out.x === 0 && (out.y < 0 || (out.y === 0 && out.z < 0)))) {
        out.w = -out.w; out.x = -out.x; out.y = -out.y; out.z = -out.z;
    }
}

/** Accumulate `q * weight` into `acc`, against the hemisphere `ref` names. */
export function accumulateQuat(
    acc: QuatLike, ref: QuatLike, q: QuatLike, weight: number,
): void {
    const dot = ref.w * q.w + ref.x * q.x + ref.y * q.y + ref.z * q.z;
    const s = dot < 0 ? -weight : weight;
    acc.w += q.w * s;
    acc.x += q.x * s;
    acc.y += q.y * s;
    acc.z += q.z * s;
}

/** Move `dst` a `weight` share of the way to `src`, the short way round. */
export function leanQuat(dst: QuatLike, src: QuatLike, weight: number): void {
    const dot = dst.w * src.w + dst.x * src.x + dst.y * src.y + dst.z * src.z;
    const s = dot < 0 ? -weight : weight;
    const keep = 1 - weight;
    dst.w = dst.w * keep + src.w * s;
    dst.x = dst.x * keep + src.x * s;
    dst.y = dst.y * keep + src.y * s;
    dst.z = dst.z * keep + src.z * s;
    normalizeQuat(dst);
}

/** `to` relative to `from`, written into `out` — the turn one states over the other. */
export function deltaQuat(out: QuatLike, from: QuatLike, to: QuatLike): void {
    out.w = to.w * from.w + to.x * from.x + to.y * from.y + to.z * from.z;
    out.x = to.x * from.w - to.w * from.x - to.y * from.z + to.z * from.y;
    out.y = to.y * from.w - to.w * from.y - to.z * from.x + to.x * from.z;
    out.z = to.z * from.w - to.w * from.z - to.x * from.y + to.y * from.x;
}

/** `dst = by * dst`, turning `dst` further by `by`. */
export function turnByQuat(dst: QuatLike, by: QuatLike): void {
    const w = by.w * dst.w - by.x * dst.x - by.y * dst.y - by.z * dst.z;
    const x = by.w * dst.x + by.x * dst.w + by.y * dst.z - by.z * dst.y;
    const y = by.w * dst.y - by.x * dst.z + by.y * dst.w + by.z * dst.x;
    const z = by.w * dst.z + by.x * dst.y - by.y * dst.x + by.z * dst.w;
    dst.w = w; dst.x = x; dst.y = y; dst.z = z;
    normalizeQuat(dst);
}
