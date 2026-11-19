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
    Animation: 'animation',
    Spawn: 'spawn',
    CameraShake: 'cameraShake',
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
    /** Left out of playback, as a muted track is. */
    muted?: boolean;
}

export interface TrackBase {
    type: TrackType;
    name: string;
    childPath: string;
    /** Left out of playback everywhere (the game, an animator state, the editor's preview), as Unity's and UE's mute. */
    muted?: boolean;
    /** Not editable in the Sequencer until unlocked. Playback ignores it. */
    locked?: boolean;
    /** The folder the Sequencer shows the track in (Unity's Track Group, UE's folder); empty for none. */
    group?: string;
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

/**
 * A sound on an audio track. Without a `duration` it is a moment: the whole sound, fired once as the playhead crosses
 * `time`. With one it is a clip (Unity's audio clip, UE's audio section): heard while the playhead is inside it, from
 * `clipIn` seconds into the sound, faded in and out, looped to fill it if asked, paused with the timeline and stopped
 * at its end, and joined at the right place when the playhead lands inside it.
 */
export interface AudioEvent {
    time: number;
    clip: string;
    volume: number;
    /** Seconds it is heard for; absent or 0, the whole sound once. */
    duration?: number;
    /** Seconds into the sound it starts from. */
    clipIn?: number;
    /** Seconds to rise from silence, and to fall back to it. */
    fadeIn?: number;
    fadeOut?: number;
    /** Repeat the sound to fill the clip. */
    loop?: boolean;
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
    /**
     * Seconds of clip time the event stays open from `time`: a window (an attack's
     * active frames, a combo's input window) that an animator reports while its
     * playhead is inside it. The event is still posted once at `time`. Absent or 0,
     * it is a moment and nothing more.
     */
    duration?: number;
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

/**
 * One animation clip on an animation track: a skeletal animation (an `.estimeline` of joint curves, as a model import
 * writes them) played on the track's rig from `start` for `duration` seconds.
 */
export interface AnimationClipItem {
    start: number;
    duration: number;
    /** The animation it plays, by asset ref. */
    clip: string;
    /** Seconds into the animation the clip starts from (Unity's Clip In). */
    clipIn: number;
    speed: number;
    /** Repeat the animation to fill the clip instead of holding its last frame. */
    loop: boolean;
    /** Seconds the clip takes to blend in from what the rig was doing, and to blend back out. Where two clips overlap,
     *  the overlap is the crossfade instead. */
    easeIn: number;
    easeOut: number;
    /** What the clip plays before it starts, when it is the track's first (Unity's Pre-Extrapolate); absent is none. */
    preExtrapolation?: AnimationExtrapolation;
    /** What the clip plays after it ends, until the next clip (Unity's Post-Extrapolate); absent is none. */
    postExtrapolation?: AnimationExtrapolation;
}

/**
 * How a clip fills time outside itself, as Unity's clip extrapolation does: `none` leaves the rig to its own animation,
 * `hold` keeps the clip's end frame, `loop` and `pingPong` repeat the clip's span forwards or back and forth, and
 * `continue` keeps playing its animation on (looping it or holding its last frame as the clip's Loop says).
 */
export type AnimationExtrapolation = 'none' | 'hold' | 'loop' | 'pingPong' | 'continue';

/** How an animation track meets the tracks before it on the same rig (Unity's override track, an additive layer). */
export type AnimationTrackBlend = 'override' | 'additive';

/**
 * Skeletal animation over time on one rig (Unity's Animation Track, UE's Skeletal Animation track): clips that blend
 * into each other where they overlap, and over the rig's own animation (its Animator) where they ease in or out. At full
 * weight the track decides the pose.
 */
export interface AnimationTrack extends TrackBase {
    type: typeof TrackType.Animation;
    clips: AnimationClipItem[];
    /** Keep the last clip's final pose after it ends (Unity's Post-Extrapolation Hold), instead of handing the rig back. */
    hold: boolean;
    /**
     * How this track meets the animation tracks before it on the same rig: `override` (the default) leans their pose
     * toward its own, `additive` adds what its clips move beyond their own first frame. The first track on a rig meets
     * the rig's own animation.
     */
    blend?: AnimationTrackBlend;
    /** How much of the track there is, 0 to 1; absent is 1. */
    weight?: number;
    /**
     * The parts of the rig the track may move (Unity's Avatar Mask on a track): paths below the rig, each the subtree
     * under it, '' the whole rig. Absent moves all of it; an empty list moves nothing.
     */
    mask?: string[];
}

/** One instance of a spawn track: a prefab made for as long as the playhead is inside the clip. */
export interface SpawnClip {
    start: number;
    duration: number;
    /** The prefab it makes, by asset ref. */
    prefab: string;
    /** What the instance is called: the timeline's other tracks address it by this name, below the track's entity. */
    name: string;
}

/**
 * Entities a timeline brings in for a while (UE's spawnables, the prefab of Unity's Control track): each clip makes its
 * prefab under the track's entity when the playhead enters it and takes it away when the playhead leaves.
 */
export interface SpawnTrack extends TrackBase {
    type: typeof TrackType.Spawn;
    clips: SpawnClip[];
}

/** One shake of a camera shake track: a moment, and how hard. */
export interface CameraShakeItem {
    time: number;
    /** How hard, as a multiple of the impulse source's strength (or of the default shake): 1 as authored. */
    force: number;
}

/**
 * Camera shakes at moments (UE's Camera Shake track, Cinemachine's impulse fired from a timeline): as the playhead
 * crosses one, an impulse is fired from the track's entity when it has a CameraImpulseSource, felt by the listening
 * cameras by their distance; otherwise the view in use is shaken where it is.
 */
export interface CameraShakeTrack extends TrackBase {
    type: typeof TrackType.CameraShake;
    shakes: CameraShakeItem[];
}

export type Track = PropertyTrack | SpineTrack | SpriteAnimTrack | ParticleTrack | AudioTrack | ActivationTrack | MarkerTrack | CustomEventTrack | AnimFramesTrack | CameraTrack | SequenceTrack | AnimationTrack | SpawnTrack | CameraShakeTrack;

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

/**
 * The timeline as it plays: without its muted tracks and muted property channels. Every player reads a timeline
 * through this (a TimelinePlayer, an animator state, a nested sequence, the editor's preview), so a mute is honoured
 * wherever the timeline plays. The asset itself when nothing is muted.
 */
export function playableTimeline(asset: TimelineAsset): TimelineAsset {
    let any = false;
    // A partial asset (a code registration without tracks) plays as it is.
    for (const t of asset.tracks ?? []) {
        if (t.muted || (t.type === TrackType.Property && t.channels.some((c) => c.muted))) { any = true; break; }
    }
    if (!any) return asset;
    const tracks: Track[] = [];
    for (const t of asset.tracks) {
        if (t.muted) continue;
        if (t.type === TrackType.Property && t.channels.some((c) => c.muted)) {
            const channels = t.channels.filter((c) => !c.muted);
            if (channels.length) tracks.push({ ...t, channels });
            continue;
        }
        tracks.push(t);
    }
    return { ...asset, tracks };
}
