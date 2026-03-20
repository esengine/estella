import type { TimelineState } from './TimelineState';
import {
    RULER_HEIGHT,
    TRACK_HEIGHT,
} from './TimelineState';
import type {
    TimelineAssetData,
    KeyframeHit,
    SpineClipHit,
    AudioEventHit,
    ActivationRangeHit,
    MarkerHit,
    CustomEventHit,
    SpriteAnimHit,
    AnimFrameHit,
    AnimFrameData,
    NonPropertyHit,
} from './TimelineTypes';

const KEYFRAME_HIT_RADIUS = 6;
const EDGE_RESIZE_ZONE = 8;

export function hitTestKeyframe(
    x: number,
    y: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): KeyframeHit | null {
    if (!assetData) return null;

    const tracks = state.tracks;
    let rowY = RULER_HEIGHT;

    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const assetTrack = assetData.tracks[track.index];

        if (assetTrack?.type === 'property' && assetTrack.channels) {
            if (y >= rowY && y < rowY + TRACK_HEIGHT) {
                const hit = hitTestChannelKeyframes(assetTrack.channels, x, rowY, track.index, state);
                if (hit) return hit;
            }
        }
        rowY += TRACK_HEIGHT;

        if (track.expanded && track.channelCount > 0 && assetTrack?.type === 'property') {
            for (let c = 0; c < track.channelCount; c++) {
                if (y >= rowY && y < rowY + TRACK_HEIGHT) {
                    const channel = assetTrack.channels?.[c];
                    if (channel) {
                        const hit = hitTestSingleChannel(channel.keyframes, x, rowY, track.index, c, state);
                        if (hit) return hit;
                    }
                }
                rowY += TRACK_HEIGHT;
            }
        }
    }

    return null;
}

function hitTestChannelKeyframes(
    channels: { keyframes: { time: number }[] }[],
    x: number,
    rowY: number,
    trackIndex: number,
    state: TimelineState,
): KeyframeHit | null {
    for (let c = 0; c < channels.length; c++) {
        const hit = hitTestSingleChannel(channels[c].keyframes, x, rowY, trackIndex, c, state);
        if (hit) return hit;
    }
    return null;
}

function hitTestSingleChannel(
    keyframes: { time: number }[],
    x: number,
    rowY: number,
    trackIndex: number,
    channelIndex: number,
    state: TimelineState,
): KeyframeHit | null {
    const cy = rowY + TRACK_HEIGHT / 2;

    for (let ki = 0; ki < keyframes.length; ki++) {
        const kf = keyframes[ki];
        const kx = state.timeToX(kf.time);
        const dx = x - kx;
        const dy = (rowY + TRACK_HEIGHT / 2) - cy;

        if (Math.abs(dx) <= KEYFRAME_HIT_RADIUS && Math.abs(dy) <= KEYFRAME_HIT_RADIUS) {
            return { trackIndex, channelIndex, keyframeIndex: ki, time: kf.time };
        }
    }
    return null;
}

export function hitTestSpineClip(
    x: number,
    y: number,
    trackIndex: number,
    rowY: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): SpineClipHit | null {
    if (!assetData) return null;
    const track = assetData.tracks[trackIndex];
    if (!track || track.type !== 'spine' || !track.clips) return null;
    if (y < rowY || y >= rowY + TRACK_HEIGHT) return null;

    for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i];
        const x1 = state.timeToX(clip.start);
        const x2 = state.timeToX(clip.start + clip.duration);
        if (x >= x1 && x <= x2) {
            const zone = (x2 - x) <= EDGE_RESIZE_ZONE ? 'resize' : 'body';
            return { trackIndex, clipIndex: i, zone };
        }
    }
    return null;
}

export function hitTestAudioEvent(
    x: number,
    y: number,
    trackIndex: number,
    rowY: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): AudioEventHit | null {
    if (!assetData) return null;
    const track = assetData.tracks[trackIndex];
    if (!track || track.type !== 'audio' || !track.events) return null;
    if (y < rowY || y >= rowY + TRACK_HEIGHT) return null;

    for (let i = 0; i < track.events.length; i++) {
        const ex = state.timeToX(track.events[i].time);
        if (Math.abs(x - ex) <= KEYFRAME_HIT_RADIUS) {
            return { trackIndex, eventIndex: i };
        }
    }
    return null;
}

