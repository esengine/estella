// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    recorder.ts
 * @brief   The mini-game hosts' screen recorders behind one PlatformScreenRecorder.
 *
 * WeChat and Douyin disagree on nearly everything but the verbs. WeChat's
 * control calls return promises, its outcomes are `on(event)` events, and it
 * never hands the game a file: a clip is shared by `operateGameRecorderVideo`
 * with ms ranges. Douyin's calls are synchronous with one listener per outcome,
 * `onStop` hands over a temp file, and a clip is cut live by `recordClip`, then
 * merged by `clipVideo` and published through `shareAppMessage`. Both must share
 * from inside a tap.
 *
 * Sources: developers.weixin.qq.com/minigame/dev/api/game-recorder/ and
 * developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/media/screen-recording/
 */
import type {
    PlatformRecording, PlatformRecordingShareOptions, PlatformScreenRecorder,
} from '../types';
import type { MiniGameGlobal, MiniGameTtRecorder, MiniGameWxRecorder } from './api';
import { RecordingClock } from '../recordingClock';

/** Hosts answer in well under a second; one that has not answered in this long
 *  will not, and a caller awaiting it would hang a record button forever. */
const HOST_ANSWER_MS = 5000;

/** WeChat's documented ceiling on a shared clip, and its floor. */
const WX_SHARE_MAX_MS = 60_000;
const WX_SHARE_MIN_MS = 2_000;

/**
 * Turns "call, then wait for the host's event" into one promise. A host error
 * while a call waits is that call's failure; one while nothing waits is the
 * recording's, which the caller hears through `onStray`.
 */
class HostGate {
    private waiting_: {
        event: string;
        resolve: (payload: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    } | null = null;

    constructor(private readonly onStray_: (error: Error) => void) {}

    wait(event: string, act: () => unknown): Promise<unknown> {
        if (this.waiting_) {
            return Promise.reject(new Error(`the recorder is still waiting for "${this.waiting_.event}"`));
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiting_ = null;
                reject(new Error(`the host did not report "${event}" within ${HOST_ANSWER_MS / 1000}s`));
            }, HOST_ANSWER_MS);
            this.waiting_ = { event, resolve, reject, timer };
            try {
                const r = act();
                if (r && typeof (r as Promise<unknown>).then === 'function') {
                    (r as Promise<unknown>).then(undefined, (e: unknown) => this.fail(toError(e)));
                }
            } catch (e) {
                this.fail(toError(e));
            }
        });
    }

    fire(event: string, payload?: unknown): void {
        const w = this.waiting_;
        if (!w || w.event !== event) return;
        clearTimeout(w.timer);
        this.waiting_ = null;
        w.resolve(payload);
    }

    fail(error: Error): void {
        const w = this.waiting_;
        if (!w) {
            this.onStray_(error);
            return;
        }
        clearTimeout(w.timer);
        this.waiting_ = null;
        w.reject(error);
    }
}

function toError(e: unknown): Error {
    if (e instanceof Error) return e;
    const o = e as { errMsg?: string; message?: string; errCode?: number; code?: number;
        error?: { message?: string; code?: number } } | undefined;
    // WeChat's own docs disagree on the error shape: the table says
    // `{ code, message }`, the sample reads `res.error.code`.
    const inner = o?.error ?? o;
    const err = new Error(inner?.message ?? o?.errMsg ?? String(e)) as Error & { code?: number };
    const code = inner?.code ?? o?.errCode;
    if (code !== undefined) err.code = code;
    return err;
}

function clampSeconds(seconds: number, limits: PlatformScreenRecorder['limits']): number {
    return Math.min(limits.maxSeconds, Math.max(limits.minSeconds, Math.round(seconds)));
}

/** The session state both recorders share: the clock, and who to tell when a
 *  started recording dies on its own. */
class Session {
    readonly clock: RecordingClock;
    active = false;
    private onFailure_: ((error: Error) => void) | null = null;

    constructor(now?: () => number) {
        this.clock = new RecordingClock(now);
    }

    begin(onFailure: (error: Error) => void): void {
        this.onFailure_ = onFailure;
    }

    started(): void {
        this.active = true;
        this.clock.start();
    }

