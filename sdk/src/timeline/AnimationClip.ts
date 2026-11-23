// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimationClip.ts
 * @brief   The unified animation-clip loader — one .esanim document the Sequencer
 *          authors and the Animator state-machine references.
 *
 * The editor unified two formats into `.esanim`: the rich multi-track model
 * (property curves + sprite frames + events + …) and the legacy sprite-flipbook
 * AnimClip (frames + fps). `parseAnimationClip` accepts either — discriminating by
 * structure, not the `type` string — and returns the one in-memory model
 * ({@link TimelineAsset}). A flipbook becomes a clip with a single sprite-frame
 * track, so old `.esanim` files keep working while everything converges on one
 * format. (The engine's two RUNTIMES merge in P4; this is the format seam.)
 */

import { readTimelineDocument } from './TimelineLoader';
import { WrapMode, TrackType, type TimelineAsset, type AnimFramesTrack } from './TimelineTypes';

/** Convert a legacy flipbook AnimClip (frames + fps) to a single sprite-frame track. */
function readLegacyFlipbook(raw: Record<string, any>): TimelineAsset | undefined {
    if (Array.isArray(raw.tracks) || !Array.isArray(raw.frames)) return undefined;
    const fps = typeof raw.fps === 'number' && raw.fps > 0 ? raw.fps : 12;
    const frames = raw.frames.map((f: any) => ({
        texture: f.texture ?? '',
        duration: f.duration ?? 1 / fps,
    }));
    const duration = frames.reduce((sum: number, f: any) => sum + (f.duration ?? 1 / fps), 0);
    const track: AnimFramesTrack = {
        type: TrackType.AnimFrames,
        name: 'Sprite',
        childPath: '',
        frames,
    };
    return {
        version: '1.1',
        type: 'timeline',
        duration,
        wrapMode: raw.loop === false ? WrapMode.Once : WrapMode.Loop,
        tracks: [track],
    };
}

/**
 * Parse any `.esanim` / legacy `.estimeline` document or its JSON text into the unified clip model.
 * Discriminates by shape: a `tracks` array is the rich multi-track clip; a `frames`
 * array is the legacy flipbook.
 */
export function parseAnimationClip(rawJson: unknown): TimelineAsset {
    return readTimelineDocument(rawJson, readLegacyFlipbook);
}
