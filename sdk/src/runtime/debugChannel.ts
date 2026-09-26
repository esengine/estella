// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    debugChannel.ts
 * @brief   A development build's line back to the editor that exported it, over
 *          which the editor's frame debugger captures the device's frames.
 *          Carried only by a package that imports `esengine/debug-channel`.
 *
 * Only a build whose config carries `debugChannel` opens one, and only a
 * development export writes that field. The device dials out: a phone or a
 * mini-game host cannot be reached, and the editor authenticates the dial by the
 * token in its URL before a single frame crosses.
 */
import type { App } from '../app/app';
import { getPlatform, platformNow } from '../platform/base';
import type { PlatformSocket } from '../platform/types';
import type { NextFrame } from '../render/frameCapture';
import { captureFrameReport, captureEngineOf, replayFrameDraw, type FrameReplayImage } from '../render/frameDebugReport';
import { log } from '../util/logger';
import { Assets } from '../asset/AssetPlugin';
import { Lifecycle } from '../ecs/lifecycle';
import { frameStatsReport } from './frameStats';
import { worldSnapshot } from './worldSnapshot';
import { forwardConsole, type ConsoleLevel } from './consoleForward';
import {
    DEBUG_CHANNEL_PROTOCOL, type DebugChannelConfig, type DebugChannelMessage, type DebugChannelQuery,
} from './debugChannelProtocol';

const RECONNECT_MS = 3000;
const START_WAIT_MS = 20_000;
/** Lines held for the editor; past this the oldest go first, and how many is said. */
const LOG_BACKLOG = 500;
const LOG_FLUSH_MS = 100;
const PIXEL_CHUNK = 256 * 1024;

/** @p image scaled (nearest) so its longer side is at most @p maxSide; the full
 *  size rides along so a reader can say what it is looking at. */
/** The smallest step this platform's clock takes, sampled over about a millisecond. */
function clockResolutionMs(): number {
    let step = Infinity;
    let prev = platformNow();
    const end = prev + 1;
    for (let now = prev; now < end && step > 0.001; now = platformNow()) {
        if (now > prev) step = Math.min(step, now - prev);
        prev = now;
    }
    return Number.isFinite(step) ? step : 1;
}

export function fitWithin(image: FrameReplayImage, maxSide?: number): FrameReplayImage & { fullWidth: number; fullHeight: number } {
    const { width: w, height: h } = image;
    const scale = maxSide && maxSide > 0 ? Math.min(1, maxSide / Math.max(w, h)) : 1;
    if (scale === 1) return { ...image, fullWidth: w, fullHeight: h };
    const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
    const src = new Uint32Array(image.pixels.buffer, image.pixels.byteOffset, w * h);
    const out = new Uint32Array(sw * sh);
    for (let y = 0; y < sh; y++) {
        const row = Math.min(h - 1, Math.floor(y / scale)) * w;
        for (let x = 0; x < sw; x++) out[y * sw + x] = src[row + Math.min(w - 1, Math.floor(x / scale))];
    }
    return { ...image, width: sw, height: sh, pixels: new Uint8ClampedArray(out.buffer), fullWidth: w, fullHeight: h };
}

/** Resolves once @p app has finished a frame and the task that drew it has run. */
function appFrame(app: App): NextFrame {
    return () => new Promise((resolve) => {
        const off = app.onFrameEnd(() => {
            off();
            setTimeout(resolve, 0);
        });
    });
}

let active: { attach(app: App): void } | null = null;

/**
 * Dial the editor and forward everything printed from now on — called as soon as
 * a host has read its config, so an engine that fails to boot is still heard.
 * Redials when the connection drops: the editor restarts far more often than a
 * debug session ends. Once per page; later calls keep the first channel.
 */
