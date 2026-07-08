// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  N1 transport base for replication: the NetChannel binary plane
 *        (1-byte channel id frames beside the JSON control plane), the
 *        MemoryTransport in-process pair, and the platform-adapter socket
 *        factory.
 */
import { describe, it, expect } from 'vitest';
import { NetChannel } from '../src/net/NetChannel';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { createSocket } from '../src/net';
import { setPlatform, isPlatformInitialized } from '../src/platform/base';
import type { PlatformAdapter, PlatformSocket } from '../src/platform/types';

function channelPair(): [NetChannel, NetChannel] {
    const [ta, tb] = MemoryTransport.pair();
    return [new NetChannel(ta), new NetChannel(tb)];
}

describe('NetChannel binary plane', () => {
    it('routes a binary frame by its channel id, payload intact', () => {
        const [a, b] = channelPair();
        const got: Uint8Array[] = [];
        b.onBinary(1, (p) => got.push(p.slice()));
        a.sendBinary(1, new Uint8Array([10, 20, 30]));
        expect(got).toHaveLength(1);
        expect([...got[0]]).toEqual([10, 20, 30]);
    });

    it('channels are isolated; unregistered channels drop silently', () => {
        const [a, b] = channelPair();
        const ch1: number[] = [];
        b.onBinary(1, (p) => ch1.push(p.byteLength));
        a.sendBinary(2, new Uint8Array([1, 2, 3]));
        a.sendBinary(1, new Uint8Array([9]));
        expect(ch1).toEqual([1]);
    });

    it('the JSON control plane and the binary plane share one transport', () => {
        const [a, b] = channelPair();
        const events: unknown[] = [];
        const frames: number[] = [];
        b.on('hello', (p) => events.push(p));
        b.onBinary(1, (p) => frames.push(p.byteLength));
        a.send('hello', { v: 1 });
        a.sendBinary(1, new Uint8Array(8));
        a.send('hello', { v: 2 });
        expect(events).toEqual([{ v: 1 }, { v: 2 }]);
        expect(frames).toEqual([8]);
    });

    it('an empty binary frame is ignored', () => {
        const [ta, tb] = MemoryTransport.pair();
        const b = new NetChannel(tb);
        let hits = 0;
        b.onBinary(0, () => hits++);
        ta.send(new ArrayBuffer(0));
        // channel 0 with empty payload still routes (1-byte frame = id only)
        const a = new NetChannel(ta);
        a.sendBinary(0, new Uint8Array(0));
        expect(hits).toBe(1);
    });

    it('dispose drops binary handlers', () => {
        const [a, b] = channelPair();
        let hits = 0;
        b.onBinary(1, () => hits++);
        b.dispose();
        a.sendBinary(1, new Uint8Array([1]));
        expect(hits).toBe(0);
    });
});

describe('MemoryTransport manual flush', () => {
    it('holds frames until flushed, delivers in send order with a limit', () => {
        const [ta, tb] = MemoryTransport.pair({ manualFlush: true });
        const got: string[] = [];
        tb.onMessage = (d) => got.push(d as string);
        ta.send('1'); ta.send('2'); ta.send('3');
        expect(got).toEqual([]);
        expect(ta.pendingCount).toBe(3);
        ta.flush(2);
        expect(got).toEqual(['1', '2']);
        ta.flush();
        expect(got).toEqual(['1', '2', '3']);
    });

    it('dropPending simulates packet loss', () => {
        const [ta, tb] = MemoryTransport.pair({ manualFlush: true });
        const got: string[] = [];
        tb.onMessage = (d) => got.push(d as string);
        ta.send('lost');
        ta.dropPending();
        ta.flush();
        expect(got).toEqual([]);
    });
});

describe('createSocket platform seam', () => {
    it('delegates to the platform adapter when one is set', () => {
        expect(isPlatformInitialized()).toBe(false);
        const marker = { readyState: 'closed' } as PlatformSocket;
        const urls: string[] = [];
        setPlatform({
            name: 'web',
            createSocket: (o) => { urls.push(o.url); return marker; },
        } as unknown as PlatformAdapter);
        expect(createSocket({ url: 'wss://x' })).toBe(marker);
        expect(urls).toEqual(['wss://x']);
    });

    it('fails loud on a platform without socket support', () => {
        setPlatform({ name: 'web' } as unknown as PlatformAdapter);
        expect(() => createSocket({ url: 'wss://x' })).toThrow(/no socket support/);
    });
});
