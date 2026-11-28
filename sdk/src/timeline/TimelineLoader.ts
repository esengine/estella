// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {
    wrapModeFromName,
    TrackType,
    timelineSpawnPrefabRefs,
    TIMELINE_FORMAT_VERSION,
    type TimelineAsset,
    type Track,
    type PropertyTrack,
    type SpineTrack,
    type SpriteAnimTrack,
    type AudioTrack,
    type ParticleTrack,
    type ActivationTrack,
    type MarkerTrack,
    type CustomEventTrack,
    type AnimFramesTrack,
    type CameraTrack,
    type SequenceTrack,
    type AnimationTrack,
    type SpawnTrack,
    type CameraShakeTrack,
} from './TimelineTypes';
import { log } from '../util/logger';
import { adoptDecodedKeyframes, loadKeyframes } from '../math/keyframes';
import { isSpriteFrameDuration } from '../animation/spriteFrameTiming';

const STEP_TANGENT_THRESHOLD = 1e5;

type MigrationFn = (raw: any) => void;

const MIGRATIONS: [string, string, MigrationFn][] = [
    ['1.0', '1.1', (raw: any) => {
        for (const track of raw.tracks ?? []) {
            if (track.type === TrackType.Property) {
                for (const ch of track.channels ?? []) {
                    for (const kf of ch.keyframes ?? []) {
                        if (kf.interpolation) continue;
                        if (Math.abs(kf.outTangent) >= STEP_TANGENT_THRESHOLD) {
                            kf.interpolation = 'step';
                            kf.outTangent = 0;
                        }
                    }
                }
            }
        }
    }],
    // `rotation.z` named the Z EULER angle, not the quaternion's z component —
    // the name a 3D rotation channel needs. The angle keeps its meaning under
    // the name that says so, and a document written before this reads the same.
    ['1.1', '1.2', (raw: any) => {
        for (const track of raw.tracks ?? []) {
            if (track.type !== TrackType.Property) continue;
            for (const ch of track.channels ?? []) {
                if (ch.property === 'rotation.z') ch.property = 'rotation.angle';
            }
        }
    }],
    // Camera and sequence tracks arrived without changing what an older document means.
    ['1.2', '1.3', () => undefined],
];

/** The clip extrapolations a file may name. */
const EXTRAPOLATIONS = new Set(['none', 'hold', 'loop', 'pingPong', 'continue']);

