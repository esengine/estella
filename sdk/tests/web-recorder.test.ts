// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The browser recorder: the lifecycle a mini-game host runs, over
 *        MediaRecorder on the engine canvas, ending in a preview it cannot share.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createWebRecorder } from '../src/platform/webRecorder';

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
    (canvas as unknown as { captureStream: () => unknown }).captureStream = () => ({ fake: 'stream' });
    document.body.appendChild(canvas);
});

afterEach(() => {
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
        expect(FakeMediaRecorder.made[0].stream).toEqual({ fake: 'stream' });
        expect(recording.blob?.type).toBe('video/webm');
        expect(await recording.blob?.text()).toBe('frames');
    });

    it('stops taking frames at the limit and still waits for stop, as the hosts do', async () => {
        vi.useFakeTimers();
        let t = 0;
        const r = createWebRecorder(() => t)!;
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
});
