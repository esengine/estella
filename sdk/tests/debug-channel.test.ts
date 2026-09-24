// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A development build's channel opens before its engine does: what it
 *        printed meanwhile reaches the editor, and a question asked meanwhile is
 *        answered once the game starts rather than refused.
 */
import { describe, it, expect } from 'vitest';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter, PlatformSocket, PlatformSocketEvents } from '../src/platform/types';
import { startDebugChannel, attachDebugChannel, fitWithin } from '../src/runtime/debugChannel';
import type { App } from '../src/app/app';

function fakeSocket() {
    const handlers: { [K in keyof PlatformSocketEvents]?: Array<(...a: PlatformSocketEvents[K]) => void> } = {};
    const sent: unknown[] = [];
    const socket: PlatformSocket = {
        delivery: 'reliable-ordered',
        readyState: 'connecting',
        on(event, fn) { (handlers[event] ??= [] as never).push(fn as never); return () => {}; },
        connect() {},
        send(data) { sent.push(typeof data === 'string' ? JSON.parse(data) : data); },
        close() {},
    };
    const emit = <K extends keyof PlatformSocketEvents>(event: K, ...args: PlatformSocketEvents[K]): void => {
        for (const fn of handlers[event] ?? []) (fn as (...a: PlatformSocketEvents[K]) => void)(...args);
    };
    return { socket, sent, open: () => { socket.readyState = 'open'; emit('open'); }, receive: (m: unknown) => emit('message', JSON.stringify(m)) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the debug channel', () => {
    it('forwards what was printed before the editor listened, then answers a question asked before the game started', async () => {
        const s = fakeSocket();
        setPlatform({ name: 'web', now: () => performance.now(), createSocket: () => s.socket } as unknown as PlatformAdapter);
        startDebugChannel({ url: 'ws://editor:1/?token=t', project: 'Demo' });
        console.log('booting the engine');

        s.open();
        const logged = s.sent.filter((m) => (m as { t: string }).t === 'logs')
            .flatMap((m) => (m as { entries: Array<{ line: string }> }).entries.map((e) => e.line));
        expect(logged).toContain('booting the engine');
        expect(s.sent[0]).toMatchObject({ t: 'hello', project: 'Demo', revision: null });

        s.receive({ t: 'query', reqId: 7, kind: 'control', paused: true });
        await flush();
        expect(s.sent.some((m) => (m as { reqId?: number }).reqId === 7)).toBe(false);

        let paused = false;
        const app = {
            hasResource: () => false,
            onFrameEnd: () => () => {},
            setTargetFrameRate: () => {},
            setPaused: (p: boolean) => { paused = p; },
            isPaused: () => paused,
            getTargetFrameRate: () => 0,
        } as unknown as App;
        attachDebugChannel(app);
        await flush();
        expect(s.sent.find((m) => (m as { reqId?: number }).reqId === 7)).toEqual({ t: 'reply', reqId: 7, data: { paused: true, fps: 0 } });
    });
});

describe('a replay sent from a device', () => {
    // A mini-game socket moved a 2340x1080 replay in 55 s; the editor asks for what it shows.
    const image = (w: number, h: number) => {
        const pixels = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) pixels.set([i % 256, (i >> 8) % 256, 7, 255], i * 4);
        return { width: w, height: h, pixels, matchesCapture: true };
    };

    it('is scaled so its longer side fits, and says how big the whole one is', () => {
        const out = fitWithin(image(2340, 1080), 800);
        expect([out.width, out.height, out.fullWidth, out.fullHeight]).toEqual([800, 369, 2340, 1080]);
        expect(out.pixels.byteLength).toBe(800 * 369 * 4);
        // Nearest sampling: output column x reads source column floor(x / scale).
        const col = Math.floor(799 / (800 / 2340));
        const src = Array.from(image(2340, 1080).pixels.subarray(col * 4, (col + 1) * 4));
        expect(Array.from(out.pixels.subarray((800 - 1) * 4, 800 * 4))).toEqual(src);
    });

    it('is sent as it is when it already fits, or when no limit is asked', () => {
        const small = image(640, 360);
        expect(fitWithin(small, 800).pixels).toBe(small.pixels);
        expect(fitWithin(image(2340, 1080)).width).toBe(2340);
    });
});
