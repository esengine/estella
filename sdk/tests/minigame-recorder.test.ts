// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The mini-game screen recorders over fake WeChat and Douyin hosts.
 *
 * Each fake answers the way its vendor's docs say: WeChat through `on(event)`
 * with a promise per call and no file, Douyin through one listener per outcome
 * with a temp file on stop. The claims are what the engine adds on top — a call
 * resolves when the host says it happened, highlights become each host's own
 * clip request, and a share is refused here when the host would refuse it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMiniGameRecorder, createTtRecorder, createWxRecorder, wxTimeRange } from '../src/platform/minigame/recorder';
import type { MiniGameGlobal } from '../src/platform/minigame/api';

type Listener = (res?: unknown) => void;

function fakeWx(options: { frame?: boolean; share?: boolean; answer?: boolean } = {}) {
    const listeners = new Map<string, Listener[]>();
    const emit = (event: string, res?: unknown): void => { for (const l of listeners.get(event) ?? []) l(res); };
    const answer = options.answer ?? true;
    const calls: { start: unknown[]; share: unknown[] } = { start: [], share: [] };
    let startedAt = 0;
    const clock = { t: 0 };
    const rec = {
        start(o: unknown) { calls.start.push(o); startedAt = clock.t; if (answer) queueMicrotask(() => emit('start')); },
        pause() { queueMicrotask(() => emit('pause')); return Promise.resolve(); },
        resume() { queueMicrotask(() => emit('resume')); return Promise.resolve(); },
        stop() { queueMicrotask(() => emit('stop', { duration: clock.t - startedAt })); return Promise.resolve(); },
        abort() { queueMicrotask(() => emit('abort')); return Promise.resolve(); },
        isFrameSupported: () => options.frame ?? true,
        on(event: string, cb: Listener) { listeners.set(event, [...(listeners.get(event) ?? []), cb]); },
        off() {},
    };
    const g = {
        getGameRecorder: () => rec,
        ...(options.share ?? true ? {
            operateGameRecorderVideo(o: { success?: () => void }) { calls.share.push(o); o.success?.(); },
        } : {}),
    } as unknown as MiniGameGlobal;
    return { g, emit, calls, clock };
}

function fakeTt() {
    const on: Record<string, Listener> = {};
    const clock = { t: 0 };
    const calls = { start: [] as unknown[], clip: [] as unknown[], cut: [] as unknown[], share: [] as unknown[] };
    const rec = {
        start(o: unknown) { calls.start.push(o); queueMicrotask(() => on.start?.()); },
        pause() { queueMicrotask(() => on.pause?.()); },
        resume() { queueMicrotask(() => on.resume?.()); },
        stop() { queueMicrotask(() => on.stop?.({ videoPath: 'ttfile://tmp/run.mp4' })); },
        recordClip(o: unknown) { calls.clip.push(o); },
        clipVideo(o: { path: string; success?: (r: { videoPath: string }) => void }) {
            calls.cut.push(o);
            o.success?.({ videoPath: `ttfile://tmp/cut-${calls.cut.length}.mp4` });
        },
        onStart: (cb: Listener) => { on.start = cb; },
        onPause: (cb: Listener) => { on.pause = cb; },
        onResume: (cb: Listener) => { on.resume = cb; },
        onStop: (cb: Listener) => { on.stop = cb; },
        onError: (cb: Listener) => { on.error = cb; },
    };
    const g = {
        getGameRecorderManager: () => rec,
        shareAppMessage(o: { success?: () => void }) { calls.share.push(o); o.success?.(); },
    } as unknown as MiniGameGlobal;
    return { g, on, calls, clock };
}

afterEach(() => { vi.useRealTimers(); });

