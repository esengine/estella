// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    layerStack.ts
 * @brief   Laying one layer's pose over what the layers under it already said.
 *
 * @details This is the operation {@link file://./poseMix.ts} is NOT. Mixing is a
 *          weighted average over the motions that wrote a field, and it commutes
 *          — which is what a crossfade and a blend tree need, and why the answer
 *          cannot depend on sample order. A layer stack is ordered: the aim layer
 *          at weight 0.3 means "three tenths of the way from whatever is under me
 *          to what I say", and swapping two layers is a different character.
 *
 *          So the two are kept apart rather than parameterized into one function.
 *          A field the layer wrote but nothing under it did still interpolates —
 *          against the world's own value, reached by seeding the accumulator the
 *          way any pose is seeded. That is the other half of the difference:
 *          mixing gives a lone writer its field whole, a layer never does.
 */

import type { Pose, PoseTrack, PoseWorld } from './pose';
import {
    deltaQuat, isQuatLike as isQuat, leanQuat, turnByQuat, type QuatLike as Quat,
} from './quatMix';

function isNumericObject(v: unknown): v is Record<string, number> {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const keys = Object.keys(v as object);
    if (keys.length === 0) return false;
    return keys.every(k => typeof (v as Record<string, unknown>)[k] === 'number');
}

/** Scratch for one additive field; this runs on one track at a time and does
 *  not re-enter. */
const DELTA: Quat = { w: 1, x: 0, y: 0, z: 0 };
const PART: Quat = { w: 1, x: 0, y: 0, z: 0 };

/**
 * `dst` turned further by the rotation `from` → `to`, a `weight` share of it.
 * Leaning the identity toward the delta is what SCALES a rotation, there being
 * nothing to scale linearly; the turn is then applied on top.
 */
function turnQuat(dst: Quat, from: Quat, to: Quat, weight: number): void {
    deltaQuat(DELTA, from, to);
    PART.w = 1; PART.x = 0; PART.y = 0; PART.z = 0;
    leanQuat(PART, DELTA, weight);
    turnByQuat(dst, PART);
}

/** Which tracks of `layer` this stack lets through; null admits every one. */
export interface LayerReach {
    admits(track: PoseTrack): boolean;
}

function leanField(
    dst: Record<string, unknown>, src: Record<string, unknown>, field: string, weight: number,
): void {
    const from = dst[field];
    const to = src[field];
    if (isQuat(to)) {
        if (isQuat(from)) leanQuat(from, to, weight);
        else dst[field] = { w: to.w, x: to.x, y: to.y, z: to.z };
    } else if (typeof to === 'number') {
        dst[field] = typeof from === 'number' ? from + (to - from) * weight : to;
    } else if (isNumericObject(to)) {
        if (isNumericObject(from)) {
            for (const axis of Object.keys(to)) {
                const a = from[axis];
                from[axis] = typeof a === 'number' ? a + (to[axis]! - a) * weight : to[axis]!;
            }
        } else dst[field] = { ...to };
    } else if (weight >= 1) {
        // A string or a flag has no halfway. It arrives only where the layer is
        // fully on, rather than switching at some threshold nobody declared.
        dst[field] = to;
    }
}

function addField(
    dst: Record<string, unknown>, src: Record<string, unknown>,
    ref: Record<string, unknown>, field: string, weight: number,
): void {
    const from = dst[field];
    const to = src[field];
    const base = ref[field];
    if (isQuat(to) && isQuat(base)) {
        if (isQuat(from)) turnQuat(from, base, to, weight);
    } else if (typeof to === 'number' && typeof base === 'number') {
        if (typeof from === 'number') dst[field] = from + (to - base) * weight;
    } else if (isNumericObject(to) && isNumericObject(base) && isNumericObject(from)) {
        for (const axis of Object.keys(to)) {
            const a = from[axis];
            if (typeof a === 'number') from[axis] = a + ((to[axis] ?? 0) - (base[axis] ?? 0)) * weight;
        }
    }
}

/**
 * Lay `layer` over `acc`: every field the layer wrote moves a `weight` share of
 * the way from what is already there to what the layer says. Where the layer is
 * the first to write a field, "already there" is the world's own value.
 */
export function overlayPose(
    acc: Pose, layer: Pose, weight: number, world: PoseWorld, reach: LayerReach | null,
): void {
    if (weight <= 0) return;
    for (const src of layer.tracks) {
        if (src.touched.size === 0) continue;
        if (reach && !reach.admits(src)) continue;
        const dst = acc.track(world, src.entity, src.def);
        if (!dst) continue;
        for (const field of src.touched) {
            leanField(dst.data, src.data, field, weight);
            dst.touched.add(field);
        }
    }
}

/**
 * Add what `layer` says BEYOND `reference` onto `acc` — a flinch or a lean stated
 * as a departure from its own resting pose, so it reads the same over a walk as
 * over a run. Measured against the layer's own start and not against `acc`, which
 * would make the same clip mean something different under every base state.
 */
export function addPoseOver(
    acc: Pose, layer: Pose, reference: Pose, weight: number,
    world: PoseWorld, reach: LayerReach | null,
): void {
    if (weight <= 0) return;
    const rest = new Map<string, PoseTrack>();
    for (const track of reference.tracks) rest.set(`${track.entity} ${track.def._name}`, track);

    for (const src of layer.tracks) {
        if (src.touched.size === 0) continue;
        if (reach && !reach.admits(src)) continue;
        const ref = rest.get(`${src.entity} ${src.def._name}`);
        if (!ref) continue;
        const dst = acc.track(world, src.entity, src.def);
        if (!dst) continue;
        for (const field of src.touched) {
            if (!ref.touched.has(field)) continue;
            addField(dst.data, src.data, ref.data, field, weight);
            dst.touched.add(field);
        }
    }
}
