// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    poseMix.ts
 * @brief   Composing several weighted poses into the one that gets written.
 *
 * @details Every field is a weighted average over the poses that WROTE it, and
 *          the weights are renormalized per field. That is what lets a motion
 *          animating only position fade against one animating only rotation:
 *          each channel is shared out among its own contributors, so a field
 *          only one motion drives arrives whole instead of fading toward the
 *          base value.
 *
 *          Addition commutes, so the result does not depend on the order the
 *          poses were sampled or mixed - which is the property crossfade needs
 *          and the reason sampling writes here rather than into the world.
 */

import type { Pose, PoseTrack, PoseWorld } from './pose';

/** A pose and how much of it the result is made of. */
export interface WeightedPose {
    pose: Pose;
    weight: number;
}

interface Quat { w: number; x: number; y: number; z: number }

function isQuat(v: unknown): v is Quat {
    if (v === null || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return typeof o.w === 'number' && typeof o.x === 'number'
        && typeof o.y === 'number' && typeof o.z === 'number';
}

function isNumericObject(v: unknown): v is Record<string, number> {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const keys = Object.keys(v as object);
    if (keys.length === 0) return false;
    return keys.every(k => typeof (v as Record<string, unknown>)[k] === 'number');
}

/**
 * The representative of the pair {q, -q}, which name the same rotation. Applied
 * to the RESULT this is what makes the mix order-independent: aligning b to a or
 * a to b differs only in overall sign, and collapsing that leaves one answer.
 */
function canonicalize(out: Quat): void {
    if (out.w > 0) return;
    if (out.w < 0 || out.x < 0
        || (out.x === 0 && (out.y < 0 || (out.y === 0 && out.z < 0)))) {
        out.w = -out.w; out.x = -out.x; out.y = -out.y; out.z = -out.z;
    }
}

/**
 * Accumulate `q * weight` into `acc`, against the hemisphere `ref` names.
 * Without the alignment, two quaternions a full turn apart in representation
 * cancel instead of blending - the 180-degree flip a naive average produces.
 */
function accumulateQuat(acc: Quat, ref: Quat, q: Quat, weight: number): void {
    const dot = ref.w * q.w + ref.x * q.x + ref.y * q.y + ref.z * q.z;
    const s = dot < 0 ? -weight : weight;
    acc.w += q.w * s;
    acc.x += q.x * s;
    acc.y += q.y * s;
    acc.z += q.z * s;
}

function normalizeQuat(out: Quat): void {
    const len = Math.hypot(out.w, out.x, out.y, out.z);
    if (len < 1e-8) {
        out.w = 1; out.x = 0; out.y = 0; out.z = 0;
        return;
    }
    out.w /= len; out.x /= len; out.y /= len; out.z /= len;
}

/** The contributors to one component, gathered once per mixed track. */
interface Contribution {
    track: PoseTrack;
    weight: number;
}

function mixQuaternionField(field: string, parts: Contribution[], into: Record<string, unknown>): void {
    // The first contributor names the hemisphere the rest align to. WHICH one it
    // is does not change the rotation that comes out - see canonicalize.
    let ref: Quat | null = null;
    const acc: Quat = { w: 0, x: 0, y: 0, z: 0 };
    for (const part of parts) {
        const value = part.track.data[field];
        if (!isQuat(value)) continue;
        if (ref === null) ref = value;
        accumulateQuat(acc, ref, value, part.weight);
    }
    if (ref === null) return;
    normalizeQuat(acc);
    canonicalize(acc);
    // `+ 0` collapses -0 to 0. Negating a zero component leaves one, and while
    // it compares equal it is still a trace of which hemisphere was picked -
    // enough to make two orderings differ bit for bit.
    const dst = (into[field] ??= {}) as Record<string, number>;
    dst.w = acc.w + 0; dst.x = acc.x + 0; dst.y = acc.y + 0; dst.z = acc.z + 0;
}

function mixNumericObjectField(
    field: string, parts: Contribution[], total: number, into: Record<string, unknown>,
): void {
    const dst = (into[field] ??= {}) as Record<string, number>;
    const sums: Record<string, number> = {};
    for (const part of parts) {
        const value = part.track.data[field];
        if (!isNumericObject(value)) continue;
        for (const axis of Object.keys(value)) {
            sums[axis] = (sums[axis] ?? 0) + value[axis]! * part.weight;
        }
    }
    for (const axis of Object.keys(sums)) dst[axis] = sums[axis]! / total;
}

function mixScalarField(
    field: string, parts: Contribution[], total: number, into: Record<string, unknown>,
): void {
    let sum = 0;
    for (const part of parts) {
        const value = part.track.data[field];
        if (typeof value === 'number') sum += value * part.weight;
    }
    into[field] = sum / total;
}

/**
 * Blend `sources` into `out`, then write it. Weights need not sum to one: each
 * field divides by the weight that actually reached it.
 *
 * `out` is seeded from the world like any pose, so a component some motion
 * touches only partly keeps its other fields.
 */
export function mixPoses(sources: readonly WeightedPose[], out: Pose, world: PoseWorld): void {
    out.reset();

    const byComponent = new Map<string, Contribution[]>();
    for (const { pose, weight } of sources) {
        if (weight <= 0) continue;
        for (const track of pose.tracks) {
            if (track.touched.size === 0) continue;
            const key = `${track.entity} ${track.def._name}`;
            const list = byComponent.get(key);
            if (list) list.push({ track, weight });
            else byComponent.set(key, [{ track, weight }]);
        }
    }

    for (const parts of byComponent.values()) {
        const first = parts[0]!;
        const target = out.track(world, first.track.entity, first.track.def);
        if (!target) continue;

        // Per FIELD, not per track: the weights that count are the ones whose
        // motion wrote this field.
        const fields = new Set<string>();
        for (const part of parts) for (const f of part.track.touched) fields.add(f);

        for (const field of fields) {
            const writers: Contribution[] = [];
            let total = 0;
            for (const part of parts) {
                if (!part.track.touched.has(field)) continue;
                writers.push(part);
                total += part.weight;
            }
            if (total <= 0) continue;

            const sample = writers[0]!.track.data[field];
            if (isQuat(sample)) mixQuaternionField(field, writers, target.data);
            else if (typeof sample === 'number') mixScalarField(field, writers, total, target.data);
            else if (isNumericObject(sample)) {
                mixNumericObjectField(field, writers, total, target.data);
            } else {
                // Nothing to average between (a string, a flag). Left at the base
                // value rather than picked from one side, which would make the
                // answer depend on which motion was sampled first.
                continue;
            }
            target.touched.add(field);
        }
    }
}
