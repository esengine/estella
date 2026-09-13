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
import {
    accumulateQuat, canonicalizeQuat, isQuatLike as isQuat, normalizeQuat,
    type QuatLike as Quat,
} from './quatMix';

/** A pose and how much of it the result is made of. */
export interface WeightedPose {
    pose: Pose;
    weight: number;
}

function isNumericObject(v: unknown): v is Record<string, number> {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const keys = Object.keys(v as object);
    if (keys.length === 0) return false;
    return keys.every(k => typeof (v as Record<string, unknown>)[k] === 'number');
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
    canonicalizeQuat(acc);
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
 * field divides by the weight that actually reached it. `out` is seeded from the
 * world like any pose, so a component some motion touches only partly keeps its
 * other fields; `count` reads a prefix, so a varying blend need not allocate.
 */
export function mixPoses(
    sources: readonly WeightedPose[], out: Pose, world: PoseWorld,
    count: number = sources.length,
): void {
    out.reset();

    const byComponent = new Map<string, Contribution[]>();
    for (let i = 0; i < count; i++) {
        const { pose, weight } = sources[i]!;
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
