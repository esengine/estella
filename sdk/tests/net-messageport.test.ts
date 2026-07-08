// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  MessagePortTransport: both NetChannel planes over a real
 *        MessageChannel (the editor multiplayer-preview transport between
 *        play realms). Ports deliver asynchronously, unlike MemoryTransport.
 */
import { describe, it, expect } from 'vitest';
import { NetChannel } from '../src/net/NetChannel';
import { MessagePortTransport } from '../src/net/MessagePortTransport';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('MessagePortTransport', () => {
    it('carries the JSON control plane and RPC across a MessageChannel', async () => {
        const { port1, port2 } = new MessageChannel();
        const a = new NetChannel(new MessagePortTransport(port1));
        const b = new NetChannel(new MessagePortTransport(port2));

        const got: unknown[] = [];
        b.on('ping', (p) => got.push(p));
        b.handle('sum', (req) => (req as number[]).reduce((s, n) => s + n, 0));

        a.send('ping', { hello: '世界' });
        const sum = await a.request<number>('sum', [1, 2, 3]);
        await settle();

        expect(got).toEqual([{ hello: '世界' }]);
        expect(sum).toBe(6);
        port1.close();
    });

    it('carries binary frames with channel routing intact', async () => {
        const { port1, port2 } = new MessageChannel();
        const a = new NetChannel(new MessagePortTransport(port1));
        const b = new NetChannel(new MessagePortTransport(port2));

        const frames: number[][] = [];
        b.onBinary(1, (p) => frames.push([...p]));
        a.sendBinary(1, new Uint8Array([7, 8, 9]));
        a.sendBinary(2, new Uint8Array([0])); // unregistered channel drops
        await settle();

        expect(frames).toEqual([[7, 8, 9]]);
        port1.close();
    });
});
