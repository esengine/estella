// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineSequences.ts
 * @brief   Which timelines play inside which, and which camera is the view when.
 *
 * Both are pure functions of (asset, time), so playback, scrubbing and a backwards run all ask the
 * same question and get the same answer: nothing here remembers the previous frame.
 */
import { TrackType, type CameraClip, type SequenceClip, type TimelineAsset } from './TimelineTypes';
import type { Entity } from '../types';

/** Timelines nested deeper than this are not played (and the editor refuses to build them). */
export const MAX_SEQUENCE_DEPTH = 4;

/** What a nested timeline sees: its own clock, and the entity its name paths start from. */
export interface SequenceLayer {
    /** Stable across frames while the clip plays: which track and clip, down the nesting. */
    key: string;
    asset: TimelineAsset;
    ref: string;
    /** The nested timeline's own time. */
    time: number;
    /** Elapsed clip time before loops are folded. */
    phase?: number;
    clip: SequenceClip;
    root: Entity;
}

export type SequenceLookup = (ref: string) => TimelineAsset | undefined;
export type ChildResolver = (root: Entity, childPath: string) => Entity | null;

/** The time a nested timeline is at when its parent is at `parentTime`, or null outside the clip. */
export function sequenceLocalTime(clip: SequenceClip, parentTime: number, childDuration: number): number | null {
    if (parentTime < clip.start || parentTime >= clip.start + clip.duration) return null;
    const raw = (parentTime - clip.start) * clip.speed;
    if (childDuration <= 0) return 0;
    if (clip.loop) return raw % childDuration;
    return raw >= childDuration ? childDuration : raw;
}

/**
 * The timelines playing inside `asset` at `time`, outermost first, with each one's own time and root.
 * A timeline already on the way down (a loop) or past the depth limit is skipped, not entered.
 */
export function collectSequenceLayers(
    asset: TimelineAsset, time: number, root: Entity, resolveChild: ChildResolver, lookup: SequenceLookup,
    chain: readonly string[] = [], keyPrefix = '', depth = 0,
): SequenceLayer[] {
    if (depth >= MAX_SEQUENCE_DEPTH) return [];
    const out: SequenceLayer[] = [];
    asset.tracks.forEach((track, ti) => {
        if (track.type !== TrackType.Sequence) return;
        track.clips.forEach((clip, ci) => {
            if (!clip.timeline || chain.includes(clip.timeline)) return;
            const child = lookup(clip.timeline);
            if (!child) return;
            const local = sequenceLocalTime(clip, time, child.duration);
            if (local === null) return;
            const childRoot = clip.root ? resolveChild(root, clip.root) : root;
            if (childRoot == null) return;
            const key = `${keyPrefix}${ti}.${ci}/`;
            const phase = clip.loop ? (time - clip.start) * clip.speed : local;
            out.push({ key, asset: child, ref: clip.timeline, time: local, phase, clip, root: childRoot });
            out.push(...collectSequenceLayers(child, local, childRoot, resolveChild, lookup, [...chain, clip.timeline], key, depth + 1));
        });
    });
    return out;
}

/** Whether `ref` can be played inside `asset` without it ending up inside itself, by whatever route. */
export function wouldNestCycle(host: string, ref: string, lookup: SequenceLookup): boolean {
    if (host === ref) return true;
    const seen = new Set<string>();
    const reaches = (from: string): boolean => {
        if (from === host) return true;
        if (seen.has(from)) return false;
        seen.add(from);
        const asset = lookup(from);
        if (!asset) return false;
        for (const track of asset.tracks) {
            if (track.type !== TrackType.Sequence) continue;
            for (const clip of track.clips) if (clip.timeline && reaches(clip.timeline)) return true;
        }
        return false;
    };
    return reaches(ref);
}

/** The view at one moment: `to` is the camera now, `from` the one it is leaving, `weight` how far across. */
export interface ShotState {
    from: string | null;
    to: string;
    /** 0..1 along the overlap; 1 when there is nothing being left. */
    weight: number;
    curve: number;
}

/**
 * Which camera is the view at `time`. Clips that touch cut; clips that overlap blend over the overlap.
 * No clip over `time` is no answer (null): the scene's own camera takes over.
 */
export function resolveShot(clips: readonly CameraClip[], time: number): ShotState | null {
    let to: CameraClip | undefined;
    let from: CameraClip | undefined;
    for (const clip of clips) {
        if (!clip?.camera || !(time >= clip.start && (time < clip.start + clip.duration
            || (clip.duration === 0 && time === clip.start)))) continue;
        // Later entries win when clips have the same start.
        if (!to || clip.start >= to.start) {
            from = to;
            to = clip;
        } else if (!from || clip.start >= from.start) {
            from = clip;
        }
    }
    if (!to) return null;
    if (!from) return { from: null, to: to.camera, weight: 1, curve: to.curve ?? 3 };
    const overlap = from.start + from.duration - to.start;
    const weight = overlap > 0 ? Math.min(1, Math.max(0, (time - to.start) / overlap)) : 1;
    return { from: from.camera, to: to.camera, weight, curve: to.curve ?? 3 };
}

/** A shot with its cameras resolved to entities — what the camera director takes. */
export interface ActiveShot {
    from: Entity | null;
    to: Entity;
    weight: number;
    curve: number;
}

/**
 * The shot at `time` across a timeline and the ones nested in it: the outermost timeline that has a camera
 * answer wins, so a parent's cut is not overridden by what a child inside it was doing.
 * Supply layers collected for this sample to reuse their resolved roots.
 */
export function resolveActiveShot(
    asset: TimelineAsset, time: number, root: Entity, resolveChild: ChildResolver, lookup: SequenceLookup,
    layers?: readonly SequenceLayer[],
): ActiveShot | null {
    const tryAsset = (a: TimelineAsset, t: number, r: Entity): ActiveShot | null => {
        for (const track of a.tracks) {
            if (track.type !== TrackType.Camera) continue;
            const shot = resolveShot(track.clips, t);
            if (!shot) continue;
            const to = resolveChild(r, shot.to);
            if (to == null) continue;
            const from = shot.from === null ? null : resolveChild(r, shot.from);
            return { from: from ?? null, to, weight: from == null ? 1 : shot.weight, curve: shot.curve };
        }
        return null;
    };
    const own = tryAsset(asset, time, root);
    if (own) return own;
    for (const layer of layers ?? collectSequenceLayers(asset, time, root, resolveChild, lookup)) {
        const shot = tryAsset(layer.asset, layer.time, layer.root);
        if (shot) return shot;
    }
    return null;
}

