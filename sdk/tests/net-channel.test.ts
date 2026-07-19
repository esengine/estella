// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { NetChannel, type NetTransport } from '../src/net/NetChannel';

type Frame = string | ArrayBuffer;

function stubTransport(sendTo?: (d: Frame) => void): NetTransport & {
    handlers: Set<(d: Frame) => void>;
    receive(d: Frame): void;
} {
    const handlers = new Set<(d: Frame) => void>();
    return {
        handlers,
        send: (d: Frame) => sendTo?.(d),
        on: (_event, handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        receive: (d: Frame) => { for (const h of [...handlers]) h(d); },
    };
}

/** A pair of in-memory transports wired to each other (a.send → b's handlers). */
function loopback(): [ReturnType<typeof stubTransport>, ReturnType<typeof stubTransport>] {
    const a = stubTransport((d) => b.receive(d));
    const b = stubTransport((d) => a.receive(d));
    return [a, b];
}

/** A transport that captures sent frames and lets the test inject incoming ones. */
function spyTransport(): ReturnType<typeof stubTransport> & { sent: string[] } {
    const sent: string[] = [];
    const t = stubTransport((d) => { if (typeof d === 'string') sent.push(d); });
    return Object.assign(t, { sent });
}

describe('NetChannel events', () => {
    it('delivers a typed event peer-to-peer', () => {
        const [ta, tb] = loopback();
        const a = new NetChannel(ta);
        const b = new NetChannel(tb);
        const got: unknown[] = [];
        b.on<{ x: number }>('ping', (p) => got.push(p));
        a.send('ping', { x: 7 });
        expect(got).toEqual([{ x: 7 }]);
    });

    it('unsubscribe stops delivery; other types unaffected', () => {
        const [ta, tb] = loopback();
        const a = new NetChannel(ta);
        const b = new NetChannel(tb);
        const hits: number[] = [];
        const off = b.on<number>('n', (p) => hits.push(p));
        a.send('n', 1);
        off();
        a.send('n', 2);
        expect(hits).toEqual([1]);
    });

    it('ignores malformed and binary frames', () => {
        const t = spyTransport();
        const ch = new NetChannel(t);
        const hits: unknown[] = [];
        ch.on('x', (p) => hits.push(p));
        t.receive('not json');
        t.receive(JSON.stringify({ no: 'kind' }));
        t.receive(new ArrayBuffer(4));
        t.receive(JSON.stringify({ k: 'event', t: 'x', d: 1 }));
        expect(hits).toEqual([1]);
    });
});

describe('NetChannel request/response', () => {
    it('resolves a request from the peer handler', async () => {
        const [ta, tb] = loopback();
        const client = new NetChannel(ta);
        const server = new NetChannel(tb);
        server.handle<{ a: number; b: number }, number>('sum', ({ a, b }) => a + b);
        await expect(client.request<number>('sum', { a: 2, b: 3 })).resolves.toBe(5);
    });

    it('awaits an async handler', async () => {
        const [ta, tb] = loopback();
        const client = new NetChannel(ta);
        const server = new NetChannel(tb);
        server.handle<string, string>('echo', async (s) => `echo:${s}`);
        await expect(client.request<string>('echo', 'hi')).resolves.toBe('echo:hi');
    });

    it('rejects when the handler throws (remote error propagates)', async () => {
        const [ta, tb] = loopback();
        const client = new NetChannel(ta);
        const server = new NetChannel(tb);
        server.handle('boom', () => { throw new Error('kaboom'); });
        await expect(client.request('boom', null)).rejects.toThrow('kaboom');
    });

    it('rejects when the peer has no handler for the type', async () => {
        const [ta, tb] = loopback();
        const client = new NetChannel(ta);
        new NetChannel(tb); // peer with no handlers
        await expect(client.request('missing', null)).rejects.toThrow(/no request handler/);
    });

    it('times out a request with no response', async () => {
        vi.useFakeTimers();
        try {
            const t = spyTransport(); // nothing ever responds
            const ch = new NetChannel(t, { requestTimeoutMs: 50 });
            const p = ch.request('hang', null);
            const assertion = expect(p).rejects.toThrow(/timed out/);
            await vi.advanceTimersByTimeAsync(60);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('dispose rejects in-flight requests', async () => {
        const t = spyTransport();
        const ch = new NetChannel(t, { requestTimeoutMs: 0 });
        const p = ch.request('x', null);
        ch.dispose();
        await expect(p).rejects.toThrow(/closed/);
    });

    it('concurrent requests resolve to their own responses', async () => {
        const [ta, tb] = loopback();
        const client = new NetChannel(ta);
        const server = new NetChannel(tb);
        server.handle<number, number>('double', (n) => n * 2);
        const [r1, r2, r3] = await Promise.all([
            client.request<number>('double', 1),
            client.request<number>('double', 2),
            client.request<number>('double', 3),
        ]);
        expect([r1, r2, r3]).toEqual([2, 4, 6]);
    });
});