export function hitTestActivationRange(
    x: number,
    y: number,
    trackIndex: number,
    rowY: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): ActivationRangeHit | null {
    if (!assetData) return null;
    const track = assetData.tracks[trackIndex];
    if (!track || track.type !== 'activation' || !track.ranges) return null;
    if (y < rowY || y >= rowY + TRACK_HEIGHT) return null;

    for (let i = 0; i < track.ranges.length; i++) {
        const range = track.ranges[i];
        const x1 = state.timeToX(range.start);
        const x2 = state.timeToX(range.end);
        if (x >= x1 && x <= x2) {
            const zone = (x - x1) <= EDGE_RESIZE_ZONE ? 'left'
                : (x2 - x) <= EDGE_RESIZE_ZONE ? 'right'
                : 'body';
            return { trackIndex, rangeIndex: i, zone };
        }
    }
    return null;
}

export function hitTestMarker(
    x: number,
    trackIndex: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): MarkerHit | null {
    if (!assetData) return null;
    const track = assetData.tracks[trackIndex];
    if (!track || track.type !== 'marker' || !track.markers) return null;

    for (let i = 0; i < track.markers.length; i++) {
        const mx = state.timeToX(track.markers[i].time);
        if (Math.abs(x - mx) <= KEYFRAME_HIT_RADIUS) {
            return { trackIndex, markerIndex: i };
        }
    }
    return null;
}

export function hitTestCustomEvent(
    x: number,
    trackIndex: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): CustomEventHit | null {
    if (!assetData) return null;
    const track = assetData.tracks[trackIndex];
    if (!track || track.type !== 'customEvent' || !track.events) return null;

    for (let i = 0; i < track.events.length; i++) {
        const ex = state.timeToX(track.events[i].time);
        if (Math.abs(x - ex) <= KEYFRAME_HIT_RADIUS) {
            return { trackIndex, eventIndex: i };
        }
    }
    return null;
}

export function hitTestSpriteAnim(
    x: number,
    trackIndex: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): SpriteAnimHit | null {
    if (!assetData) return null;
    const track = assetData.tracks[trackIndex];
    if (!track || track.type !== 'spriteAnim' || track.startTime == null) return null;

    const sx = state.timeToX(track.startTime);
    if (Math.abs(x - sx) <= KEYFRAME_HIT_RADIUS) {
        return { trackIndex };
    }
    return null;
}

export function hitTestAnimFrame(
    x: number,
    trackIndex: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): AnimFrameHit | null {
    if (!assetData) return null;
    const track = assetData.tracks[trackIndex];
    if (!track || track.type !== 'animFrames' || !track.animFrames) return null;

    const fps = state.animClipFps;
    const defaultDur = 1 / fps;
    let time = 0;

    for (let i = 0; i < track.animFrames.length; i++) {
        const dur = (track.animFrames[i] as AnimFrameData).duration ?? defaultDur;
        const x1 = state.timeToX(time);
        const x2 = state.timeToX(time + dur);

        if (x >= x1 && x <= x2) {
            const zone = (x2 - x) <= EDGE_RESIZE_ZONE ? 'resize' : 'body';
            return { trackIndex, frameIndex: i, zone };
        }
        time += dur;
    }
    return null;
}

