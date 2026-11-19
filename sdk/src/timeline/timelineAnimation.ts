// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineAnimation.ts
 * @brief   Animation tracks: skeletal clips on a rig, blended into each other and over the rig's own animation.
 *
 * @details Unity's Animation Track and UE's Skeletal Animation track. A clip plays an animation (an `.estimeline` of joint
 *          curves) on the track's rig. Where two clips overlap, the overlap is a crossfade: the earlier fades out as the
 *          later fades in, their weights summing to one. Where a clip has nothing before or after it, its ease in and
 *          out blend it with what the rig is doing anyway (its Animator), and at full weight the track decides the pose.
 *
 *          Each clip is sampled into a pose, never written directly; the poses are mixed, with the rig's own pose as
 *          one more source for whatever weight the clips leave, and the mix is written once. The rig's own pose is its
 *          Animator's for this frame where it has one (the timeline runs after the Animator), and otherwise its rest
 *          pose: what each joint held before the track first moved it. What it holds now would be the track's own last
 *          frame, and an ease in would close in on itself.
 */
import { TrackType, type AnimationClipItem, type AnimationTrack, type TimelineAsset } from './TimelineTypes';
import { sampleTimelineIntoPose, type SampleDeps } from './TimelineEvaluator';
import { Pose, type PoseWorld } from '../animation/pose';
import { mixPoses, type WeightedPose } from '../animation/poseMix';
import { getComponent } from '../ecs/component';
import type { Entity } from '../types';

/** Per world, what each (joint, component) held before an animation track first wrote it. */
const rests = new WeakMap<object, Map<string, Record<string, unknown>>>();

const copyData = (data: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) out[k] = v !== null && typeof v === 'object' && !Array.isArray(v) ? { ...(v as object) } : v;
    return out;
};

/** Whether `rig` is posed by an Animator this frame, so its current pose is the one to blend over. */
function animatedByAnimator(world: PoseWorld, rig: Entity): boolean {
    const def = getComponent('Animator');
    if (!def || !world.has(rig, def)) return false;
    return (world.get(rig, def) as { enabled?: boolean }).enabled !== false;
}

