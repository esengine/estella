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
    return keys.length > 0 && keys.every(k => typeof (v as Record<string, unknown>)[k] === 'number');
}

function normalize(q: Quat): void {
    const len = Math.hypot(q.w, q.x, q.y, q.z);
    if (len <= 0) { q.w = 1; q.x = 0; q.y = 0; q.z = 0; return; }
    q.w /= len; q.x /= len; q.y /= len; q.z /= len;
}

/**
 * Move `dst` a `weight` share of the way to `src`. Aligned to the near hemisphere
 * first: {q} and {-q} name the same rotation, and averaged as written they cancel
 * toward the long way round.
 */
function leanQuat(dst: Quat, src: Quat, weight: number): void {
    const dot = dst.w * src.w + dst.x * src.x + dst.y * src.y + dst.z * src.z;
    const s = dot < 0 ? -weight : weight;
    const keep = 1 - weight;
    dst.w = dst.w * keep + src.w * s;
    dst.x = dst.x * keep + src.x * s;
    dst.y = dst.y * keep + src.y * s;
    dst.z = dst.z * keep + src.z * s;
    normalize(dst);
}

/** `dst` turned further by the rotation `from` → `to`, a `weight` share of it. */
function turnQuat(dst: Quat, from: Quat, to: Quat, weight: number): void {
    // The delta is `to * from⁻¹` in the clip's own frame; leaning the identity
    // toward it is what scales a rotation, there being nothing to scale linearly.
    const dw = to.w * from.w + to.x * from.x + to.y * from.y + to.z * from.z;
    const dx = to.x * from.w - to.w * from.x - to.y * from.z + to.z * from.y;
    const dy = to.y * from.w - to.w * from.y - to.z * from.x + to.x * from.z;
    const dz = to.z * from.w - to.w * from.z - to.x * from.y + to.y * from.x;
    const part: Quat = { w: 1, x: 0, y: 0, z: 0 };
    leanQuat(part, { w: dw, x: dx, y: dy, z: dz }, weight);
    const w = part.w * dst.w - part.x * dst.x - part.y * dst.y - part.z * dst.z;
    const x = part.w * dst.x + part.x * dst.w + part.y * dst.z - part.z * dst.y;
    const y = part.w * dst.y - part.x * dst.z + part.y * dst.w + part.z * dst.x;
    const z = part.w * dst.z + part.x * dst.y - part.y * dst.x + part.z * dst.w;
    dst.w = w; dst.x = x; dst.y = y; dst.z = z;
    normalize(dst);
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
