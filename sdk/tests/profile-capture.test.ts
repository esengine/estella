// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    PROFILE_CAPTURE_VERSION,
    parseProfileCapture,
    summarizeFrames,
    summarizeCapture,
    percentile,
    frameProfileOf,
    type CapturedFrame,
    type ProfileCapture,
} from '../src/app/profileCapture';

const frame = (id: number, dtMs: number, over: Partial<CapturedFrame> = {}): CapturedFrame => ({
    id,
    dtMs,
    systems: [{ name: 'RenderSystem', ms: 2, domain: 'render' }],
    scopes: [],
    ...over,
});

const capture = (frames: CapturedFrame[]): ProfileCapture => ({
    version: PROFILE_CAPTURE_VERSION,
    generatedAt: '2026-08-12T00:00:00.000Z',
    source: { realm: 'play' },
    budgetMs: 1000 / 60,
    frames,
});

describe('percentile', () => {
    it('is 0 for an empty sample', () => expect(percentile([], 50)).toBe(0));
    it('pins the ends', () => {
        const v = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(percentile(v, 0)).toBe(1);
        expect(percentile(v, 100)).toBe(100);
    });
});

describe('summarizeFrames', () => {
    it('answers an empty set without inventing a frame rate', () => {
        const s = summarizeFrames([]);
        expect(s.frames).toBe(0);
        expect(s.fps).toBe(0);
        expect(s.worstFrameId).toBeNull();
        expect(s.mean.domains).toEqual([]);
    });

    it('reads fps from the median frame', () => {
        expect(summarizeFrames([frame(0, 16.7), frame(1, 16.7), frame(2, 16.7)]).fps).toBe(60);
    });

    it('names the worst frame so a reader can go to it', () => {
        const s = summarizeFrames([frame(0, 16), frame(1, 90), frame(2, 16)]);
        expect(s.worstFrameId).toBe(1);
        expect(s.worstFrameMs).toBe(90);
    });

    it('counts a stutter, not every frame a hair over budget', () => {
        const s = summarizeFrames([frame(0, 17), frame(1, 40), frame(2, 16.7)]);
        expect(s.longFrames).toBe(1);
    });

    it('averages counters per frame', () => {
        const s = summarizeFrames([
            frame(0, 16, { counters: { 'batch.draws': 4 } }),
            frame(1, 16, { counters: { 'batch.draws': 8 } }),
        ]);
        expect(s.counters['batch.draws']).toBeCloseTo(6, 4);
    });

    it('averages a counter over the whole window even when a frame lacked it', () => {
        const s = summarizeFrames([frame(0, 16, { counters: { 'batch.draws': 4 } }), frame(1, 16)]);
        expect(s.counters['batch.draws']).toBeCloseTo(2, 4);
    });

    it('keeps the mean profile summing like a frame', () => {
        const s = summarizeFrames([frame(0, 16.7), frame(1, 16.7)]);
        expect(s.mean.cpuMs + s.mean.waitMs + s.mean.idleMs).toBeCloseTo(s.mean.frameMs, 4);
    });

    it('takes the budget from the capture rather than assuming 60Hz', () => {
        const c = { ...capture([frame(0, 34), frame(1, 34)]), budgetMs: 1000 / 30 };
        expect(summarizeCapture(c).longFrames).toBe(0);
        expect(summarizeFrames(c.frames).longFrames).toBe(2);
    });
});

describe('frameProfileOf', () => {
    it('folds a captured frame with its native scopes', () => {
        const p = frameProfileOf(frame(0, 16.7, {
            scopes: [{ name: 'render.submit', ms: 2, system: 'RenderSystem', remainder: 'wait' }],
            nativeScopes: [{ name: 'render.collect', ms: 0.5, system: '', remainder: 'work' }],
        }));
        expect(p.waitMs).toBeCloseTo(1.5, 4);
        expect(p.cpuMs + p.waitMs + p.idleMs).toBeCloseTo(p.frameMs, 4);
    });
});

describe('parseProfileCapture', () => {
    it('reads a capture it wrote', () => {
        const r = parseProfileCapture(JSON.stringify(capture([frame(0, 16.7)])));
        expect('capture' in r && r.capture.frames).toHaveLength(1);
    });

    it('refuses rather than throwing on a file that is not JSON', () => {
        expect(parseProfileCapture('<html>')).toHaveProperty('error');
    });

    it('says so when the JSON is some other document', () => {
        const r = parseProfileCapture('{"hello":1}');
        expect('error' in r && r.error).toMatch(/no version/);
    });

    it('refuses a capture from a newer writer instead of half-reading it', () => {
        const r = parseProfileCapture(JSON.stringify({ ...capture([]), version: PROFILE_CAPTURE_VERSION + 1 }));
        expect('error' in r && r.error).toMatch(/newer than this editor reads/);
    });

    it('refuses frames that are not frames', () => {
        const r = parseProfileCapture(JSON.stringify({ ...capture([]), frames: [{ id: 0 }] }));
        expect('error' in r && r.error).toMatch(/not in the capture format/);
    });

    it('fills a missing budget rather than dividing by zero later', () => {
        const r = parseProfileCapture(JSON.stringify({ ...capture([frame(0, 16.7)]), budgetMs: 0 }));
        expect('capture' in r && r.capture.budgetMs).toBeCloseTo(1000 / 60, 4);
    });
});
