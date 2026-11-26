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
import type { PlatformCanvas, PlatformRecording, PlatformScreenRecorder } from './types';
import { RecordingClock } from './recordingClock';
import { createAbort, type AbortHandle } from '../util/abort';

const FPS = 30;

export function defaultRecordingCanvas(): HTMLCanvasElement | null {
    return globalThis.document?.querySelector<HTMLCanvasElement>('canvas#canvas')
        ?? globalThis.document?.querySelector('canvas') ?? null;
}

interface Capture {
    recorder: MediaRecorder;
    stream: MediaStream;
    clock: RecordingClock;
    chunks: Blob[];
    end: AbortHandle;
    maxMs: number;
    timer?: ReturnType<typeof setTimeout>;
    stopping: boolean;
    onQuit: () => void;
}

/** A browser error or an App quitting also settles a pending command. */
function waitFor(capture: Capture, event: 'start' | 'pause' | 'resume' | 'stop', act: () => void): Promise<void> {
    const { recorder, end: { signal } } = capture;
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const cleanup = () => {
            recorder.removeEventListener(event, done);
            signal.removeEventListener('abort', cancelled);
        };
        const done = () => { cleanup(); resolve(); };
        const cancelled = () => { cleanup(); reject(signal.reason); };
        recorder.addEventListener(event, done);
        signal.addEventListener('abort', cancelled);
        try { act(); } catch (error) { cleanup(); reject(error); }
    });
}

export function createWebRecorder(canvas: PlatformCanvas | null = defaultRecordingCanvas(), lifetime?: AbortSignal, now?: () => number): PlatformScreenRecorder | null {
    const target = canvas as (PlatformCanvas & Partial<Pick<HTMLCanvasElement, 'captureStream'>>) | null;
    if (typeof MediaRecorder === 'undefined' || typeof target?.captureStream !== 'function' || lifetime?.aborted) return null;
    const captureStream = target.captureStream.bind(target);
    let active: Capture | null = null;

    const release = (s: Capture, reason?: unknown) => {
        if (active !== s) return;
        active = null;
        clearTimeout(s.timer);
        lifetime?.removeEventListener('abort', s.onQuit);
        s.end.abort(reason);
        for (const track of s.stream.getTracks()) track.stop();
    };
    const session = (): Capture => {
        if (!active) throw new Error('not recording');
        return active;
    };
    const armLimit = (s: Capture) => {
        clearTimeout(s.timer);
        s.timer = setTimeout(() => {
            if (s.recorder.state === 'recording') s.recorder.pause();
            s.clock.pause();
        }, Math.max(0, s.maxMs - s.clock.elapsedMs()));
    };

    return {
        limits: { minSeconds: 1, maxSeconds: 7200 },
        canShare: false,
        async start(maxSeconds, onFailure) {
            if (lifetime?.aborted) throw lifetime.reason;
            if (active) throw new Error('already recording');
            const stream = captureStream(FPS);
            let recorder: MediaRecorder;
            try { recorder = new MediaRecorder(stream); }
            catch (error) {
                for (const track of stream.getTracks()) track.stop();
                throw error;
            }
            let started = false;
            const fail = (error: Error) => {
                if (active !== s) return;
                release(s, error);
                if (started) onFailure(error);
            };
            const s: Capture = {
                recorder, stream, chunks: [], clock: new RecordingClock(now), end: createAbort(),
                maxMs: maxSeconds * 1000, stopping: false,
                onQuit: () => fail(lifetime?.reason instanceof Error ? lifetime.reason : new Error('the recording App quit')),
            };
            active = s;
            lifetime?.addEventListener('abort', s.onQuit, { once: true });
            recorder.addEventListener('dataavailable', e => { if (active === s && e.data.size) s.chunks.push(e.data); });
            recorder.addEventListener('error', e => {
                const error = (e as ErrorEvent).error;
                fail(error instanceof Error ? error : new Error('the browser stopped recording'));
            });
            recorder.addEventListener('stop', () => {
                if (!s.stopping) fail(new Error('the browser stopped recording'));
            });
            try {
                await waitFor(s, 'start', () => recorder.start());
                if (s.end.signal.aborted) throw s.end.signal.reason;
                started = true;
                s.clock.start();
                armLimit(s);
            } catch (error) { release(s, error); throw error; }
        },
        async pause() {
            const s = session();
            clearTimeout(s.timer);
            if (s.recorder.state === 'recording') await waitFor(s, 'pause', () => s.recorder.pause());
            s.clock.pause();
        },
        async resume() {
            const s = session();
            if (s.clock.elapsedMs() >= s.maxMs) return;
            if (s.recorder.state === 'paused') await waitFor(s, 'resume', () => s.recorder.resume());
            if (active !== s) return;
            s.clock.resume();
            armLimit(s);
        },
        async stop(): Promise<PlatformRecording> {
            const s = session();
            if (s.stopping) throw new Error('already stopping');
            s.stopping = true;
            clearTimeout(s.timer);
            try {
                await waitFor(s, 'stop', () => s.recorder.stop());
                if (s.end.signal.aborted) throw s.end.signal.reason;
                const durationMs = s.clock.elapsedMs();
                return { durationMs, blob: new Blob(s.chunks, { type: s.recorder.mimeType || 'video/webm' }),
                    highlights: s.clock.highlights(durationMs) };
            } finally { release(s); }
        },
        async abort() {
            const s = active;
            if (!s) return;
            try { if (s.recorder.state !== 'inactive') s.recorder.stop(); }
            finally { release(s); }
        },
        highlight(before, after) { active?.clock.mark(before, after); },
        share() { return Promise.reject(new Error('a browser has nowhere to publish a recording')); },
    };
}
