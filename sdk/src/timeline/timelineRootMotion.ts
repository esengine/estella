// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineRootMotion.ts
 * @brief   Root motion on an animation track: the rig travels as its clips walk, each clip going on from where the one
 *          before left it.
 *
 * @details Unity's Animation track with root motion, UE's root motion on a skeletal animation section. A clip's root
 *          track (its `Transform` position and rotation at the clip's own root) says where the character goes, not
 *          where it stands: with the track's `rootMotion` on, that track is left out of the pose and the rig is moved
 *          by how far the clip's root has gone since the clip began. Clips follow on: each one starts where the track
 *          had brought the rig by its start, so two walk clips in a row walk twice as far, and a looping clip goes on
 *          travelling lap after lap. Where clips crossfade, their placements blend by their weights; after the last
 *          clip the rig stays where it got to.
 *
 *          The placement is worked out from the clips alone at every time asked (never accumulated frame by frame), so
 *          scrubbing, seeking and looping the timeline put the rig in the same place every time. It starts from the
 *          rig's own placement before the track first moved it.
 */
import type { AnimationClipItem, AnimationTrack, TimelineAsset } from './TimelineTypes';
import { createRootPlacement, sampleRootPlacement, type RootPlacement } from './TimelineEvaluator';
import type { animationClipWeights } from './timelineAnimation';

type Vec3 = { x: number; y: number; z: number };
type Quat = { w: number; x: number; y: number; z: number };

const IDENTITY = (): RootPlacement => ({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } });

