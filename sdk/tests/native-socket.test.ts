// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A native build's socket, over the host's `ws://` client: what is sent
 *        before it opens goes out when it does, and its close is the last word.
 */
import { describe, it, expect } from 'vitest';
import { NativeSocket } from '../src/platform/native/socket';
import type { NativeSocketBridge, NativeSocketEvent } from '../src/platform/native/bridge';

function host() {
    let fire: (e: NativeSocketEvent) => void = () => {};
    const sent: (string | ArrayBuffer)[] = [];
    const closed: Array<[number | undefined, string | undefined]> = [];
    const bridge: NativeSocketBridge = {
        open: (_url, onEvent) => {
            fire = onEvent;
            return { send: (d) => { sent.push(d); return true; }, close: (c, r) => { closed.push([c, r]); } };
        },
    };
    return { bridge, sent, closed, fire: (e: NativeSocketEvent) => fire(e) };
}

describe('a native socket', () => {
    it('holds what was sent before it opened, and sends it on open', () => {
        const h = host();
        const s = new NativeSocket('ws://editor:37420/?token=t', h.bridge);
        const seen: string[] = [];
        s.on('open', () => seen.push('open'));
        s.on('message', (d) => seen.push(`message ${String(d)}`));
        s.connect();
        s.send('hello');
        expect(h.sent).toEqual([]);
        h.fire({ type: 'open' });
        expect(h.sent).toEqual(['hello']);
        h.fire({ type: 'message', data: '{"t":"query"}' });
        expect(seen).toEqual(['open', 'message {"t":"query"}']);
        expect(s.readyState).toBe('open');
    });

    it('reports a refused dial as an error then a close, and can dial again', () => {
        const h = host();
        const s = new NativeSocket('ws://editor:1/', h.bridge);
        const seen: string[] = [];
        s.on('error', () => seen.push('error'));
        s.on('close', (code) => seen.push(`close ${code}`));
        s.connect();
        h.fire({ type: 'error', reason: 'could not connect to editor:1' });
        h.fire({ type: 'close', code: 1006, reason: 'connect failed' });
        expect(seen).toEqual(['error', 'close 1006']);
        expect(s.readyState).toBe('closed');
        s.connect();
        expect(s.readyState).toBe('connecting');
    });

    it('passes its close to the host', () => {
        const h = host();
        const s = new NativeSocket('ws://editor:1/', h.bridge);
        s.connect();
        h.fire({ type: 'open' });
        s.close(1000, 'bye');
        expect(h.closed).toEqual([[1000, 'bye']]);
    });
});
