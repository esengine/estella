// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineAnimation.ts
 * @brief   Animation tracks: skeletal clips on a rig, blended into each other and over the rig's own animation.
 *
 * @details A clip plays an animation (an `.estimeline` of joint
 *          curves) on the track's rig. Where two clips overlap, the overlap is a crossfade: the earlier fades out as the
 *          later fades in, their weights summing to one. Where a clip has nothing before or after it, its ease in and
 *          out blend it with what the rig is doing anyway (its Animator), and at full weight the track decides the pose.
 *
 *          Outside its span a clip can go on (extrapolation): before the first clip and after each one,
 *          until the next, it holds, loops, ping-pongs or continues its animation where asked.
 *
 *          Several tracks on one rig are layers, in track order (as the Animator's layers are): the
 *          first meets the rig's own pose, each later one leans what is under it toward its own pose (override) or adds
 *          what its clips move beyond their first frame (additive), by its weight, and only on the joints its mask
 *          admits. Each clip is sampled into a pose, never written directly; the layers are composed and the result
 *          written once. The rig's own pose is its Animator's for this frame where it has one (the timeline runs after
 *          the Animator), and otherwise its rest pose: what each joint held before a track first moved it. What it
 *          holds now would be the track's own last frame, and an ease in would close in on itself.
 */
import { TrackType, type AnimationClipItem, type AnimationExtrapolation, type AnimationTrack, type TimelineAsset } from './TimelineTypes';
import { isRootPlacementChannel, sampleTimelineIntoPose, type RootPlacement, type SampleDeps } from './TimelineEvaluator';
import { Pose, type PoseTrack, type PoseWorld } from '../animation/pose';
import { poseStorageFor, StoredPoseTracks, type PoseStorage } from '../animation/poseStorage';
import { writeProjection } from '../ecs/componentProjection';
import { mixPoses, type WeightedPose } from '../animation/poseMix';
import { overlayPose, addPoseOver } from '../animation/layerStack';
import { MaskReach } from '../animation/animatorMask';
import type { World } from '../ecs/world';
import { rootPlacementAt } from './timelineRootMotion';
import { getComponent } from '../ecs/component';
import type { Entity } from '../types';

interface TimelinePoses {
    pool: Pose[];
    storage: PoseStorage;
    /** What a component held before the first track wrote it. */
    rests: StoredPoseTracks<Record<string, unknown>>;
    /** Where each rig stood before its first root-motion track. */
    rootRests: WeakMap<object, RootPlacement>;
}

// Reusable poses hold component data and definitions from the world that seeded them.
const posesByWorld = new WeakMap<object, TimelinePoses>();

/**
 * Releases this world's pose buffers and rest values. The editor calls this after restoring the scene
 * when it binds a preview, so the next sample starts from the new binding's components.
 */
export function forgetAnimationRests(world: object): void {
    posesByWorld.delete(world);
}

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
 * Track time `time`, outside `clip`'s span, mapped into it as `mode` fills the time around the clip: held at the nearer
 * end, looped, ping-ponged, or (continue) left as it is for the animation to carry on.
 */
export function extrapolatedTime(clip: AnimationClipItem, time: number, mode: AnimationExtrapolation): number {
    const d = clip.duration, off = time - clip.start;
    if (d <= 0) return clip.start;
    switch (mode) {
        case 'loop': return clip.start + (((off % d) + d) % d);
        case 'pingPong': {
            const p = ((off % (2 * d)) + 2 * d) % (2 * d);
            return clip.start + (p <= d ? p : 2 * d - p);
        }
        case 'continue': return time;
        default: return off < 0 ? clip.start : clip.start + d;
    }
}

/**
 * The clips of `track` that count at `time`, with their weights: ramps over the ease in and out, or over the overlap
 * with a neighbour, which makes the overlap a crossfade. Where no clip plays, the one before fills the time with its
 * post-extrapolation (the track's `hold` is every clip's hold), and before the first clip its pre-extrapolation, at
 * full weight; the ease on an end that is extrapolated is not used. `lengthOf` gives a clip's animation length (for
 * looping and holding), 0 when unknown.
 */
export function animationClipWeights(
    track: AnimationTrack, time: number, lengthOf: (clip: AnimationClipItem) => number,
): AnimationClipWeight[] {
    const clips = track.clips;
    const out: AnimationClipWeight[] = [];
    const extended = (m: AnimationExtrapolation | undefined) => !!m && m !== 'none';
    for (let i = 0; i < clips.length; i++) {
        const c = clips[i]!;
        const end = c.start + c.duration;
        if (time < c.start || time >= end || c.duration <= 0) continue;
        const prev = clips[i - 1], next = clips[i + 1];
        const prevEnd = prev ? prev.start + prev.duration : -Infinity;
        // Into the clip: across the overlap with the one before, or over its own ease in.
        const fadeIn = prevEnd > c.start ? prevEnd - c.start : i === 0 && extended(c.preExtrapolation) ? 0 : c.easeIn;
        const fadeOut = next && next.start < end ? end - next.start : extended(c.postExtrapolation) ? 0 : c.easeOut;
        const wIn = fadeIn > 0 ? clamp01((time - c.start) / fadeIn) : 1;
        const wOut = fadeOut > 0 ? clamp01((end - time) / fadeOut) : 1;
        const weight = wIn * wOut;
        if (weight > 0) out.push({ index: i, weight, local: clipLocalTime(c, time, lengthOf(c)) });
    }
    if (out.length > 0 || clips.length === 0) return out;
    // Between clips or past them: the latest clip that has ended goes on as its post-extrapolation says.
    let last = -1;
    for (let i = 0; i < clips.length; i++) if (clips[i]!.duration > 0 && clips[i]!.start + clips[i]!.duration <= time) last = i;
    if (last >= 0) {
        const c = clips[last]!;
        const mode = c.postExtrapolation ?? (track.hold ? 'hold' : 'none');
        if (mode !== 'none') out.push({ index: last, weight: 1, local: clipLocalTime(c, extrapolatedTime(c, time, mode), lengthOf(c)) });
        return out;
    }
    // Before the first clip: its pre-extrapolation.
    const first = clips[0]!;
    const pre = first.preExtrapolation ?? 'none';
    if (pre !== 'none' && time < first.start && first.duration > 0) {
        out.push({ index: 0, weight: 1, local: clipLocalTime(first, extrapolatedTime(first, time, pre), lengthOf(first)) });
    }
    return out;
}

/** Poses lent per frame; returned at the end of it. */
const borrow = (poses: TimelinePoses): Pose => poses.pool.pop() ?? new Pose(poses.storage);

/** One track's part in a rig's stack this frame: its clips' poses, what they start from, and how the layer applies. */
interface Layer {
    track: AnimationTrack;
    sources: WeightedPose[];
    /** For an additive track, each clip's first frame, in the order of `sources`. */
    refs: Pose[];
    total: number;
    reach: MaskReach | null;
}

/** A track's mask resolved on its rig, or null where it moves the whole rig. */
function reachOf(track: AnimationTrack, rig: Entity, deps: SampleDeps): MaskReach | null {
    if (!track.mask) return null;
    const reach = new MaskReach();
    reach.resolve(deps.world as unknown as Pick<World, 'tryGet'>, rig, { paths: track.mask }, (r, p) => deps.resolveChild(r, p) ?? null);
    return reach;
}

/**
 * Samples every animation track of `asset` at `time` onto its rig below `root`: each track's clips as
 * {@link animationClipWeights} says, the tracks on one rig composed as layers in track order over what the rig holds
 * now. `lookup` finds a clip's animation by its ref (a playing timeline's own lookup). Writes nothing where no clip
 * counts.
 */
export function sampleAnimationTracks(
    asset: TimelineAsset, time: number, root: Entity, deps: SampleDeps,
    lookup: (ref: string) => TimelineAsset | undefined,
): void {
    // The tracks of each rig, in track order.
    const rigs = new Map<Entity, AnimationTrack[]>();
    for (const track of asset.tracks) {
        if (track.type !== TrackType.Animation || track.clips.length === 0) continue;
        const rig = deps.resolveChild(root, track.childPath);
        if (rig == null) continue;
        const list = rigs.get(rig);
        if (list) list.push(track); else rigs.set(rig, [track]);
    }
    if (rigs.size === 0) return;
    const world = deps.world as unknown as PoseWorld;
    let poses = posesByWorld.get(world);
    if (!poses) {
        const storage = poseStorageFor(world);
        poses = { pool: [], storage, rests: new StoredPoseTracks(storage), rootRests: new WeakMap() };
        posesByWorld.set(world, poses);
    }
    const mark = poses.storage.begin();
    try {
        for (const [rig, tracks] of rigs) sampleRig(world, rig, tracks, time, deps, lookup, poses);
    } finally {
        poses.storage.end(mark);
    }
}

function sampleRig(
    world: PoseWorld, rig: Entity, tracks: AnimationTrack[], time: number, deps: SampleDeps,
    lookup: (ref: string) => TimelineAsset | undefined, poses: TimelinePoses,
): void {
    const rigKey = poses.storage.keyFor(rig, world);
    if (!rigKey) return;
    const layers: Layer[] = [];
    for (const track of tracks) {
        const lengthOf = (c: AnimationClipItem) => (c.clip ? lookup(c.clip)?.duration ?? 0 : 0);
        const counted = animationClipWeights(track, time, lengthOf);
        if (counted.length === 0) continue;
        const additive = track.blend === 'additive';
        const layer: Layer = { track, sources: [], refs: [], total: 0, reach: reachOf(track, rig, deps) };
        for (const { index, weight, local } of counted) {
            const c = track.clips[index]!;
            const anim = c.clip ? lookup(c.clip) : undefined;
            if (!anim) continue;
            const pose = borrow(poses);
            pose.reset();
            // With root motion the clip's root track says where the rig goes, not a pose: it is left out here.
            sampleTimelineIntoPose(anim, local, rig, deps, pose, track.rootMotion ? ROOT_LEFT_OUT : undefined);
            layer.sources.push({ pose, weight });
            layer.total += weight;
            if (additive) {
                // An additive clip says how far its animation moves from where the clip starts in it.
                const ref = borrow(poses);
                ref.reset();
                sampleTimelineIntoPose(anim, clipLocalTime(c, c.start, lengthOf(c)), rig, deps, ref, track.rootMotion ? ROOT_LEFT_OUT : undefined);
                layer.refs.push(ref);
            }
        }
        if (layer.sources.length > 0) layers.push(layer);
    }
    if (poses.storage.entities[rig] !== rigKey) return;
    if (layers.length > 0) composeRig(world, rig, layers, poses, rigKey);
    // The rig's travel: the last root-motion track on it says where it is.
    for (let i = tracks.length - 1; i >= 0; i--) {
        if (!tracks[i]!.rootMotion) continue;
        moveRoot(world, rig, tracks[i]!, time, lookup, poses, rigKey);
        break;
    }
}

const ROOT_LEFT_OUT = { skipChannel: isRootPlacementChannel };

/** Places `rig` where `track`'s root motion has brought it at `time`, from where it stood before the track moved it. */
function moveRoot(
    world: PoseWorld, rig: Entity, track: AnimationTrack, time: number,
    lookup: (ref: string) => TimelineAsset | undefined, { storage, rootRests }: TimelinePoses, rigKey: object,
): void {
    const def = getComponent('Transform');
    if (!def || storage.entities[rig] !== rigKey || !world.has(rig, def)) return;
    const now = world.get(rig, def) as RootPlacement & Record<string, unknown>;
    let base = rootRests.get(rigKey);
    if (!base) {
        base = { position: { ...now.position }, rotation: { ...now.rotation } };
        rootRests.set(rigKey, base);
    }
    const at = rootPlacementAt(track, time, base, lookup, animationClipWeights, extrapolatedTime);
    if (storage.entities[rig] === rigKey) writeProjection(world, rig, def, { ...now, position: at.position, rotation: at.rotation });
}

/** Composes `layers` on `rig` over its own pose and writes the result once. */
function composeRig(world: PoseWorld, rig: Entity, layers: Layer[], poses: TimelinePoses, rigKey: object): void {
    const { pool, rests } = poses;
    const animator = animatedByAnimator(world, rig);
    const composed = borrow(poses);
    composed.reset();
    const seed = (tr: PoseTrack, was: Record<string, unknown> | undefined) => {
        const into = composed.track(world, tr.entity, tr.def);
        if (!into) return;
        for (const f of tr.touched) {
            if (into.touched.has(f)) continue;
            if (was && f in was) into.data[f] = typeof was[f] === 'object' && was[f] !== null ? { ...(was[f] as object) } : was[f];
            into.touched.add(f);
        }
    };
    for (const { sources, reach } of layers) {
        for (const { pose } of sources) {
            for (const tr of pose.tracks) {
                if (tr.touched.size === 0) continue;
                let rest = rests.lookup(tr.entity, tr.def);
                if (!rest) {
                    if (!world.has(tr.entity, tr.def)) continue;
                    const key = rests.keyFor(tr.entity, tr.def, world);
                    rest = copyData(world.get(tr.entity, tr.def));
                    rests.remember(key, rest);
                }
                // Capture even masked joints before any write. An Animator supplies its own base this frame.
                if (!reach || reach.admits(tr)) seed(tr, animator ? undefined : rest);
            }
        }
    }
    for (const layer of layers) {
        const w = clamp01(layer.track.weight ?? 1);
        if (layer.track.blend === 'additive') {
            layer.sources.forEach(({ pose, weight }, i) => addPoseOver(composed, pose, layer.refs[i]!, weight * w, world, layer.reach));
            continue;
        }
        // The clips mixed among themselves, then leaned in by as much of them as there is.
        const mixed = borrow(poses);
        mixPoses(layer.sources, mixed, world);
        overlayPose(composed, mixed, Math.min(1, layer.total) * w, world, layer.reach);
        pool.push(mixed);
    }
    if (poses.storage.entities[rig] === rigKey) composed.applyEvaluatedTo(world);
    for (const layer of layers) {
        for (const { pose } of layer.sources) pool.push(pose);
        for (const ref of layer.refs) pool.push(ref);
    }
    pool.push(composed);
}
