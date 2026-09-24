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
import { getPlatform } from '../platform/base';
import type { PlatformSocket } from '../platform/types';
import type { NextFrame } from '../render/frameCapture';
import { captureFrameReport, replayFrameDraw } from '../render/frameDebugReport';
import { log } from '../util/logger';

export const DEBUG_CHANNEL_PROTOCOL = 1;

/** The editor's address as a development export writes it into the config. */
export interface DebugChannelConfig {
    /** `ws://<editor host>:<port>/?token=<token>` */
    url: string;
}

export type DebugChannelQuery =
    | { t: 'query'; reqId: number; kind: 'frameCapture' }
    | { t: 'query'; reqId: number; kind: 'frameReplay'; drawIndex: number };

/**
 * What a device sends. A replay's pixels follow their `reply` as the very next
 * frame, binary, rather than inside it: a 1080p pass is 8MB of RGBA, and text
 * would add a third to every byte of it.
 */
export type DebugChannelMessage =
    | { t: 'hello'; v: number; platform: string; title: string }
    | { t: 'reply'; reqId: number; data: unknown; pixels?: boolean }
    | { t: 'reply'; reqId: number; error: string };

const RECONNECT_MS = 3000;

/** Resolves once @p app has finished a frame and the task that drew it has run. */
function appFrame(app: App): NextFrame {
    return () => new Promise((resolve) => {
        const off = app.onFrameEnd(() => {
            off();
            setTimeout(resolve, 0);
        });
    });
}

/**
 * Keep a channel to the editor open for as long as @p app runs, dialling again
 * when it drops — the editor restarts far more often than a debug session ends.
 * Returns the disposer.
 */
export function openDebugChannel(app: App, config: DebugChannelConfig, title = ''): () => void {
    const platform = getPlatform();
    if (!platform.createSocket) {
        log.warn('debug', `this platform has no socket, so the editor cannot reach this build (${platform.name})`);
        return () => {};
    }
    const nextFrame = appFrame(app);
    let socket: PlatformSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const answer = async (s: PlatformSocket, q: DebugChannelQuery): Promise<void> => {
        const reply = (m: DebugChannelMessage): void => s.send(JSON.stringify(m));
        try {
            if (q.kind === 'frameCapture') {
                reply({ t: 'reply', reqId: q.reqId, data: await captureFrameReport(app, nextFrame) });
                return;
            }
            const image = await replayFrameDraw(app, q.drawIndex, nextFrame);
            if (!image) {
                reply({ t: 'reply', reqId: q.reqId, data: null });
                return;
            }
            const { pixels, ...rest } = image;
            reply({ t: 'reply', reqId: q.reqId, data: rest, pixels: true });
            s.send(pixels.buffer.byteLength === pixels.byteLength
                ? pixels.buffer as ArrayBuffer
                : pixels.slice().buffer as ArrayBuffer);
        } catch (e) {
            reply({ t: 'reply', reqId: q.reqId, error: e instanceof Error ? e.message : String(e) });
        }
    };

    const dial = (): void => {
        retry = null;
        if (closed) return;
        const s = platform.createSocket!({ url: config.url });
        socket = s;
        s.on('open', () => {
            const hello: DebugChannelMessage = { t: 'hello', v: DEBUG_CHANNEL_PROTOCOL, platform: platform.name, title };
            s.send(JSON.stringify(hello));
            log.info('debug', 'connected to the editor');
        });
        s.on('message', (data) => {
            if (typeof data !== 'string') return;
            let q: DebugChannelQuery;
            try { q = JSON.parse(data) as DebugChannelQuery; } catch { return; }
            if (q.t === 'query') void answer(s, q);
        });
        s.on('close', () => {
            if (socket === s) socket = null;
            if (!closed && retry === null) retry = setTimeout(dial, RECONNECT_MS);
        });
        s.on('error', () => { /* a close follows, and it redials */ });
        s.connect();
    };

    dial();
    return () => {
        closed = true;
        if (retry !== null) clearTimeout(retry);
        socket?.close();
        socket = null;
    };
}
