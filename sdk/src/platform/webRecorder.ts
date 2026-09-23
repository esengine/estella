// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    webRecorder.ts
 * @brief   A browser's screen recorder: MediaRecorder over the engine canvas.
 *
 * It exists so a record button can be built and tried where the game is made —
 * the editor's play mode and a web dev build — with the same lifecycle a
 * mini-game host runs. The result is a debug preview (`recording.blob`); a
 * browser has nowhere to publish a clip, so `canShare` is false.
 */
import type { PlatformRecording, PlatformScreenRecorder } from './types';
import { RecordingClock } from './recordingClock';

const FPS = 30;

function engineCanvas(): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    return (document.getElementById('canvas') as HTMLCanvasElement | null)
        ?? document.querySelector('canvas');
}

export function createWebRecorder(now?: () => number): PlatformScreenRecorder | null {
    if (typeof MediaRecorder === 'undefined') return null;
    const canvas = engineCanvas();
    if (!canvas || typeof canvas.captureStream !== 'function') return null;

    const clock = new RecordingClock(now);
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let limit: ReturnType<typeof setTimeout> | null = null;
    let maxMs = 0;

    // Like both hosts: at the limit nothing more is recorded, and the recording
    // still waits for stop().
    const armLimit = (): void => {
        limit = setTimeout(() => {
            limit = null;
            if (recorder?.state === 'recording') recorder.pause();
            clock.pause();
        }, Math.max(0, maxMs - clock.elapsedMs()));
    };
    const disarmLimit = (): void => {
        if (limit !== null) clearTimeout(limit);
        limit = null;
    };
    const settle = (event: 'start' | 'pause' | 'resume' | 'stop', act: (r: MediaRecorder) => void): Promise<void> =>
        new Promise((resolve, reject) => {
            const r = recorder;
            if (!r) { reject(new Error('not recording')); return; }
            r.addEventListener(event, () => resolve(), { once: true });
            try { act(r); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
        });

    return {
        limits: { minSeconds: 1, maxSeconds: 7200 },
        canShare: false,
        async start(maxSeconds, onFailure) {
            if (recorder) throw new Error('already recording');
            const r = new MediaRecorder(canvas.captureStream(FPS));
            recorder = r;
            chunks = [];
            r.addEventListener('dataavailable', (e) => { if (e.data.size > 0) chunks.push(e.data); });
            r.addEventListener('error', (e) => {
                disarmLimit();
                recorder = null;
                const err = (e as unknown as { error?: unknown }).error;
                onFailure(err instanceof Error ? err : new Error('the browser stopped recording'));
            });
            await settle('start', (rec) => rec.start());
            clock.start();
            maxMs = maxSeconds * 1000;
            armLimit();
        },
        async pause() {
            disarmLimit();
            if (recorder?.state === 'recording') await settle('pause', (r) => r.pause());
            clock.pause();
        },
        async resume() {
            if (recorder?.state === 'paused') await settle('resume', (r) => r.resume());
            clock.resume();
            armLimit();
        },
        async stop(): Promise<PlatformRecording> {
            disarmLimit();
            const mime = recorder?.mimeType || 'video/webm';
            await settle('stop', (r) => r.stop());
            recorder = null;
            const durationMs = clock.elapsedMs();
            return { durationMs, blob: new Blob(chunks, { type: mime }), highlights: clock.highlights(durationMs) };
        },
        async abort() {
            disarmLimit();
            if (recorder) await settle('stop', (r) => r.stop());
            recorder = null;
            chunks = [];
        },
        highlight(before, after) {
            if (recorder) clock.mark(before, after);
        },
        share() {
            return Promise.reject(new Error('a browser has nowhere to publish a recording'));
        },
    };
}