function migrateAsset(raw: any): void {
    let version = raw.version ?? '1.0';

    for (const [from, to, fn] of MIGRATIONS) {
        if (version === from) {
            fn(raw);
            version = to;
        }
    }

    raw.version = TIMELINE_FORMAT_VERSION;
}

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function parseTrack(raw: any, readKeys: typeof adoptDecodedKeyframes): Track {
    const base = {
        name: raw.name ?? '',
        childPath: raw.childPath ?? '',
        ...(raw.muted === true ? { muted: true } : {}),
        ...(raw.locked === true ? { locked: true } : {}),
        ...(typeof raw.group === 'string' && raw.group ? { group: raw.group } : {}),
    };

    switch (raw.type) {
        case TrackType.Property:
            return {
                ...base,
                type: TrackType.Property,
                component: raw.component ?? '',
                channels: (raw.channels ?? []).map((ch: any) => ({
                    property: ch.property,
                    ...(ch.muted === true ? { muted: true } : {}),
                    keyframes: readKeys(ch.keyframes ?? []),
                })),
            } as PropertyTrack;

        case TrackType.Spine:
            return {
                ...base,
                type: TrackType.Spine,
                clips: raw.clips ?? [],
                blendIn: raw.blendIn ?? 0,
            } as SpineTrack;

        case TrackType.SpriteAnim:
            return {
                ...base,
                type: TrackType.SpriteAnim,
                clip: raw.clip ?? '',
                startTime: raw.startTime ?? 0,
            } as SpriteAnimTrack;

        case TrackType.Audio:
            return {
                ...base,
                type: TrackType.Audio,
                events: (raw.events ?? []).map((e: any) => ({
                    time: finite(e.time, 0),
                    clip: typeof e.clip === 'string' ? e.clip : '',
                    volume: finite(e.volume, 1),
                    // A clip's fields only where it is one, so a moment reads and writes as it always did.
                    ...(finite(e.duration, 0) > 0 ? { duration: finite(e.duration, 0) } : {}),
                    ...(finite(e.clipIn, 0) > 0 ? { clipIn: finite(e.clipIn, 0) } : {}),
                    ...(finite(e.fadeIn, 0) > 0 ? { fadeIn: finite(e.fadeIn, 0) } : {}),
                    ...(finite(e.fadeOut, 0) > 0 ? { fadeOut: finite(e.fadeOut, 0) } : {}),
                    ...(e.loop === true ? { loop: true } : {}),
                })),
            } as AudioTrack;

        case TrackType.Activation:
            return {
                ...base,
                type: TrackType.Activation,
                ranges: raw.ranges ?? [],
            } as ActivationTrack;

        case TrackType.Marker:
            return {
                ...base,
                type: TrackType.Marker,
                markers: raw.markers ?? [],
            } as MarkerTrack;

        case TrackType.Particle:
            return { ...base, type: TrackType.Particle, events: (raw.events ?? []).filter((e: any) =>
                Number.isFinite(e.time) && e.time >= 0 && ['play', 'stop', 'reset'].includes(e.action))
                .map((e: any) => ({ time: e.time, action: e.action })) } as ParticleTrack;

        case TrackType.CustomEvent:
            return {
                ...base,
                type: TrackType.CustomEvent,
                events: (raw.events ?? []).map((e: any) => ({
                    time: e.time ?? 0,
                    name: e.name ?? '',
                    payload: e.payload ?? {},
                    // Only a stretch that is one: a negative or broken length is a moment.
                    ...(Number.isFinite(e.duration) && e.duration > 0 ? { duration: e.duration } : {}),
                })),
            } as CustomEventTrack;

        case TrackType.AnimFrames:
            return {
                ...base,
                type: TrackType.AnimFrames,
                frames: (raw.animFrames ?? []).map((f: any) => ({
                    texture: f.texture ?? '',
                    duration: isSpriteFrameDuration(f.duration) ? f.duration : undefined,
                })),
            } as AnimFramesTrack;

        case TrackType.Camera:
            return {
                ...base,
                childPath: '',
                type: TrackType.Camera,
                clips: (raw.clips ?? []).map((c: any) => ({
                    start: finite(c.start, 0),
                    duration: Math.max(0, finite(c.duration, 0)),
                    camera: typeof c.camera === 'string' ? c.camera : '',
                    ...(typeof c.curve === 'number' ? { curve: c.curve } : {}),
                })),
            } as CameraTrack;

        case TrackType.Sequence:
            return {
                ...base,
                childPath: '',
                type: TrackType.Sequence,
                clips: (raw.clips ?? []).map((c: any) => ({
                    start: finite(c.start, 0),
                    duration: Math.max(0, finite(c.duration, 0)),
                    timeline: typeof c.timeline === 'string' ? c.timeline : '',
                    root: typeof c.root === 'string' ? c.root : '',
                    speed: finite(c.speed, 1) || 1,
                    loop: c.loop === true,
                })),
            } as SequenceTrack;

        case TrackType.Animation:
            return {
                ...base,
                type: TrackType.Animation,
                hold: raw.hold === true,
                ...(raw.blend === 'additive' ? { blend: 'additive' } : {}),
                ...(raw.rootMotion === true ? { rootMotion: true } : {}),
                ...(typeof raw.weight === 'number' && Number.isFinite(raw.weight) && raw.weight !== 1
                    ? { weight: Math.min(1, Math.max(0, raw.weight)) } : {}),
                ...(Array.isArray(raw.mask) ? { mask: raw.mask.filter((m: unknown): m is string => typeof m === 'string') } : {}),
                clips: (raw.clips ?? []).map((c: any) => ({
                    start: finite(c.start, 0),
                    duration: Math.max(0, finite(c.duration, 0)),
                    clip: typeof c.clip === 'string' ? c.clip : '',
                    clipIn: Math.max(0, finite(c.clipIn, 0)),
                    speed: finite(c.speed, 1) || 1,
                    loop: c.loop === true,
                    easeIn: Math.max(0, finite(c.easeIn, 0)),
                    easeOut: Math.max(0, finite(c.easeOut, 0)),
                    ...(EXTRAPOLATIONS.has(c.preExtrapolation) && c.preExtrapolation !== 'none' ? { preExtrapolation: c.preExtrapolation } : {}),
                    ...(EXTRAPOLATIONS.has(c.postExtrapolation) && c.postExtrapolation !== 'none' ? { postExtrapolation: c.postExtrapolation } : {}),
                })),
            } as AnimationTrack;

        case TrackType.Spawn:
            return {
                ...base,
                type: TrackType.Spawn,
                clips: (raw.clips ?? []).map((c: any) => ({
                    start: finite(c.start, 0),
                    duration: Math.max(0, finite(c.duration, 0)),
                    prefab: typeof c.prefab === 'string' ? c.prefab : '',
                    name: typeof c.name === 'string' ? c.name : '',
                })),
            } as SpawnTrack;

        case TrackType.CameraShake:
            return {
                ...base,
                type: TrackType.CameraShake,
                shakes: (raw.shakes ?? []).map((s: any) => ({ time: finite(s.time, 0), force: Math.max(0, finite(s.force, 1)) })),
            } as CameraShakeTrack;

        default:
            log.warn('timeline', `Unknown track type: ${raw.type}, skipping`);
            return null as any;
    }
}

