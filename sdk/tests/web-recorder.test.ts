// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The browser recorder: the lifecycle a mini-game host runs, over
 *        MediaRecorder on the engine canvas, ending in a preview it cannot share.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createWebRecorder } from '../src/platform/webRecorder';
import { webAdapter } from '../src/platform/web';
import { getPlatform, isPlatformInitialized, platformScreenRecorder, setPlatform } from '../src/platform/base';
import { App } from '../src/app/app';
import { bindRenderSurface } from '../src/app/surface';

class FakeMediaRecorder extends EventTarget {
    static made: FakeMediaRecorder[] = [];
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    mimeType = 'video/webm';
    constructor(readonly stream: unknown) { super(); FakeMediaRecorder.made.push(this); }
    start() { this.state = 'recording'; queueMicrotask(() => this.dispatchEvent(new Event('start'))); }
    pause() { this.state = 'paused'; queueMicrotask(() => this.dispatchEvent(new Event('pause'))); }
    resume() { this.state = 'recording'; queueMicrotask(() => this.dispatchEvent(new Event('resume'))); }
    stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
            const data = Object.assign(new Event('dataavailable'), { data: new Blob(['frames']) });
            this.dispatchEvent(data);
            this.dispatchEvent(new Event('stop'));
        });
    }
}

beforeEach(() => {
    FakeMediaRecorder.made = [];
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    Object.assign(canvas, { captureStream: () => ({ getTracks: () => [] }) });
    document.body.appendChild(canvas);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.getElementById('canvas')?.remove();
});

describe('recording in a browser', () => {
    it('is no recorder where the browser has no MediaRecorder', () => {
        vi.stubGlobal('MediaRecorder', undefined);
        expect(createWebRecorder()).toBeNull();
    });

    it('records the engine canvas and hands back a preview', async () => {
        const r = createWebRecorder()!;
        await r.start(60, () => {});
        const recording = await r.stop();
        expect(FakeMediaRecorder.made).toHaveLength(1);
        expect(recording.blob?.type).toBe('video/webm');
        expect(await recording.blob?.text()).toBe('frames');
    });

    it('stops taking frames at the limit and still waits for stop, as the hosts do', async () => {
        vi.useFakeTimers();
        let t = 0;
        const r = createWebRecorder(undefined, undefined, () => t)!;
        await r.start(5, () => {});
        t = 5000;
        await vi.advanceTimersByTimeAsync(5000);
        expect(FakeMediaRecorder.made[0].state).toBe('paused');
        t = 9000;
        expect((await r.stop()).durationMs).toBe(5000);
    });

    it('cannot share, and says so', async () => {
        const r = createWebRecorder()!;
        expect(r.canShare).toBe(false);
        await expect(r.share({ durationMs: 1, highlights: [] }, {})).rejects.toThrow('nowhere to publish');
    });

    it('resolves the owning App, restores the live default on quit and excludes a renderless App', () => {
        const previous = isPlatformInitialized() ? getPlatform() : undefined;
        setPlatform(webAdapter);
        const fallback = platformScreenRecorder();
        const rendered = [App.new(), App.new()];
        const renderer = (app: App) => {
            const canvas = document.createElement('canvas');
            Object.assign(canvas, { captureStream: () => ({ getTracks: () => [] }) });
            bindRenderSurface(app, { canvas }, { kind: 'gl-context', handle: 17 });
            return platformScreenRecorder(app);
        };
        try {
            expect(platformScreenRecorder(App.new())).toBeNull();
            const first = renderer(rendered[0]);
            const second = renderer(rendered[1]);
            expect(first).toBeTruthy();
            expect(second).toBeTruthy();
            expect(second).not.toBe(first);
            expect(platformScreenRecorder()).toBe(second);
            expect(platformScreenRecorder(rendered[0])).toBe(first);
            rendered[1].quit();
            expect(platformScreenRecorder(rendered[1])).toBeNull();
            expect(platformScreenRecorder()).toBe(first);
            rendered[0].quit();
            expect(platformScreenRecorder()).toBe(fallback);
        } finally {
            for (const app of rendered) app.quit();
            if (previous) setPlatform(previous);
        }
    });

    it('rechecks a missing canvas and keeps independent captures when Play reuses one', async () => {
        const canvas = document.querySelector('canvas')!;
        canvas.remove();
        expect(webAdapter.screenRecorder()).toBeNull();
        const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
        Object.assign(canvas, { captureStream() {
            const track = { stop: vi.fn() };
            tracks.push(track);
            return { getTracks: () => [track] };
        } });
        document.body.append(canvas);
        expect(webAdapter.screenRecorder()).toBeTruthy();
        expect(webAdapter.screenRecorder(null)).toBeNull();
        const life = new AbortController();
        const prior = webAdapter.screenRecorder(canvas, life.signal)!;
        const current = webAdapter.screenRecorder(canvas, new AbortController().signal)!;
        expect(webAdapter.screenRecorder(canvas, life.signal)).toBe(prior);
        await prior.start(60, () => {});
        await current.start(60, () => {});
        life.abort(new Error('left Play'));
        expect(tracks[0].stop).toHaveBeenCalledOnce();
        expect(tracks[1].stop).not.toHaveBeenCalled();
        await expect(prior.start(60, () => {})).rejects.toThrow('left Play');
        await current.stop();
        expect(tracks[1].stop).toHaveBeenCalledOnce();
    });

    it('releases the stream on a rejected start and ignores late events after an abort', async () => {
        const canvas = document.querySelector('canvas')!;
        const stop = vi.fn();
        Object.assign(canvas, { captureStream: () => ({ getTracks: () => [{ stop }] }) });
        const r = createWebRecorder(canvas)!;
        const fail = vi.fn();
        vi.spyOn(FakeMediaRecorder.prototype, 'start').mockImplementationOnce(() => { throw new Error('start refused'); });
        await expect(r.start(5, fail)).rejects.toThrow('start refused');
        expect(stop).toHaveBeenCalledOnce();
        await r.start(5, fail);
        const stale = FakeMediaRecorder.made[1];
        await r.abort();
        await r.start(5, fail);
        stale.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['stale']) }));
        stale.dispatchEvent(new Event('error'));
        expect(await (await r.stop()).blob?.text()).toBe('frames');
        expect(fail).not.toHaveBeenCalled();
        expect(stop).toHaveBeenCalledTimes(3);
    });

    it('settles a pending start on quit and a pending pause on a browser failure', async () => {
        const life = new AbortController();
        const r = createWebRecorder(undefined, life.signal)!;
        const fail = vi.fn();
        const starting = r.start(5, fail);
        life.abort(new Error('stopped'));
        await expect(starting).rejects.toThrow('stopped');
        expect(fail).not.toHaveBeenCalled();
        const next = createWebRecorder()!;
        await next.start(5, fail);
        const pausing = next.pause();
        FakeMediaRecorder.made[1].dispatchEvent(Object.assign(new Event('error'), { error: new Error('lost track') }));
        await expect(pausing).rejects.toThrow('lost track');
        expect(fail).toHaveBeenCalledOnce();
        await next.start(5, fail);
        await next.abort();
    });
});
