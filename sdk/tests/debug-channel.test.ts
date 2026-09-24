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
import { startDebugChannel, attachDebugChannel } from '../src/runtime/debugChannel';
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
        setPlatform({ name: 'web', createSocket: () => s.socket } as unknown as PlatformAdapter);
        startDebugChannel({ url: 'ws://editor:1/?token=t', project: 'Demo' });
        console.log('booting the engine');

        s.open();
        const logged = s.sent.filter((m) => (m as { t: string }).t === 'log').map((m) => (m as { line: string }).line);
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