    end(): void {
        this.active = false;
        this.onFailure_ = null;
    }

    stray(error: Error): void {
        const report = this.onFailure_;
        if (!this.active || !report) return;
        this.end();
        report(error);
    }
}

export function createWxRecorder(
    g: MiniGameGlobal,
    now?: () => number,
    limits: PlatformScreenRecorder['limits'] = { minSeconds: 5, maxSeconds: 7200 },
): PlatformScreenRecorder | null {
    const rec: MiniGameWxRecorder | undefined = g.getGameRecorder?.call(g);
    if (!rec) return null;
    if (rec.isFrameSupported && !rec.isFrameSupported.call(rec)) return null;
    const session = new Session(now);
    const gate = new HostGate((e) => session.stray(e));
    for (const event of ['start', 'stop', 'pause', 'resume', 'abort'] as const) {
        rec.on(event, (res) => gate.fire(event, res));
    }
    rec.on('error', (res) => gate.fail(toError(res)));

    return {
        limits,
        get canShare() {
            return typeof g.operateGameRecorderVideo === 'function' || typeof rec.publishVideo === 'function';
        },
        async start(maxSeconds, onFailure) {
            session.begin(onFailure);
            await gate.wait('start', () => rec.start({ duration: clampSeconds(maxSeconds, limits) }));
            session.started();
        },
        async pause() {
            await gate.wait('pause', () => rec.pause());
            session.clock.pause();
        },
        async resume() {
            await gate.wait('resume', () => rec.resume());
            session.clock.resume();
        },
        async stop() {
            const res = await gate.wait('stop', () => rec.stop()) as { duration?: number } | undefined;
            const durationMs = res?.duration ?? session.clock.elapsedMs();
            session.end();
            return { durationMs, highlights: session.clock.highlights(durationMs) };
        },
        async abort() {
            await gate.wait('abort', () => rec.abort());
            session.end();
        },
        highlight(before, after) {
            if (session.active) session.clock.mark(before, after);
        },
        share(recording, options) {
            const operate = g.operateGameRecorderVideo;
            if (!operate) return publish(rec, options);
            const timeRange = wxTimeRange(recording.highlights);
            if (timeRange && spanOf(timeRange) < WX_SHARE_MIN_MS) {
                return Promise.reject(new Error(
                    `the highlights add up to ${spanOf(timeRange)}ms; WeChat shares no clip shorter than ${WX_SHARE_MIN_MS / 1000}s`));
            }
            return new Promise<void>((resolve, reject) => {
                operate.call(g, {
                    ...shareText(options),
                    ...(timeRange ? { timeRange } : {}),
                    success: () => resolve(),
                    fail: (err) => reject(toError(err)),
                });
            });
        },
    };
}

/**
 * Kuaishou's share: the host publishes the last recording whole. It takes no
 * ranges, so highlights cannot narrow what is shared here — the recording
 * keeps them, and the host ignores them.
 */
function publish(rec: MiniGameWxRecorder, options: PlatformRecordingShareOptions): Promise<void> {
    const publishVideo = rec.publishVideo;
    if (!publishVideo) return Promise.reject(new Error('this host cannot share a recording'));
    return new Promise<void>((resolve, reject) => {
        publishVideo.call(rec, {
            ...(options.query !== undefined ? { query: options.query } : {}),
            callback: (error) => (error ? reject(toError(error)) : resolve()),
        });
    });
}

function spanOf(ranges: readonly (readonly number[])[]): number {
    return ranges.reduce((sum, [a, b]) => sum + (b - a), 0);
}

/** The newest highlights that fit WeChat's 60s ceiling — the moment a player
 *  just had is the one they want to share. Undefined shares the whole video. */
export function wxTimeRange(highlights: readonly (readonly [number, number])[]): number[][] | undefined {
    if (highlights.length === 0) return undefined;
    const kept: number[][] = [];
    let budget = WX_SHARE_MAX_MS;
    for (let i = highlights.length - 1; i >= 0 && budget > 0; i--) {
        const [a, b] = highlights[i];
        const start = Math.max(a, b - budget);
        kept.unshift([start, b]);
        budget -= b - start;
    }
    return kept;
}

