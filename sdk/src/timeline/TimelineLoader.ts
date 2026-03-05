import {
    WrapMode,
    TrackType,
    type TimelineAsset,
    type Track,
    type PropertyTrack,
    type SpineTrack,
    type SpriteAnimTrack,
    type AudioTrack,
    type ActivationTrack,
} from './TimelineTypes';

const WRAP_MODE_MAP: Record<string, WrapMode> = {
    once: WrapMode.Once,
    loop: WrapMode.Loop,
    pingPong: WrapMode.PingPong,
};

function parseWrapMode(value: string | undefined): WrapMode {
    if (!value) return WrapMode.Once;
    return WRAP_MODE_MAP[value] ?? WrapMode.Once;
}

function parseTrack(raw: any): Track {
    const base = {
        name: raw.name ?? '',
        childPath: raw.childPath ?? '',
    };

    switch (raw.type) {
        case TrackType.Property:
            return {
                ...base,
                type: TrackType.Property,
                component: raw.component ?? '',
                channels: (raw.channels ?? []).map((ch: any) => ({
                    property: ch.property,
                    keyframes: ch.keyframes ?? [],
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
                events: raw.events ?? [],
            } as AudioTrack;

        case TrackType.Activation:
            return {
                ...base,
                type: TrackType.Activation,
                ranges: raw.ranges ?? [],
            } as ActivationTrack;

        default:
            throw new Error(`Unknown track type: ${raw.type}`);
    }
}

export function parseTimelineAsset(raw: any): TimelineAsset {
    return {
        version: raw.version ?? '1.0',
        type: 'timeline',
        duration: raw.duration ?? 0,
        wrapMode: parseWrapMode(raw.wrapMode),
        tracks: (raw.tracks ?? []).map(parseTrack),
    };
}

export interface TimelineAssetPaths {
    audio: string[];
    animClips: string[];
}

export function extractTimelineAssetPaths(asset: TimelineAsset): TimelineAssetPaths {
    const audio = new Set<string>();
    const animClips = new Set<string>();

    for (const track of asset.tracks) {
        if (track.type === TrackType.Audio) {
            for (const event of track.events) {
                audio.add(event.clip);
            }
        } else if (track.type === TrackType.SpriteAnim) {
            if (track.clip) {
                animClips.add(track.clip);
            }
        }
    }

    return {
        audio: Array.from(audio),
        animClips: Array.from(animClips),
    };
}