/** How a clip of an animation track counts at a time: its weight, and where in its animation it is. */
export interface AnimationClipWeight {
    index: number;
    weight: number;
    /** Seconds into the clip's animation. */
    local: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Seconds into `clip`'s animation at track time `time`, for an animation `length` seconds long (0: unknown). */
export function clipLocalTime(clip: AnimationClipItem, time: number, length: number): number {
    const t = clip.clipIn + Math.max(0, time - clip.start) * clip.speed;
    if (length <= 0) return t;
    if (clip.loop) return ((t % length) + length) % length;
    return Math.min(t, length);
}

/**
 * The clips of `track` that count at `time`, with their weights: ramps over the ease in and out, or over the overlap
 * with a neighbour, which makes the overlap a crossfade. With `hold`, after the last clip ends its final pose stays at
 * full weight. `lengthOf` gives a clip's animation length (for looping and holding), 0 when unknown.
 */
export function animationClipWeights(
    track: AnimationTrack, time: number, lengthOf: (clip: AnimationClipItem) => number,
): AnimationClipWeight[] {
    const clips = track.clips;
    const out: AnimationClipWeight[] = [];
    for (let i = 0; i < clips.length; i++) {
        const c = clips[i]!;
        const end = c.start + c.duration;
        if (time < c.start || time >= end || c.duration <= 0) continue;
        const prev = clips[i - 1], next = clips[i + 1];
        const prevEnd = prev ? prev.start + prev.duration : -Infinity;
        // Into the clip: across the overlap with the one before, or over its own ease in.
        const fadeIn = prevEnd > c.start ? prevEnd - c.start : c.easeIn;
        const fadeOut = next && next.start < end ? end - next.start : c.easeOut;
        const wIn = fadeIn > 0 ? clamp01((time - c.start) / fadeIn) : 1;
        const wOut = fadeOut > 0 ? clamp01((end - time) / fadeOut) : 1;
        const weight = wIn * wOut;
        if (weight > 0) out.push({ index: i, weight, local: clipLocalTime(c, time, lengthOf(c)) });
    }
    if (out.length === 0 && track.hold && clips.length > 0) {
        // Past the last clip that has ended: its last frame, whole.
        let last = -1;
        for (let i = 0; i < clips.length; i++) if (clips[i]!.start + clips[i]!.duration <= time) last = i;
        if (last >= 0) {
            const c = clips[last]!;
            out.push({ index: last, weight: 1, local: clipLocalTime(c, c.start + c.duration, lengthOf(c)) });
        }
    }
    return out;
}

/** Poses lent per frame; returned at the end of it. */
const pool: Pose[] = [];
const borrow = (): Pose => pool.pop() ?? new Pose();

/**
 * Samples every animation track of `asset` at `time` onto its rig below `root`, mixed as {@link animationClipWeights}
 * says and over what the rig holds now. `lookup` finds a clip's animation by its ref (a playing timeline's own
 * lookup). Writes nothing where no clip counts.
 */
export function sampleAnimationTracks(
    asset: TimelineAsset, time: number, root: Entity, deps: SampleDeps,
    lookup: (ref: string) => TimelineAsset | undefined,
): void {
    for (const track of asset.tracks) {
        if (track.type !== TrackType.Animation || track.clips.length === 0) continue;
        const rig = deps.resolveChild(root, track.childPath);
        if (rig == null) continue;
        const lengthOf = (c: AnimationClipItem) => (c.clip ? lookup(c.clip)?.duration ?? 0 : 0);
        const counted = animationClipWeights(track, time, lengthOf);
        if (counted.length === 0) continue;

        const world = deps.world as unknown as PoseWorld;
        const sources: WeightedPose[] = [];
        let total = 0;
        for (const { index, weight, local } of counted) {
            const anim = track.clips[index]!.clip ? lookup(track.clips[index]!.clip) : undefined;
            if (!anim) continue;
            const pose = borrow();
            pose.reset();
            sampleTimelineIntoPose(anim, local, rig, deps, pose);
            sources.push({ pose, weight });
            total += weight;
        }
        if (sources.length === 0) continue;
        // The rest pose of every joint a clip moves, recorded before the track writes it the first time.
        let rest = rests.get(deps.world as object);
        if (!rest) rests.set(deps.world as object, (rest = new Map()));
        for (const { pose } of sources) {
            for (const tr of pose.tracks) {
                const key = `${tr.entity} ${tr.def._name}`;
                if (tr.touched.size > 0 && !rest.has(key) && world.has(tr.entity, tr.def)) {
                    rest.set(key, copyData(world.get(tr.entity, tr.def) as Record<string, unknown>));
                }
            }
        }
        // What the clips leave is the rig's own pose, for every field a clip writes: its Animator's, or its rest.
        if (total < 1) {
            const base = borrow();
            base.reset();
            const animator = animatedByAnimator(world, rig);
            for (const { pose } of sources) {
                for (const tr of pose.tracks) {
                    if (tr.touched.size === 0) continue;
                    const into = base.track(world, tr.entity, tr.def);
                    if (!into) continue;
                    const was = animator ? undefined : rest.get(`${tr.entity} ${tr.def._name}`);
                    for (const f of tr.touched) {
                        if (was && f in was) into.data[f] = typeof was[f] === 'object' && was[f] !== null ? { ...(was[f] as object) } : was[f];
                        into.touched.add(f);
                    }
                }
            }
            sources.push({ pose: base, weight: 1 - total });
        }
        const out = borrow();
        mixPoses(sources, out, world);
        out.applyTo(world);
        for (const { pose } of sources) pool.push(pose);
        pool.push(out);
    }
}
