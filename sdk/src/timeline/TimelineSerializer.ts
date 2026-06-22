/**
 * @file    TimelineSerializer.ts
 * @brief   Serialize an in-memory TimelineAsset back to .estimeline JSON — the
 *          inverse of TimelineLoader.parseTimelineAsset.
 *
 * The runtime previously only LOADED timelines; authoring (the Sequencer editor,
 * docs/REARCH_ANIMATION.md) needs to write them back. Field names and the wrapMode
 * string encoding mirror the loader exactly so parse(serialize(x)) round-trips —
 * notably AnimFrames tracks persist under the on-disk key `animFrames` (the loader
 * reads `raw.animFrames` into the in-memory `frames`).
 */

import { WrapMode, TrackType, type TimelineAsset, type Track } from './TimelineTypes';

const CURRENT_VERSION = '1.1';

const WRAP_MODE_NAMES: Record<WrapMode, string> = {
    [WrapMode.Once]: 'once',
    [WrapMode.Loop]: 'loop',
    [WrapMode.PingPong]: 'pingPong',
};

function serializeTrack(track: Track): Record<string, unknown> {
    const base = { type: track.type, name: track.name, childPath: track.childPath };

    switch (track.type) {
        case TrackType.Property:
            return {
                ...base,
                component: track.component,
                channels: track.channels.map(ch => ({
                    property: ch.property,
                    keyframes: ch.keyframes.map(kf => ({
                        time: kf.time,
                        value: kf.value,
                        inTangent: kf.inTangent,
                        outTangent: kf.outTangent,
                        ...(kf.interpolation ? { interpolation: kf.interpolation } : {}),
                    })),
                })),
            };
        case TrackType.Spine:
            return { ...base, clips: track.clips, blendIn: track.blendIn };
        case TrackType.SpriteAnim:
            return { ...base, clip: track.clip, startTime: track.startTime };
        case TrackType.Audio:
            return { ...base, events: track.events };
        case TrackType.Activation:
            return { ...base, ranges: track.ranges };
        case TrackType.Marker:
            return { ...base, markers: track.markers };
        case TrackType.CustomEvent:
            return { ...base, events: track.events };
        case TrackType.AnimFrames:
            // On-disk key is `animFrames` (matches the loader's read path).
            return { ...base, animFrames: track.frames };
        default:
            return base;
    }
}

/** Serialize to a plain JSON-ready object (the `.estimeline` document shape). */
export function serializeTimelineAsset(asset: TimelineAsset): Record<string, unknown> {
    return {
        version: CURRENT_VERSION,
        type: 'timeline',
        duration: asset.duration,
        wrapMode: WRAP_MODE_NAMES[asset.wrapMode] ?? 'once',
        tracks: asset.tracks.map(serializeTrack),
    };
}

/** Serialize to a pretty-printed JSON string for writing to disk. */
export function serializeTimelineToJson(asset: TimelineAsset, indent = 2): string {
    return JSON.stringify(serializeTimelineAsset(asset), null, indent);
}
