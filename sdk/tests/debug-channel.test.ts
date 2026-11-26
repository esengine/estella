// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A development build's channel opens before its engine does: what it
 *        printed meanwhile reaches the editor, and a question asked meanwhile is
 *        answered once the game starts rather than refused.
 */
import { describe, it, expect, vi } from 'vitest';
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
    return {
        socket, sent,
        open: () => { socket.readyState = 'open'; emit('open'); },
        disconnect: () => { socket.readyState = 'closed'; emit('close', 1000, ''); },
        receive: (m: unknown) => emit('message', JSON.stringify(m)),
    };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the debug channel', () => {
    it('keeps a late async reply on the connection that requested it', async () => {
        vi.resetModules();
        const base = await import('../src/platform/base');
        const channel = await import('../src/runtime/debugChannel');
        const old = fakeSocket(), next = fakeSocket();
        const openSocket = vi.fn().mockReturnValueOnce(old.socket).mockReturnValue(next.socket);
        base.setPlatform({ name: 'web', now: () => performance.now(), createSocket: openSocket } as unknown as PlatformAdapter);
        vi.useFakeTimers();
        try {
            channel.startDebugChannel({ url: 'ws://editor:1/?token=t' });
            let finish!: () => void;
            const stepFrames = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
            channel.attachDebugChannel({
                hasResource: () => false, onFrameEnd: () => () => {}, isPaused: () => false,
                getTargetFrameRate: () => 60, stepFrames,
            } as unknown as App);
            old.open();
            old.receive({ t: 'query', reqId: 1, kind: 'control', step: 1 });
            expect(stepFrames).toHaveBeenCalledTimes(1);
            old.disconnect();
            await vi.advanceTimersByTimeAsync(3000);
            next.open();
            next.receive({ t: 'query', reqId: 1, kind: 'control' });
            finish();
            await vi.advanceTimersByTimeAsync(0);
            expect(next.sent.filter(message => (message as { t: string }).t === 'reply'))
                .toEqual([{ t: 'reply', reqId: 1, data: { paused: false, fps: 60 } }]);
        } finally { vi.useRealTimers(); }
    });

    it('releases a boot wait when the requesting connection closes', async () => {
        vi.resetModules();
        const base = await import('../src/platform/base');
        const channel = await import('../src/runtime/debugChannel');
        const old = fakeSocket(), next = fakeSocket();
        const openSocket = vi.fn().mockReturnValueOnce(old.socket).mockReturnValue(next.socket);
        base.setPlatform({ name: 'web', now: () => performance.now(), createSocket: openSocket } as unknown as PlatformAdapter);
        vi.useFakeTimers();
        try {
            channel.startDebugChannel({ url: 'ws://editor:1/?token=t' });
            old.open();
            old.receive({ t: 'query', reqId: 1, kind: 'control', paused: true });
            old.disconnect();
            await vi.advanceTimersByTimeAsync(0);
            expect(vi.getTimerCount()).toBe(1);
            await vi.advanceTimersByTimeAsync(3000);
            next.open();
            const setPaused = vi.fn();
            channel.attachDebugChannel({
                hasResource: () => false, onFrameEnd: () => () => {}, setPaused, isPaused: () => false,
                getTargetFrameRate: () => 60,
            } as unknown as App);
            next.receive({ t: 'query', reqId: 1, kind: 'control' });
            await vi.advanceTimersByTimeAsync(0);
            expect(setPaused).not.toHaveBeenCalled();
            expect(next.sent.filter(message => (message as { t: string }).t === 'reply')).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it('forwards what was printed before the editor listened, then answers a question asked before the game started', async () => {
        const s = fakeSocket();
        setPlatform({
            name: 'web', now: () => performance.now(), createSocket: () => s.socket, deviceName: () => 'Chrome · Android',
        } as unknown as PlatformAdapter);
        startDebugChannel({ url: 'ws://editor:1/?token=t', project: 'Demo' });
        console.log('booting the engine');

        s.open();
        const logged = s.sent.filter((m) => (m as { t: string }).t === 'logs')
            .flatMap((m) => (m as { entries: Array<{ line: string }> }).entries.map((e) => e.line));
        expect(logged).toContain('booting the engine');
        expect(s.sent[0]).toMatchObject({ t: 'hello', title: 'Chrome · Android', project: 'Demo', revision: null });

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

describe('a build whose renderer cannot capture', () => {
    it('says so, rather than answering with nothing', async () => {
        vi.resetModules();
        const base = await import('../src/platform/base');
        const channel = await import('../src/runtime/debugChannel');
        const s = fakeSocket();
        base.setPlatform({ name: 'native', now: () => performance.now(), createSocket: () => s.socket } as unknown as PlatformAdapter);
        channel.startDebugChannel({ url: 'ws://editor:1/?token=t', project: 'Demo' });
        s.open();
        channel.attachDebugChannel({ hasResource: () => false, onFrameEnd: () => () => {}, wasmModule: null } as unknown as App);
        s.receive({ t: 'query', reqId: 12, kind: 'frameCapture' });
        await flush();
        expect(s.sent.find((m) => (m as { reqId?: number }).reqId === 12)).toMatchObject({ error: expect.stringMatching(/no frame capture/) });
    });
});

describe('a device asked about its content', () => {
    it('answers with the revision it runs and what update is staged', async () => {
        vi.resetModules();
        const base = await import('../src/platform/base');
        const channel = await import('../src/runtime/debugChannel');
        const { Assets } = await import('../src/asset/AssetPlugin');
        const s = fakeSocket();
        base.setPlatform({ name: 'web', now: () => performance.now(), createSocket: () => s.socket } as unknown as PlatformAdapter);
        channel.startDebugChannel({ url: 'ws://editor:1/?token=t', project: 'Demo' });
        s.open();
        const status = { revision: 'bfdfdde', persistedRevision: null, staged: { revision: '2c4bd22', assets: 1, bytes: 208 }, applying: false };
        channel.attachDebugChannel({
            hasResource: (r: unknown) => r === Assets,
            getResource: () => ({ updateStatus: () => status, getManifest: () => null }),
            onFrameEnd: () => () => {},
        } as unknown as App);
        s.receive({ t: 'query', reqId: 11, kind: 'updateStatus' });
        await flush();
        expect(s.sent.find((m) => (m as { reqId?: number }).reqId === 11)).toEqual({ t: 'reply', reqId: 11, data: status });
    });
});

describe('a device asked about its disk cache', () => {
    it('routes scans, previews, explicit cleanup and version retention through its Assets service', async () => {
        vi.resetModules();
        const base = await import('../src/platform/base');
        const channel = await import('../src/runtime/debugChannel');
        const { Assets } = await import('../src/asset/AssetPlugin');
        const s = fakeSocket();
        base.setPlatform({ name: 'wechat', now: () => performance.now(), createSocket: () => s.socket } as unknown as PlatformAdapter);
        channel.startDebugChannel({ url: 'ws://editor:1/?token=t', project: 'Demo' });
        s.open();
        const disk = vi.fn(async () => ({ capability: 'managed', usedBytes: 16 }));
        const clean = vi.fn(async () => ({ releaseBytes: 8 }));
        const retain = vi.fn(async () => ({ capability: 'managed', usedBytes: 16 }));
        channel.attachDebugChannel({ hasResource: (r: unknown) => r === Assets,
            getResource: () => ({ getManifest: () => null, diskCacheReport: disk, cleanDiskCache: clean, retainDiskCacheVersion: retain }),
            onFrameEnd: () => () => {},
        } as unknown as App);
        s.receive({ t: 'query', reqId: 31, kind: 'diskCache', rescan: true });
        s.receive({ t: 'query', reqId: 32, kind: 'cleanDiskCache', budgetBytes: 8 });
        s.receive({ t: 'query', reqId: 33, kind: 'cleanDiskCache', budgetBytes: 8, execute: true });
        s.receive({ t: 'query', reqId: 34, kind: 'retainDiskCacheVersion', revision: 'v1', retain: false });
        await flush();
        expect(disk).toHaveBeenCalledWith(true);
        expect(clean.mock.calls).toEqual([[8, false], [8, true]]);
        expect(retain).toHaveBeenCalledWith('v1', false);
        expect(s.sent.find((m) => (m as { reqId?: number }).reqId === 33)).toEqual({ t: 'reply', reqId: 33, data: { releaseBytes: 8 } });
    });
});

describe('what the channel costs a device', () => {
    it('comes with the step of the device clock, so a 0 below it reads as unmeasured', async () => {
        vi.resetModules();
        const base = await import('../src/platform/base');
        const channel = await import('../src/runtime/debugChannel');
        const { App } = await import('../src/app/app');
        const s = fakeSocket();
        // A browser that is not cross-origin isolated: performance.now() steps by 0.1 ms.
        const coarse = () => Math.floor(performance.now() * 10) / 10;
        base.setPlatform({ name: 'web', now: coarse, createSocket: () => s.socket } as unknown as PlatformAdapter);
        channel.startDebugChannel({ url: 'ws://editor:1/?token=t', project: 'Demo' });
        s.open();
        const app = App.new();
        channel.attachDebugChannel(app);
        s.receive({ t: 'query', reqId: 21, kind: 'stats' });
        await flush();
        const reply = s.sent.find((m) => (m as { reqId?: number }).reqId === 21) as { data: { clockMs: number } };
        expect(reply.data.clockMs).toBeCloseTo(0.1, 5);
        app.quit();
    });
});

describe('a device in the background', () => {
    it('refuses a capture at once instead of waiting for a frame it will not draw', async () => {
        // The channel is one per process; this device needs its own.
        vi.resetModules();
        const base = await import('../src/platform/base');
        const channel = await import('../src/runtime/debugChannel');
        const { Lifecycle } = await import('../src/ecs/lifecycle');
        const s = fakeSocket();
        base.setPlatform({ name: 'web', now: () => performance.now(), createSocket: () => s.socket } as unknown as PlatformAdapter);
        channel.startDebugChannel({ url: 'ws://editor:1/?token=t', project: 'Demo' });
        s.open();
        channel.attachDebugChannel({
            hasResource: (r: unknown) => r === Lifecycle,
            getResource: () => ({ visible: false }),
            onFrameEnd: () => () => {},
        } as unknown as App);
        s.receive({ t: 'query', reqId: 9, kind: 'frameCapture' });
        await flush();
        expect(s.sent.find((m) => (m as { reqId?: number }).reqId === 9)).toMatchObject({ error: expect.stringMatching(/background/) });
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