function mulQ(a: Quat, b: Quat): Quat {
    return {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
}
const conj = (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
function rotate(q: Quat, v: Vec3): Vec3 {
    const r = mulQ(mulQ(q, { w: 0, x: v.x, y: v.y, z: v.z }), conj(q));
    return { x: r.x, y: r.y, z: r.z };
}
function normalize(q: Quat): Quat {
    const n = Math.hypot(q.w, q.x, q.y, q.z) || 1;
    return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

/** `a` then `b` in `a`'s frame. */
export function composePlacement(a: RootPlacement, b: RootPlacement): RootPlacement {
    const p = rotate(a.rotation, b.position);
    return {
        position: { x: a.position.x + p.x, y: a.position.y + p.y, z: a.position.z + p.z },
        rotation: normalize(mulQ(a.rotation, b.rotation)),
    };
}

/** The placement that undoes `a`. */
export function invertPlacement(a: RootPlacement): RootPlacement {
    const r = conj(normalize(a.rotation));
    const p = rotate(r, a.position);
    return { position: { x: -p.x, y: -p.y, z: -p.z }, rotation: r };
}

/** Placements blended by weight: positions averaged, rotations by a normalised, sign-aligned sum. */
export function blendPlacements(parts: readonly { placement: RootPlacement; weight: number }[]): RootPlacement {
    let total = 0;
    const pos = { x: 0, y: 0, z: 0 };
    const rot = { w: 0, x: 0, y: 0, z: 0 };
    const ref = parts[0]?.placement.rotation;
    for (const { placement, weight } of parts) {
        if (!(weight > 0)) continue;
        total += weight;
        pos.x += placement.position.x * weight; pos.y += placement.position.y * weight; pos.z += placement.position.z * weight;
        const q = placement.rotation;
        const s = ref && q.w * ref.w + q.x * ref.x + q.y * ref.y + q.z * ref.z < 0 ? -weight : weight;
        rot.w += q.w * s; rot.x += q.x * s; rot.y += q.y * s; rot.z += q.z * s;
    }
    if (total <= 0) return parts[0]?.placement ?? IDENTITY();
    return { position: { x: pos.x / total, y: pos.y / total, z: pos.z / total }, rotation: normalize(rot) };
}

/** Where `anim`'s root is at `t` relative to where it is at 0, or nowhere at all when it has no root track. */
function relativeRoot(anim: TimelineAsset, t: number, scratch: RootPlacement, origin: RootPlacement): RootPlacement {
    if (!sampleRootPlacement(anim, t, scratch)) return IDENTITY();
    return composePlacement(invertPlacement(origin), {
        position: { ...scratch.position }, rotation: { ...(scratch.rotation as Quat) },
    });
}

/**
 * How far `clip`'s root has gone, from where the clip starts in its animation (Clip In) to animation time `u` (not
 * wrapped: a looping clip's laps each add a lap's travel; a clip that does not loop stops at its animation's end).
 */
export function clipRootTravel(clip: AnimationClipItem, anim: TimelineAsset, u: number): RootPlacement {
    const L = anim.duration;
    const scratch = createRootPlacement();
    const origin = createRootPlacement();
    if (!sampleRootPlacement(anim, 0, origin)) return IDENTITY();
    const at = (t: number): RootPlacement => {
        if (!clip.loop || L <= 0) return relativeRoot(anim, L > 0 ? Math.min(Math.max(t, 0), L) : t, scratch, origin);
        const laps = Math.floor(t / L);
        const lap = relativeRoot(anim, L, scratch, origin);
        let acc = IDENTITY();
        const step = laps >= 0 ? lap : invertPlacement(lap);
        for (let i = 0; i < Math.abs(laps); i++) acc = composePlacement(acc, step);
        return composePlacement(acc, relativeRoot(anim, t - laps * L, scratch, origin));
    };
    return composePlacement(invertPlacement(at(clip.clipIn)), at(u));
}

/** Animation time (unwrapped) of `clip` at track time `t`: held at its start before it, and at its end after it unless it goes on. */
function rootTime(clip: AnimationClipItem, t: number, hold: boolean): number {
    const end = clip.start + clip.duration;
    const post = clip.postExtrapolation ?? (hold ? 'hold' : 'none');
    let tt = Math.max(t, clip.start);
    if (tt > end && post !== 'continue' && post !== 'loop') tt = end;
    return clip.clipIn + (tt - clip.start) * clip.speed;
}

/**
 * Where the rig of `track` is at track time `time`, starting from `base`: each clip moved on from where the clips
 * before it had brought the rig at its start. `lookup` finds a clip's animation; `weights` is which clips count when
 * ({@link animationClipWeights}, passed in so the two modules do not import each other).
 */
export function rootPlacementAt(
    track: AnimationTrack, time: number, base: RootPlacement,
    lookup: (ref: string) => TimelineAsset | undefined,
    weights: typeof animationClipWeights,
): RootPlacement {
    const starts = new Map<number, RootPlacement>();
    const lengthOf = (c: AnimationClipItem) => (c.clip ? lookup(c.clip)?.duration ?? 0 : 0);
    const travel = (i: number, t: number): RootPlacement => {
        const c = track.clips[i]!;
        const anim = c.clip ? lookup(c.clip) : undefined;
        return anim ? clipRootTravel(c, anim, rootTime(c, t, track.hold)) : IDENTITY();
    };
    // Where the clips before `upto` have the rig at `t`.
    const placement = (upto: number, t: number): RootPlacement => {
        if (upto === 0) return base;
        const clips = track.clips.slice(0, upto);
        const counted = weights({ ...track, clips }, t, lengthOf);
        if (counted.length > 0) {
            return blendPlacements(counted.map(({ index, weight }) => ({ placement: composePlacement(startOf(index), travel(index, t)), weight })));
        }
        // Between or after them: where the latest that has ended left the rig; before them, the base.
        let last = -1;
        for (let i = 0; i < clips.length; i++) if (clips[i]!.start + clips[i]!.duration <= t) last = i;
        if (last < 0) return base;
        const c = clips[last]!;
        return composePlacement(startOf(last), travel(last, c.start + c.duration));
    };
    const startOf = (i: number): RootPlacement => {
        let s = starts.get(i);
        if (!s) starts.set(i, (s = placement(i, track.clips[i]!.start)));
        return s;
    };
    return placement(track.clips.length, time);
}
