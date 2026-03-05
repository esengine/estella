export const WrapMode = {
    Once: 0,
    Loop: 1,
    PingPong: 2,
} as const;

export type WrapMode = (typeof WrapMode)[keyof typeof WrapMode];

export const TrackType = {
    Property: 'property',
    Spine: 'spine',
    SpriteAnim: 'spriteAnim',
    Audio: 'audio',
    Activation: 'activation',
} as const;

export type TrackType = (typeof TrackType)[keyof typeof TrackType];

export interface Keyframe {
    time: number;
    value: number;
    inTangent: number;
    outTangent: number;
}

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

export type Track = PropertyTrack | SpineTrack | SpriteAnimTrack | AudioTrack | ActivationTrack;

export interface TimelineAsset {
    version: string;
    type: 'timeline';
    duration: number;
    wrapMode: WrapMode;
    tracks: Track[];
}
