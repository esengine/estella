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
    Marker: 'marker',
    CustomEvent: 'customEvent',
    AnimFrames: 'animFrames',
} as const;

export type TrackType = (typeof TrackType)[keyof typeof TrackType];

export const InterpType = {
    Hermite: 'hermite',
    Linear: 'linear',
    Step: 'step',
    EaseIn: 'easeIn',
    EaseOut: 'easeOut',
    EaseInOut: 'easeInOut',
} as const;

export type InterpType = (typeof InterpType)[keyof typeof InterpType];

export interface Keyframe {
    time: number;
    value: number;
    inTangent: number;
    outTangent: number;
    interpolation?: InterpType;
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

export type Track = PropertyTrack | SpineTrack | SpriteAnimTrack | AudioTrack | ActivationTrack | MarkerTrack | CustomEventTrack | AnimFramesTrack;

export interface TimelineAsset {
    version: string;
    type: 'timeline';
    duration: number;
    wrapMode: WrapMode;
    tracks: Track[];
}
