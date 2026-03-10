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
    type MarkerTrack,
    type CustomEventTrack,
} from './TimelineTypes';

const CURRENT_VERSION = '1.1';

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
];

function migrateAsset(raw: any): void {
    let version = raw.version ?? '1.0';

    for (const [from, to, fn] of MIGRATIONS) {
        if (version === from) {
            fn(raw);
            version = to;
        }
    }

    raw.version = CURRENT_VERSION;
}

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

        case TrackType.Marker:
            return {
                ...base,
                type: TrackType.Marker,
                markers: raw.markers ?? [],
            } as MarkerTrack;

        case TrackType.CustomEvent:
            return {
                ...base,
                type: TrackType.CustomEvent,
                events: (raw.events ?? []).map((e: any) => ({
                    time: e.time ?? 0,
                    name: e.name ?? '',
                    payload: e.payload ?? {},
                })),
            } as CustomEventTrack;

        default:
            console.warn(`[Timeline] Unknown track type: ${raw.type}, skipping`);
            return null as any;
    }
}

export function parseTimelineAsset(raw: any): TimelineAsset {
    migrateAsset(raw);

    return {
        version: CURRENT_VERSION,
        type: 'timeline',
        duration: raw.duration ?? 0,
        wrapMode: parseWrapMode(raw.wrapMode),
        tracks: (raw.tracks ?? []).map(parseTrack).filter((t: Track | null) => t !== null),
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
