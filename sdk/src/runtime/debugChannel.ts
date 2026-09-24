// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    debugChannel.ts
 * @brief   A development build's line back to the editor that exported it, over
 *          which the editor's frame debugger captures the device's frames.
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
import { captureFrameReport, replayFrameDraw } from '../render/frameDebugReport';
import { log } from '../util/logger';
import { Assets } from '../asset/AssetPlugin';
import { frameStatsReport } from './frameStats';
import { worldSnapshot } from './worldSnapshot';
import { forwardConsole, type ConsoleLevel } from './consoleForward';

export const DEBUG_CHANNEL_PROTOCOL = 1;

/** The editor's address as a development export writes it into the config. */
export interface DebugChannelConfig {
    /** `ws://<editor host>:<port>/?token=<token>` */
    url: string;
    /** The project the build was made from, so the editor can tell a build of
     *  another project from one of the project it has open. */
    project?: string;
}

/** What `control` changes; each field absent leaves that setting alone. */
export interface DebugControl {
    paused?: boolean;
    /** Advance this many frames — a paused game included. */
    step?: number;
    /** A cap on the frame rate; 0 lifts it. */
    fps?: number;
}

export type DebugChannelQuery =
    | { t: 'query'; reqId: number; kind: 'frameCapture' }
    | { t: 'query'; reqId: number; kind: 'frameReplay'; drawIndex: number }
    | { t: 'query'; reqId: number; kind: 'stats' }
    | { t: 'query'; reqId: number; kind: 'snapshot'; selectedId: number | null; withTree: boolean }
    | ({ t: 'query'; reqId: number; kind: 'control' } & DebugControl);

/**
 * What a device sends. A replay's pixels follow their `reply` as the very next
 * frame, binary, rather than inside it: a 1080p pass is 8MB of RGBA, and text
 * would add a third to every byte of it.
 */
export type DebugChannelMessage =
    | { t: 'hello'; v: number; platform: string; title: string; project: string | null; revision: string | null }
    | { t: 'reply'; reqId: number; data: unknown; pixels?: boolean }
    | { t: 'reply'; reqId: number; error: string }
    | { t: 'log'; level: ConsoleLevel; line: string };

const RECONNECT_MS = 3000;
const START_WAIT_MS = 20_000;
/** Lines kept while no editor listens; the oldest go first, and how many is said. */
const LOG_BACKLOG = 200;

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
    const timed = <T>(work: () => T): T => {
        const t0 = platformNow();
        try { return work(); } finally { agentMs += platformNow() - t0; }
    };

    const backlog: Array<{ level: ConsoleLevel; line: string }> = [];
    let dropped = 0;
    const send = (m: DebugChannelMessage): void => {
        if (socket?.readyState === 'open') socket.send(JSON.stringify(m));
    };
    forwardConsole((level, line) => timed(() => {
        if (socket?.readyState === 'open') {
            send({ t: 'log', level, line });
            return;
        }
        if (backlog.length >= LOG_BACKLOG) { backlog.shift(); dropped++; }
        backlog.push({ level, line });
    }));
    const flushBacklog = (): void => {
        if (dropped > 0) send({ t: 'log', level: 'warn', line: `[debug] ${dropped} earlier line(s) are not shown: the editor was not listening yet` });
        for (const e of backlog) send({ t: 'log', ...e });
        backlog.length = 0;
        dropped = 0;
    };
    const hello = (): void => {
        const assets = app?.hasResource(Assets) ? app.getResource(Assets) : null;
        send({
            t: 'hello', v: DEBUG_CHANNEL_PROTOCOL, platform: platform.name, title: '',
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
            if (q.kind === 'frameCapture') {
                reply({ t: 'reply', reqId: q.reqId, data: await captureFrameReport(game, frame) });
                return;
            }
            if (q.kind === 'stats') {
                // Timings cost a little every frame, so they start when first asked for.
                if (!statsOn) {
                    game.enableStats();
                    game.onFrameEnd((dt) => { frameSum += dt; frames++; worstMs = Math.max(worstMs, dt); });
                    statsOn = true;
                }
                // The device's own frame time since the last ask: the editor's clock
                // runs on another machine and says nothing about this one.
                const report = timed(() => frameStatsReport(game));
                const span = { frames, frameMs: frames > 0 ? frameSum / frames : 0, worstMs, agentMs };
                frameSum = 0; frames = 0; worstMs = 0; agentMs = 0;
                reply({ t: 'reply', reqId: q.reqId, data: { ...report, ...span } });
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
            const image = await replayFrameDraw(game, q.drawIndex, frame);
            if (!image) {
                reply({ t: 'reply', reqId: q.reqId, data: null });
                return;
            }
            const { pixels, ...rest } = image;
            reply({ t: 'reply', reqId: q.reqId, data: rest, pixels: true });
            socket?.send(pixels.buffer.byteLength === pixels.byteLength
                ? pixels.buffer as ArrayBuffer
                : pixels.slice().buffer as ArrayBuffer);
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
            started();
        },
    };
}

/** Hand the running game to the channel {@link startDebugChannel} opened, so the
 *  editor can capture, profile and control it. */
export function attachDebugChannel(app: App): void {
    active?.attach(app);
}