export function startDebugChannel(config: DebugChannelConfig): void {
    if (active) return;
    const platform = getPlatform();
    if (!platform.createSocket) {
        log.warn('debug', `this platform has no socket, so the editor cannot reach this build (${platform.name})`);
        return;
    }
    let app: App | null = null;
    let nextFrame: NextFrame | null = null;
    // An editor may ask while the engine is still booting; the answer waits for the game.
    let started: () => void = () => {};
    const gameStarted = new Promise<void>((resolve) => { started = resolve; });
    let socket: PlatformSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let statsOn = false;
    let frameSum = 0, frames = 0, worstMs = 0;
    // What this channel itself costs the game, so a development build's numbers can
    // be read net of it: the console forwarding and the answers it builds in-frame.
    let agentMs = 0;
    // A span shorter than the clock's step reads 0: a browser that is not
    // cross-origin isolated steps performance.now() by 0.1 ms, where the channel's
    // own work is tens of microseconds. Reported so a 0 is read as "below this".
    let clockMs = 0;
    const timed = <T>(work: () => T): T => {
        const t0 = platformNow();
        try { return work(); } finally { agentMs += platformNow() - t0; }
    };

    const backlog: Array<{ level: ConsoleLevel; line: string }> = [];
    let dropped = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const send = (m: DebugChannelMessage): void => {
        if (socket?.readyState === 'open') socket.send(JSON.stringify(m));
    };
    const flushBacklog = (): void => {
        flushTimer = null;
        if (socket?.readyState !== 'open' || (backlog.length === 0 && dropped === 0)) return;
        const entries = backlog.splice(0, backlog.length);
        if (dropped > 0) entries.unshift({ level: 'warn', line: `[debug] ${dropped} line(s) are not shown: more were printed than the channel holds` });
        dropped = 0;
        send({ t: 'logs', entries });
    };
    forwardConsole((level, line) => timed(() => {
        if (backlog.length >= LOG_BACKLOG) { backlog.shift(); dropped++; }
        backlog.push({ level, line });
        if (flushTimer === null && socket?.readyState === 'open') flushTimer = setTimeout(flushBacklog, LOG_FLUSH_MS);
    }));
    const hello = (): void => {
        const assets = app?.hasResource(Assets) ? app.getResource(Assets) : null;
        send({
            t: 'hello', v: DEBUG_CHANNEL_PROTOCOL, platform: platform.name, title: platform.deviceName?.() ?? '',
            project: config.project ?? null, revision: assets?.getManifest()?.revision() ?? null,
        });
    };

    const answer = async (q: DebugChannelQuery): Promise<void> => {
        const reply = (m: DebugChannelMessage): void => send(m);
        try {
            if (!app) {
                const late = new Promise<never>((_, reject) => setTimeout(
                    () => reject(new Error(`the game did not start within ${START_WAIT_MS / 1000}s`)), START_WAIT_MS));
                await Promise.race([gameStarted, late]);
            }
            const game = app!;
            const frame = nextFrame!;
            // A background tab gets no frames, so it would sit on this until the editor gave up.
            const drawsFrames = !game.hasResource(Lifecycle) || game.getResource(Lifecycle).visible;
            if ((q.kind === 'frameCapture' || q.kind === 'frameReplay') && !drawsFrames) {
                throw new Error('the game is in the background, where it draws no frames: bring it to the front');
            }
            if ((q.kind === 'frameCapture' || q.kind === 'frameReplay') && !captureEngineOf(game)) {
                throw new Error('this build cannot capture frames: its host has no frame capture');
            }
            if (q.kind === 'frameCapture') {
                const report = await captureFrameReport(game, frame);
                if (!report) throw new Error('no frame arrived to capture — is the game running frames?');
                reply({ t: 'reply', reqId: q.reqId, data: report });
                return;
            }
            if (q.kind === 'stats') {
                // Timings cost a little every frame, so they start when first asked for.
                if (!statsOn) {
                    clockMs = clockResolutionMs();
                    game.enableStats();
                    game.onFrameEnd((dt) => { frameSum += dt; frames++; worstMs = Math.max(worstMs, dt); });
                    statsOn = true;
                }
                // The device's own frame time since the last ask: the editor's clock
                // runs on another machine and says nothing about this one.
                const report = timed(() => frameStatsReport(game));
                const span = { frames, frameMs: frames > 0 ? frameSum / frames : 0, worstMs, agentMs, clockMs };
                frameSum = 0; frames = 0; worstMs = 0; agentMs = 0;
                reply({ t: 'reply', reqId: q.reqId, data: { ...report, ...span } });
                return;
            }
            if (q.kind === 'updateStatus') {
                reply({ t: 'reply', reqId: q.reqId, data: game.hasResource(Assets) ? game.getResource(Assets).updateStatus() : null });
                return;
            }
            if (q.kind === 'snapshot') {
                reply({ t: 'reply', reqId: q.reqId, data: timed(() => worldSnapshot(game, q.selectedId, q.withTree)) });
                return;
            }
            if (q.kind === 'control') {
                if (q.fps !== undefined) game.setTargetFrameRate(q.fps);
                if (q.paused !== undefined) game.setPaused(q.paused);
                if (q.step && q.step > 0) await game.stepFrames(q.step);
                reply({ t: 'reply', reqId: q.reqId, data: { paused: game.isPaused(), fps: Math.round(game.getTargetFrameRate()) } });
                return;
            }
            const full = await replayFrameDraw(game, q.drawIndex, frame);
            if (!full) {
                reply({ t: 'reply', reqId: q.reqId, data: null });
                return;
            }
            // A mini-game's socket moved a full-screen replay at ~180KB/s (55 s);
            // the editor asks for what it will show.
            const image = timed(() => fitWithin(full, q.maxSide));
            const { pixels, ...rest } = image;
            const chunks = Math.max(1, Math.ceil(pixels.byteLength / PIXEL_CHUNK));
            reply({ t: 'reply', reqId: q.reqId, data: rest, pixels: chunks });
            for (let i = 0; i < chunks; i++) {
                const part = pixels.subarray(i * PIXEL_CHUNK, Math.min(pixels.byteLength, (i + 1) * PIXEL_CHUNK));
                socket?.send(part.slice().buffer as ArrayBuffer);
            }
        } catch (e) {
            reply({ t: 'reply', reqId: q.reqId, error: e instanceof Error ? e.message : String(e) });
        }
    };

    const dial = (): void => {
        retry = null;
        const s = platform.createSocket!({ url: config.url });
        socket = s;
        s.on('open', () => {
            hello();
            flushBacklog();
        });
        s.on('message', (data) => {
            if (typeof data !== 'string') return;
            let q: DebugChannelQuery;
            try { q = JSON.parse(data) as DebugChannelQuery; } catch { return; }
            if (q.t === 'query') void answer(q);
        });
        s.on('close', () => {
            if (socket === s) socket = null;
            if (retry === null) retry = setTimeout(dial, RECONNECT_MS);
        });
        s.on('error', () => { /* a close follows, and it redials */ });
        s.connect();
    };

    dial();
    active = {
        attach(game) {
            app = game;
            nextFrame = appFrame(game);
            hello();
            flushBacklog();
            started();
        },
    };
}

/** Hand the running game to the channel {@link startDebugChannel} opened, so the
 *  editor can capture, profile and control it. */
export function attachDebugChannel(app: App): void {
    active?.attach(app);
}
