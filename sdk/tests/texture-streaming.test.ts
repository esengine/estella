// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import {
    planStreaming, streamTargetEdge, streamedBytes, TEXTURE_STREAMING_DEFAULTS, type StreamedTexture,
} from '../src/render/textureStreaming';
import { defaultQualityProfile, resolveQualityProfile } from '../src/render/quality';

const tex = (handle: number, edge: number, wanted: number, seenAt = 0, full = 2048): StreamedTexture =>
    ({ handle, fullWidth: full, fullHeight: full, edge, wanted, seenAt, smallerSince: -1 });

describe('the size a texture is held at', () => {
    it('is the next power of two above what is wanted, between the floor and the file', () => {
        expect(streamTargetEdge(2048, 300, 64)).toBe(512);
        expect(streamTargetEdge(2048, 512, 64)).toBe(512);
        expect(streamTargetEdge(2048, 5000, 64)).toBe(2048);
        expect(streamTargetEdge(2048, 3, 64)).toBe(64);
        expect(streamTargetEdge(2048, 0, 64)).toBe(64);
        expect(streamTargetEdge(32, 0, 64)).toBe(32);
    });

    it('costs a quarter for each level it drops', () => {
        expect(streamedBytes(2048, 2048, 1024) / streamedBytes(2048, 2048, 2048)).toBeCloseTo(0.25, 3);
        expect(streamedBytes(2048, 1024, 512)).toBe(Math.round(512 * 256 * 4 * 4 / 3));
    });
});

describe('what streaming moves', () => {
    const opts = { ...TEXTURE_STREAMING_DEFAULTS };

    it('grows a texture at once, the most starved first', () => {
        const a = tex(1, 256, 1000), b = tex(2, 64, 1000);
        const moves = planStreaming([a, b], 100, opts);
        expect(moves).toEqual([{ handle: 2, edge: 1024 }, { handle: 1, edge: 1024 }]);
    });

    it('shrinks one only once it has been needed smaller for a while', () => {
        const a = tex(1, 2048, 100);
        expect(planStreaming([a], 0, opts)).toEqual([]);
        expect(planStreaming([a], opts.shrinkAfter - 1, opts)).toEqual([]);
        expect(planStreaming([a], opts.shrinkAfter, opts)).toEqual([{ handle: 1, edge: 128 }]);
        // Needed full size again before then, and the wait starts over.
        const b = tex(2, 2048, 100);
        planStreaming([b], 0, opts);
        b.wanted = 4000;
        expect(planStreaming([b], 10, opts)).toEqual([]);
        expect(b.smallerSince).toBe(-1);
    });

    it('lets a texture no view draws go to the floor', () => {
        const a = tex(1, 2048, 4000, 0);
        planStreaming([a], opts.unseenAfter + 1, opts);
        expect(planStreaming([a], opts.unseenAfter + 1 + opts.shrinkAfter, opts)).toEqual([{ handle: 1, edge: 64 }]);
    });

    it('halves the largest until the textures fit the budget', () => {
        const big = tex(1, 64, 4000), small = tex(2, 64, 300);
        const budget = streamedBytes(2048, 2048, 1024) + streamedBytes(2048, 2048, 512);
        const moves = planStreaming([big, small], 0, { ...opts, budgetBytes: budget });
        expect(moves).toEqual([{ handle: 1, edge: 1024 }, { handle: 2, edge: 512 }]);
    });
});

describe('the quality levels', () => {
    it('stream on the weaker two, with a budget, and not on high', () => {
        expect(defaultQualityProfile('low').textureStreaming).toBe(true);
        expect(defaultQualityProfile('medium').textureStreamingBudget).toBeGreaterThan(defaultQualityProfile('low').textureStreamingBudget);
        expect(defaultQualityProfile('high').textureStreaming).toBe(false);
        expect(resolveQualityProfile('high', { textureStreaming: true, textureStreamingBudget: 512 }).textureStreamingBudget).toBe(512);
    });
});