function shareText(options: PlatformRecordingShareOptions): PlatformRecordingShareOptions {
    const out: PlatformRecordingShareOptions = {};
    if (options.title !== undefined) out.title = options.title;
    if (options.desc !== undefined) out.desc = options.desc;
    if (options.query !== undefined) out.query = options.query;
    return out;
}

export function createTtRecorder(g: MiniGameGlobal, now?: () => number): PlatformScreenRecorder | null {
    const rec: MiniGameTtRecorder | undefined = g.getGameRecorderManager?.call(g);
    if (!rec) return null;
    const session = new Session(now);
    const gate = new HostGate((e) => session.stray(e));
    rec.onStart(() => gate.fire('start'));
    rec.onPause(() => gate.fire('pause'));
    rec.onResume(() => gate.fire('resume'));
    rec.onStop((res) => gate.fire('stop', res));
    rec.onError((res) => gate.fail(toError(res)));
    // `start` must be longer than 3s; the host counts whole seconds.
    const limits = { minSeconds: 4, maxSeconds: 300 };
    // `clipVideo` cuts a recording once; a second share reuses the first cut.
    const cut = new WeakMap<PlatformRecording, string>();
    // The host's clips decide what is cut, not the local ranges: a highlight
    // whose seconds-after run past stop still exists on the host's side.
    const withClips = new WeakSet<PlatformRecording>();
    let clipsThisRecording = 0;

    const clipped = (recording: PlatformRecording, path: string): Promise<string> => {
        if (!withClips.has(recording)) return Promise.resolve(path);
        const done = cut.get(recording);
        if (done) return Promise.resolve(done);
        return new Promise((resolve, reject) => {
            // No clipRange: the host merges every recordClip of this recording in order.
            rec.clipVideo({
                path,
                success: (res) => { cut.set(recording, res.videoPath); resolve(res.videoPath); },
                fail: (err) => reject(toError(err)),
            });
        });
    };

    return {
        limits,
        get canShare() { return typeof g.shareAppMessage === 'function'; },
        async start(maxSeconds, onFailure) {
            session.begin(onFailure);
            await gate.wait('start', () => rec.start({ duration: clampSeconds(maxSeconds, limits) }));
            session.started();
            clipsThisRecording = 0;
        },
        async pause() {
            await gate.wait('pause', () => rec.pause());
            session.clock.pause();
        },
        async resume() {
            await gate.wait('resume', () => rec.resume());
            session.clock.resume();
        },
        async stop() {
            const res = await gate.wait('stop', () => rec.stop()) as { videoPath?: string } | undefined;
            const durationMs = session.clock.elapsedMs();
            session.end();
            const recording = { durationMs, path: res?.videoPath, highlights: session.clock.highlights(durationMs) };
            if (clipsThisRecording > 0) withClips.add(recording);
            return recording;
        },
        // Douyin has no abort: stopping and dropping the file is the same outcome.
        async abort() {
            await gate.wait('stop', () => rec.stop());
            session.end();
        },
        highlight(before, after) {
            if (!session.active) return;
            session.clock.mark(before, after);
            clipsThisRecording++;
            rec.recordClip({ timeRange: [before, after] });
        },
        async share(recording, options) {
            const shareApp = g.shareAppMessage;
            if (!shareApp) throw new Error('this host cannot share a recording');
            if (!recording.path) throw new Error('this recording has no video file to share');
            const videoPath = await clipped(recording, recording.path);
            await new Promise<void>((resolve, reject) => {
                shareApp.call(g, {
                    channel: 'video',
                    ...shareText(options),
                    extra: { videoPath },
                    success: () => resolve(),
                    fail: (err) => reject(toError(err)),
                });
            });
        },
    };
}

/** Whichever recorder this host has. Chosen by what the global offers, not by
 *  vendor id: a vendor copying WeChat's shape gets WeChat's recorder. */
export function createMiniGameRecorder(
    g: MiniGameGlobal,
    limits?: PlatformScreenRecorder['limits'],
): PlatformScreenRecorder | null {
    if (g.getGameRecorderManager) return createTtRecorder(g);
    if (g.getGameRecorder) return createWxRecorder(g, undefined, limits);
    return null;
}