/** Read a timeline from file text or from a caller's object. The clip reader also accepts flipbooks. */
export function readTimelineDocument(
    source: unknown,
    readLegacy?: (raw: Record<string, any>) => TimelineAsset | undefined,
): TimelineAsset {
    const fromText = typeof source === 'string';
    const raw = ((fromText ? JSON.parse(source) : source) ?? {}) as Record<string, any>;
    const legacy = readLegacy?.(raw);
    if (legacy) return legacy;
    migrateAsset(raw);
    const readKeys = fromText ? adoptDecodedKeyframes : loadKeyframes;

    return {
        version: TIMELINE_FORMAT_VERSION,
        type: 'timeline',
        duration: raw.duration ?? 0,
        wrapMode: wrapModeFromName(raw.wrapMode),
        tracks: (raw.tracks ?? [])
            .map((track: any) => parseTrack(track, readKeys))
            .filter((t: Track | null) => t !== null),
    };
}

/** Parse a timeline document or its JSON text. Object inputs keep their own keyframe storage. */
export function parseTimelineAsset(rawJson: unknown): TimelineAsset {
    return readTimelineDocument(rawJson);
}

export interface TimelineAssetPaths {
    audio: string[];
    animClips: string[];
    textures: string[];
    /** The timelines its sequence clips play. */
    timelines: string[];
    /** Distinct prefab references used by spawn clips. */
    prefabs: string[];
}

/** Rebase the clips that play other timeline documents, leaving authored data intact. */
export function resolveTimelineClipRefs(asset: TimelineAsset, resolve: (ref: string) => string): TimelineAsset {
    const refs = new Map<string, string>();
    const resolved = (ref: string) => {
        if (!ref) return ref;
        const cached = refs.get(ref);
        if (cached !== undefined) return cached;
        const path = resolve(ref);
        refs.set(ref, path);
        return path;
    };
    const tracks = asset.tracks.map(track => {
        if (track.type === TrackType.Sequence) {
            const clips = track.clips.map(clip => {
                const timeline = resolved(clip.timeline);
                return timeline === clip.timeline ? clip : { ...clip, timeline };
            });
            if (clips.some((clip, i) => clip !== track.clips[i])) return { ...track, clips };
        }
        if (track.type === TrackType.Animation) {
            const clips = track.clips.map(item => {
                const clip = resolved(item.clip);
                return clip === item.clip ? item : { ...item, clip };
            });
            if (clips.some((clip, i) => clip !== track.clips[i])) return { ...track, clips };
        }
        return track;
    });
    return tracks.some((track, i) => track !== asset.tracks[i]) ? { ...asset, tracks } : asset;
}

export function extractTimelineAssetPaths(asset: TimelineAsset): TimelineAssetPaths {
    const audio = new Set<string>();
    const animClips = new Set<string>();
    const textures = new Set<string>();
    const timelines = new Set<string>();

    for (const track of asset.tracks) {
        if (track.type === TrackType.Audio) {
            for (const event of track.events) {
                audio.add(event.clip);
            }
        } else if (track.type === TrackType.SpriteAnim) {
            if (track.clip) {
                animClips.add(track.clip);
            }
        } else if (track.type === TrackType.Sequence) {
            for (const clip of track.clips) if (clip.timeline) timelines.add(clip.timeline);
        } else if (track.type === TrackType.Animation) {
            // An animation clip is a timeline of joint curves: loaded with the rest, as a nested sequence is.
            for (const clip of track.clips) if (clip.clip) timelines.add(clip.clip);
        } else if (track.type === TrackType.AnimFrames) {
            for (const frame of track.frames) {
                if (frame.texture) {
                    textures.add(frame.texture);
                }
            }
        }
    }

    return {
        audio: Array.from(audio),
        animClips: Array.from(animClips),
        textures: Array.from(textures),
        timelines: Array.from(timelines),
        prefabs: Array.from(timelineSpawnPrefabRefs(asset)),
    };
}