describe('WeChat', () => {
    it('is no recorder on a device that cannot record frames', () => {
        expect(createWxRecorder(fakeWx({ frame: false }).g)).toBeNull();
    });

    it('starts when the host says it started, asking for a length it accepts', async () => {
        const host = fakeWx();
        const r = createWxRecorder(host.g)!;
        await r.start(2, () => {});
        expect(host.calls.start).toEqual([{ duration: 5 }]);
    });

    it('carries the host error to the start that caused it, in either documented shape', async () => {
        for (const shape of [{ code: 22022, message: 'frame not supported' },
            { error: { code: 22022, message: 'frame not supported' } }]) {
            const host = fakeWx({ answer: false });
            const r = createWxRecorder(host.g)!;
            const started = r.start(60, () => {});
            host.emit('error', shape);
            await expect(started).rejects.toMatchObject({ message: 'frame not supported', code: 22022 });
        }
    });

    it('gives up on a host that never answers, instead of hanging the button', async () => {
        vi.useFakeTimers();
        const r = createWxRecorder(fakeWx({ answer: false }).g)!;
        const started = r.start(60, () => {});
        const seen = expect(started).rejects.toThrow('did not report "start"');
        await vi.advanceTimersByTimeAsync(5000);
        await seen;
    });

    it('hands a stray host error to whoever started the recording', async () => {
        const host = fakeWx();
        const r = createWxRecorder(host.g)!;
        const onFailure = vi.fn();
        await r.start(60, onFailure);
        host.emit('error', { code: 22012, message: 'internal failed' });
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 22012 }));
    });

    it('stops with the host duration and highlights on the time axis that skips pauses', async () => {
        const host = fakeWx();
        const r = createWxRecorder(host.g, () => host.clock.t)!;
        await r.start(60, () => {});
        host.clock.t = 10_000;
        await r.pause();
        host.clock.t = 25_000;
        await r.resume();
        host.clock.t = 30_000;
        r.highlight(3, 1);
        const recording = await r.stop();
        expect(recording.durationMs).toBe(30_000);
        expect(recording.path).toBeUndefined();
        expect(recording.highlights).toEqual([[12_000, 16_000]]);
    });

    it('shares the highlights as the ms ranges WeChat cuts on', async () => {
        const host = fakeWx();
        const r = createWxRecorder(host.g)!;
        await r.share({ durationMs: 20_000, highlights: [[1000, 4000], [8000, 12_000]] }, { title: 'run' });
        expect(host.calls.share[0]).toMatchObject({ title: 'run', timeRange: [[1000, 4000], [8000, 12_000]] });
    });

    it('shares the whole video when nothing was highlighted', async () => {
        const host = fakeWx();
        await createWxRecorder(host.g)!.share({ durationMs: 20_000, highlights: [] }, {});
        expect(host.calls.share[0]).not.toHaveProperty('timeRange');
    });

    it('refuses a clip shorter than WeChat accepts, before asking the host', async () => {
        const host = fakeWx();
        const r = createWxRecorder(host.g)!;
        await expect(r.share({ durationMs: 9000, highlights: [[0, 1500]] }, {})).rejects.toThrow('shorter than 2s');
        expect(host.calls.share).toEqual([]);
    });

    it('says it cannot share where the host has no share call', () => {
        expect(createWxRecorder(fakeWx({ share: false }).g)!.canShare).toBe(false);
    });
});

describe('the newest highlights that fit WeChat\'s 60s', () => {
    it('keeps the latest and trims the oldest one that straddles the ceiling', () => {
        expect(wxTimeRange([[0, 30_000], [40_000, 70_000], [80_000, 90_000]]))
            .toEqual([[10_000, 30_000], [40_000, 70_000], [80_000, 90_000]]);
    });
});

describe('Douyin', () => {
    it('asks for a length longer than 3s and no longer than 300s', async () => {
        const host = fakeTt();
        const r = createTtRecorder(host.g)!;
        await r.start(1, () => {});
        await r.stop();
        await r.start(3600, () => {});
        expect(host.calls.start).toEqual([{ duration: 4 }, { duration: 300 }]);
    });

    it('stops with the temp file the host hands over', async () => {
        const r = createTtRecorder(fakeTt().g)!;
        await r.start(60, () => {});
        expect((await r.stop()).path).toBe('ttfile://tmp/run.mp4');
    });

    it('cuts a highlight live, then shares the merged cut — once, however often it is shared', async () => {
        const host = fakeTt();
        const r = createTtRecorder(host.g)!;
        await r.start(60, () => {});
        r.highlight(5, 2);
        expect(host.calls.clip).toEqual([{ timeRange: [5, 2] }]);
        const recording = await r.stop();
        await r.share(recording, { title: 'run' });
        await r.share(recording, { title: 'run' });
        expect(host.calls.cut).toHaveLength(1);
        expect(host.calls.share[0]).toMatchObject({
            channel: 'video', title: 'run', extra: { videoPath: 'ttfile://tmp/cut-1.mp4' },
        });
        expect(host.calls.share[1]).toMatchObject({ extra: { videoPath: 'ttfile://tmp/cut-1.mp4' } });
    });

    it('shares the whole file when nothing was highlighted', async () => {
        const host = fakeTt();
        const r = createTtRecorder(host.g)!;
        await r.start(60, () => {});
        await r.share(await r.stop(), {});
        expect(host.calls.cut).toEqual([]);
        expect(host.calls.share[0]).toMatchObject({ extra: { videoPath: 'ttfile://tmp/run.mp4' } });
    });

    it('carries the host refusal to the share', async () => {
        const host = fakeTt();
        (host.g as unknown as { shareAppMessage: unknown }).shareAppMessage =
            (o: { fail?: (e: unknown) => void }) => o.fail?.({ errMsg: 'shareAppMessage:fail video file is too short' });
        const r = createTtRecorder(host.g)!;
        await expect(r.share({ durationMs: 2000, path: 'ttfile://x', highlights: [] }, {}))
            .rejects.toThrow('video file is too short');
    });
});

describe('which recorder a host gets', () => {
    it('follows what the global offers, not the vendor name', () => {
        expect(createMiniGameRecorder({} as MiniGameGlobal)).toBeNull();
        expect(createMiniGameRecorder(fakeTt().g)!.limits.maxSeconds).toBe(300);
        expect(createMiniGameRecorder(fakeWx().g)!.limits.maxSeconds).toBe(7200);
    });
});