export function hitTestNonPropertyTrack(
    x: number,
    y: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): NonPropertyHit | null {
    if (!assetData) return null;

    const tracks = state.tracks;
    let rowY = RULER_HEIGHT;

    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const assetTrack = assetData.tracks[track.index];

        if (y >= rowY && y < rowY + TRACK_HEIGHT && assetTrack) {
            if (assetTrack.type === 'spine') {
                const hit = hitTestSpineClip(x, y, track.index, rowY, state, assetData);
                if (hit) return { type: 'spine', hit };
            } else if (assetTrack.type === 'audio') {
                const hit = hitTestAudioEvent(x, y, track.index, rowY, state, assetData);
                if (hit) return { type: 'audio', hit };
            } else if (assetTrack.type === 'activation') {
                const hit = hitTestActivationRange(x, y, track.index, rowY, state, assetData);
                if (hit) return { type: 'activation', hit };
            } else if (assetTrack.type === 'marker') {
                const hit = hitTestMarker(x, track.index, state, assetData);
                if (hit) return { type: 'marker', hit };
            } else if (assetTrack.type === 'customEvent') {
                const hit = hitTestCustomEvent(x, track.index, state, assetData);
                if (hit) return { type: 'customEvent', hit };
            } else if (assetTrack.type === 'spriteAnim') {
                const hit = hitTestSpriteAnim(x, track.index, state, assetData);
                if (hit) return { type: 'spriteAnim', hit };
            } else if (assetTrack.type === 'animFrames') {
                const hit = hitTestAnimFrame(x, track.index, state, assetData);
                if (hit) return { type: 'animFrames', hit };
            }
        }
        rowY += TRACK_HEIGHT;

        if (track.expanded && track.channelCount > 0) {
            rowY += track.channelCount * TRACK_HEIGHT;
        }
    }
    return null;
}

export function collectKeyframesInRect(
    x1: number, y1: number, x2: number, y2: number,
    state: TimelineState,
    assetData: TimelineAssetData | null,
): KeyframeHit[] {
    if (!assetData) return [];

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const hits: KeyframeHit[] = [];

    const tracks = state.tracks;
    let rowY = RULER_HEIGHT;

    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const assetTrack = assetData.tracks[track.index];

        if (assetTrack?.type === 'property' && assetTrack.channels) {
            if (rowY + TRACK_HEIGHT > minY && rowY < maxY) {
                for (let c = 0; c < assetTrack.channels.length; c++) {
                    collectChannelKeyframesInRange(
                        assetTrack.channels[c].keyframes, minX, maxX,
                        track.index, c, hits, state,
                    );
                }
            }
        }
        rowY += TRACK_HEIGHT;

        if (track.expanded && track.channelCount > 0 && assetTrack?.type === 'property') {
            for (let c = 0; c < track.channelCount; c++) {
                if (rowY + TRACK_HEIGHT > minY && rowY < maxY) {
                    const channel = assetTrack.channels?.[c];
                    if (channel) {
                        collectChannelKeyframesInRange(
                            channel.keyframes, minX, maxX,
                            track.index, c, hits, state,
                        );
                    }
                }
                rowY += TRACK_HEIGHT;
            }
        }
    }

    return hits;
}

function collectChannelKeyframesInRange(
    keyframes: { time: number }[],
    minX: number, maxX: number,
    trackIndex: number, channelIndex: number,
    out: KeyframeHit[],
    state: TimelineState,
): void {
    for (let ki = 0; ki < keyframes.length; ki++) {
        const kx = state.timeToX(keyframes[ki].time);
        if (kx >= minX && kx <= maxX) {
            out.push({ trackIndex, channelIndex, keyframeIndex: ki, time: keyframes[ki].time });
        }
    }
}

export function getTrackAtY(
    y: number,
    state: TimelineState,
): { trackIndex: number; channelIndex: number; isChannel: boolean } | null {
    const tracks = state.tracks;
    let rowY = RULER_HEIGHT;

    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];

        if (y >= rowY && y < rowY + TRACK_HEIGHT) {
            return { trackIndex: track.index, channelIndex: -1, isChannel: false };
        }
        rowY += TRACK_HEIGHT;

        if (track.expanded && track.channelCount > 0) {
            for (let c = 0; c < track.channelCount; c++) {
                if (y >= rowY && y < rowY + TRACK_HEIGHT) {
                    return { trackIndex: track.index, channelIndex: c, isChannel: true };
                }
                rowY += TRACK_HEIGHT;
            }
        }
    }
    return null;
}
