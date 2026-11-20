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
 *          by how far the clip's root has gone since the clip began. As in Unity, what moves the rig is each clip's
 *          motion scaled by its weight: two walk clips in a row walk twice as far, a looping clip goes on travelling
 *          lap after lap, a clip easing in starts the rig off slowly and one easing out brings it to a stop where it
 *          got to, a crossfade blends the two clips' steps, and after the last clip the rig stays where it got to.
 *          A clip's post-extrapolation carries on its motion: a loop keeps walking, ping-pong walks back and forth,
 *          continue plays on in its animation, hold stands still.
 *
 *          The placement is worked out from the clips alone at every time asked (never accumulated frame by frame), so
 *          scrubbing, seeking and looping the timeline put the rig in the same place every time: the stretches where
 *          one clip plays at full weight are taken in one step, and only eases and crossfades are summed in short
 *          steps. It starts from the rig's own placement before the track first moved it.
 */
import type { AnimationClipItem, AnimationExtrapolation, AnimationTrack, TimelineAsset } from './TimelineTypes';
import { createRootPlacement, sampleRootPlacement, type RootPlacement } from './TimelineEvaluator';
import type { animationClipWeights, extrapolatedTime } from './timelineAnimation';

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

/** Steps per second over eases and crossfades, where weights change and the motion is summed. */
const BLEND_STEPS_PER_SECOND = 60;

/**
 * How far `clip` has carried its root by track time `t`, from where it was at the clip's start: its own motion inside
 * the clip, and after it what its post-extrapolation does (a loop repeats the clip's travel, ping-pong plays it back,
 * continue goes on in its animation, hold and none stand at the end).
 */
function clipTravelAt(
    clip: AnimationClipItem, anim: TimelineAsset, t: number, post: AnimationExtrapolation,
    wrap: typeof extrapolatedTime,
): RootPlacement {
    const end = clip.start + clip.duration;
    const at = (trackTime: number) => clipRootTravel(clip, anim, clip.clipIn + (trackTime - clip.start) * clip.speed);
    if (t <= clip.start || clip.duration <= 0) return IDENTITY();
    if (t <= end) return at(t);
    switch (post) {
        case 'continue': return at(t);
        case 'pingPong': return at(wrap(clip, t, 'pingPong'));
        case 'loop': {
            const off = t - clip.start;
            const laps = Math.floor(off / clip.duration);
            const lap = at(end);
            let acc = IDENTITY();
            for (let i = 0; i < laps; i++) acc = composePlacement(acc, lap);
            return composePlacement(acc, at(clip.start + (off - laps * clip.duration)));
        }
        default: return at(end);
    }
}

/**
 * Where the rig of `track` is at track time `time`, starting from `base`: each clip's motion, scaled by its weight
 * ({@link animationClipWeights}, passed in with {@link extrapolatedTime} so the two modules do not import each other),
 * added up from the first clip. `lookup` finds a clip's animation.
 */
export function rootPlacementAt(
    track: AnimationTrack, time: number, base: RootPlacement,
    lookup: (ref: string) => TimelineAsset | undefined,
    weights: typeof animationClipWeights,
    wrap: typeof extrapolatedTime,
): RootPlacement {
    const clips = track.clips;
    const anims = clips.map((c) => (c.clip ? lookup(c.clip) : undefined));
    const lengthOf = (c: AnimationClipItem) => (c.clip ? lookup(c.clip)?.duration ?? 0 : 0);
    const posts = clips.map((c) => c.postExtrapolation ?? (track.hold ? 'hold' : 'none'));
    const travel = (i: number, t: number): RootPlacement => {
        const anim = anims[i];
        return anim ? clipTravelAt(clips[i]!, anim, t, posts[i]!, wrap) : IDENTITY();
    };
    const step = (i: number, a: number, b: number) => composePlacement(invertPlacement(travel(i, a)), travel(i, b));

    // Where weights can change: each clip's ends and the ends of its eases (crossfades lie between two clips' ends).
    const marks = new Set<number>([time]);
    for (const c of clips) {
        if (c.duration <= 0) continue;
        const end = c.start + c.duration;
        for (const m of [c.start, end, c.start + c.easeIn, end - c.easeOut]) if (m < time) marks.add(m);
    }
    const first = Math.min(...clips.filter((c) => c.duration > 0).map((c) => c.start));
    const points = [...marks].filter((m) => m >= first).sort((x, y) => x - y);

    let at = base;
    for (let k = 0; k + 1 < points.length; k++) {
        const a = points[k]!, b = points[k + 1]!;
        if (b <= a) continue;
        const mid = weights(track, (a + b) / 2, lengthOf);
        if (mid.length === 0) continue;
        // One clip at full weight: its whole stretch in one step.
        if (mid.length === 1 && mid[0]!.weight >= 1 - 1e-9) { at = composePlacement(at, step(mid[0]!.index, a, b)); continue; }
        // An ease or a crossfade: each clip's step scaled by its weight, summed in short steps.
        const n = Math.min(4096, Math.max(1, Math.ceil((b - a) * BLEND_STEPS_PER_SECOND)));
        for (let j = 0; j < n; j++) {
            const t0 = a + ((b - a) * j) / n, t1 = a + ((b - a) * (j + 1)) / n;
            const counted = weights(track, (t0 + t1) / 2, lengthOf);
            let total = 0;
            const parts = counted.map(({ index, weight }) => { total += weight; return { placement: step(index, t0, t1), weight }; });
            if (total < 1) parts.push({ placement: IDENTITY(), weight: 1 - total });
            at = composePlacement(at, blendPlacements(parts));
        }
    }
    return at;
}
