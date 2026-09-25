// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mini-game socket whose dial is refused says it closed, once: on a
 *        WeChat phone the host reports only the error, and a caller that
 *        redials on close stopped trying after the first refusal.
 */
import { describe, it, expect } from 'vitest';
import { MiniGameSocket } from '../src/net/MiniGameSocket';
import type { MiniGameGlobal } from '../src/platform/minigame/api';

function host() {
    const tasks: Array<{ open(): void; error(e: unknown): void; close(code: number): void }> = [];
    const g = {
        connectSocket: () => {
            const h: Record<string, (x?: unknown) => void> = {};
            const task = {
                onOpen: (f: () => void) => { h.open = f; },
                onMessage: () => {},
                onClose: (f: (x: unknown) => void) => { h.close = f; },
                onError: (f: (x: unknown) => void) => { h.error = f; },
                send: () => {}, close: () => {},
            };
            tasks.push({ open: () => h.open(), error: (e) => h.error(e), close: (code) => h.close({ code, reason: '' }) });
            return task;
        },
    } as unknown as MiniGameGlobal;
    return { g, tasks };
}

describe('a mini-game socket', () => {
    it('closes when its dial is refused with an error alone, as a WeChat phone does', () => {
        const { g, tasks } = host();
        const s = new MiniGameSocket({ url: 'ws://192.168.31.243:37999/' }, g);
        const closes: number[] = [];
        s.on('close', (code) => closes.push(code));
        s.connect();
        tasks[0].error({ errCode: 1004, errMsg: 'open fail: _code:111,_msg:Connection refused' });
        expect(closes).toEqual([1006]);
        expect(s.readyState).toBe('closed');
        // Closed, so it can dial again.
        s.connect();
        expect(tasks).toHaveLength(2);
    });

    it('says so once when the host reports the error and then the close', () => {
        const { g, tasks } = host();
        const s = new MiniGameSocket({ url: 'ws://h/' }, g);
        const closes: number[] = [];
        s.on('close', (code) => closes.push(code));
        s.connect();
        tasks[0].error({ errMsg: 'refused' });
        tasks[0].close(1006);
        expect(closes).toEqual([1006]);
    });

    it('waits for the close after an error on an open socket', () => {
        const { g, tasks } = host();
        const s = new MiniGameSocket({ url: 'ws://h/' }, g);
        const closes: number[] = [];
        s.on('close', (code) => closes.push(code));
        s.connect();
        tasks[0].open();
        tasks[0].error({ errMsg: 'reset' });
        expect(closes).toEqual([]);
        tasks[0].close(1006);
        expect(closes).toEqual([1006]);
    });
});
