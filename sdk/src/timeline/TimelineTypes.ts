// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The `.estimeline` format version. What the serializer stamps and what the
 * loader migrates up to: two constants would let a document be written at a
 * version its own reader thinks needs migrating.
 */
export const TIMELINE_FORMAT_VERSION = '1.3';

export const WrapMode = {
    Once: 0,
    Loop: 1,
    PingPong: 2,
} as const;

export type WrapMode = (typeof WrapMode)[keyof typeof WrapMode];

// Single source for the wrapMode ↔ on-disk-string mapping, shared by the loader,
// the plugin, and the serializer so the three can't drift.
const WRAP_MODE_BY_NAME: Record<string, WrapMode> = {
    once: WrapMode.Once,
    loop: WrapMode.Loop,
    pingPong: WrapMode.PingPong,
};

const WRAP_MODE_NAMES: Record<WrapMode, string> = {
    [WrapMode.Once]: 'once',
    [WrapMode.Loop]: 'loop',
    [WrapMode.PingPong]: 'pingPong',
};

/** Decode a serialized wrapMode string; unknown / missing → `Once`. */
export function wrapModeFromName(value: string | undefined): WrapMode {
    if (!value) return WrapMode.Once;
    return WRAP_MODE_BY_NAME[value] ?? WrapMode.Once;
}

/** Whether `value` is a wrap mode name at all — what tells an OVERRIDE from a
 *  typo, where decoding to `Once` would look like a deliberate choice. */
export function isWrapModeName(value: string | undefined): boolean {
    return !!value && value in WRAP_MODE_BY_NAME;
}

/** Encode a wrapMode to its on-disk string (inverse of {@link wrapModeFromName}). */
export function wrapModeToName(mode: WrapMode): string {
    return WRAP_MODE_NAMES[mode] ?? 'once';
}

export const TrackType = {
    Property: 'property',
    Spine: 'spine',
    SpriteAnim: 'spriteAnim',
    Audio: 'audio',
    Particle: 'particle',
    Activation: 'activation',
    Marker: 'marker',
    CustomEvent: 'customEvent',
    AnimFrames: 'animFrames',
    Camera: 'camera',
    Sequence: 'sequence',
} as const;

export type TrackType = (typeof TrackType)[keyof typeof TrackType];

// A channel's keys are the engine's ONE curve shape — see math/keyframes. Re-exported
// rather than restated: a timeline that spelled its own would drift from what the
// particle system and the editor's curve view sample.
import { InterpType, type Keyframe } from '../math/keyframes';
export { InterpType, type Keyframe };

export interface PropertyChannel {
    property: string;
    keyframes: Keyframe[];
}

export interface TrackBase {
    type: TrackType;
    name: string;
    childPath: string;
}

export interface PropertyTrack extends TrackBase {
    type: typeof TrackType.Property;
    component: string;
    channels: PropertyChannel[];
}

export interface SpineClip {
    start: number;
    duration: number;
    animation: string;
    loop: boolean;
    speed: number;
}

export interface SpineTrack extends TrackBase {
    type: typeof TrackType.Spine;
    clips: SpineClip[];
    blendIn: number;
}

export interface SpriteAnimTrack extends TrackBase {
    type: typeof TrackType.SpriteAnim;
    clip: string;
    startTime: number;
}

export interface ParticleTrack extends TrackBase {
    type: typeof TrackType.Particle;
    events: { time: number; action: 'play' | 'stop' | 'reset' }[];
}

export interface AudioEvent {
    time: number;
    clip: string;
    volume: number;
}

export interface AudioTrack extends TrackBase {
    type: typeof TrackType.Audio;
    events: AudioEvent[];
}

export interface ActivationRange {
    start: number;
    end: number;
}

export interface ActivationTrack extends TrackBase {
    type: typeof TrackType.Activation;
    ranges: ActivationRange[];
}

export interface Marker {
    time: number;
    name: string;
}

export interface MarkerTrack extends TrackBase {
    type: typeof TrackType.Marker;
    markers: Marker[];
}

export interface CustomEvent {
    time: number;
    name: string;
    payload: Record<string, unknown>;
}

export interface CustomEventTrack extends TrackBase {
    type: typeof TrackType.CustomEvent;
    events: CustomEvent[];
}

export interface AnimFrame {
    texture: string;
    duration?: number;
}

export interface AnimFramesTrack extends TrackBase {
    type: typeof TrackType.AnimFrames;
    frames: AnimFrame[];
}

/**
 * One shot: the camera that is the view for `duration` seconds from `start`.
 * Shots that touch cut; shots that overlap blend over the overlap, with this shot's `curve` (a
 * BlendCurve) shaping the later one's arrival.
 */
export interface CameraClip {
    start: number;
    duration: number;
    /** The camera entity, as a name path below the timeline's root, like every track's target. */
    camera: string;
    curve?: number;
}

/** The view over time. Not about any one object, so its `childPath` is always empty. */
export interface CameraTrack extends TrackBase {
    type: typeof TrackType.Camera;
    clips: CameraClip[];
}

/** Another timeline, played in a window of this one. */
export interface SequenceClip {
    start: number;
    duration: number;
    /** The `.estimeline` it plays, by asset ref. */
    timeline: string;
    /** Where the nested timeline's own name paths start, below this timeline's root ('' = the root itself). */
    root: string;
    speed: number;
    /** Repeat the nested timeline to fill `duration` instead of holding its last frame. */
    loop: boolean;
}

export interface SequenceTrack extends TrackBase {
    type: typeof TrackType.Sequence;
    clips: SequenceClip[];
}

export type Track = PropertyTrack | SpineTrack | SpriteAnimTrack | ParticleTrack | AudioTrack | ActivationTrack | MarkerTrack | CustomEventTrack | AnimFramesTrack | CameraTrack | SequenceTrack;

export interface TimelineAsset {
    version: string;
    type: 'timeline';
    duration: number;
    wrapMode: WrapMode;
    tracks: Track[];
}

/**
 * One era of a `.estimeline` as its realm publishes it: the parsed asset and the
 * texture handles it resolved. Both belong to the era — a hot update prepares a
 * new one rather than editing this in place.
 */
export interface PublishedTimeline {
    asset: TimelineAsset;
    textureHandles: Map<string, number>;
}
