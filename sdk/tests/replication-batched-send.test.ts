// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A replication sample sends each client in one write.
 *
 * A sample sends a client several frames (spawns, the delta, the input ack).
 * One socket write each was nearly half of what a 300-player authority spent
 * (tools/net-capacity-benchmark.mjs), so the server holds every transport that
 * can hold writes for the length of a sample and lets them go together. These
 * pin both halves: the server opens and releases exactly one batch per
 * connection per sample, around every frame it sends, even when gameplay data
 * makes the sample throw; and the `ws` adapter turns a batch into cork/uncork
 * on the socket underneath.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import type { ReliableOrderedTransport } from '../src/net/NetChannel';
import { replicationPlugin, Net, Replicated, webSocketTransport } from '../src/net/replication';

const STEP = 1 / 60;
let NetHp: ReturnType<typeof defineComponent<{ hp: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetHp = defineComponent('NetHp', { hp: 100 }, { replicatedFields: ['hp'] });
});

/** A transport that records whether each send happened inside a batch. */
function recording(inner: ReliableOrderedTransport) {
    const log: string[] = [];
    let open = 0;
    const transport: ReliableOrderedTransport = {
        delivery: 'reliable-ordered',
        send: (d) => { log.push(open > 0 ? 'held' : 'loose'); inner.send(d); },
        on: (e, h) => inner.on(e, h),
        batch: () => {
            open++;
            log.push('open');
            return () => { open--; log.push('release'); };
        },
    };
    return { transport, log };
}

async function connected() {
    const serverApp = App.new();
    serverApp.addPlugin(replicationPlugin);
    const server = serverApp.getResource(Net).startServer();
    const clientApp = App.new();
    clientApp.addPlugin(replicationPlugin);
    const [a, b] = MemoryTransport.pair();
    const rec = recording(a);
    server.attachConnection(rec.transport);
    await clientApp.getResource(Net).connect(b, { interpolationDelayTicks: 0 });
    return { serverApp, clientApp, rec };
}

describe('the replication server batches each sample', () => {
    it('sends every frame of a sample inside one batch per connection', async () => {
        const { serverApp, rec } = await connected();
        await serverApp.tick(STEP);
        const e = serverApp.world.spawn('unit');
        serverApp.world.insert(e, NetHp, { hp: 5 });
        serverApp.world.insert(e, Replicated, {});
        rec.log.length = 0;

        await serverApp.tick(STEP); // spawn
        serverApp.world.update(e, NetHp, (d) => { (d as { hp: number }).hp = 4; });
        await serverApp.tick(STEP); // delta

        const opens = rec.log.filter((x) => x === 'open').length;
        expect(opens).toBe(2);
        expect(rec.log.filter((x) => x === 'release').length).toBe(2);
        expect(rec.log).not.toContain('loose');
        expect(rec.log.filter((x) => x === 'held').length).toBeGreaterThanOrEqual(2);
    });

    it('still reaches the client unchanged', async () => {
        const { serverApp, clientApp } = await connected();
        const e = serverApp.world.spawn('unit');
        serverApp.world.insert(e, NetHp, { hp: 7 });
        serverApp.world.insert(e, Replicated, {});
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const ghosts = clientApp.world.getEntitiesWithComponents([Replicated]);
        expect(ghosts).toHaveLength(1);
        expect((clientApp.world.tryGet(ghosts[0], NetHp) as { hp: number }).hp).toBe(7);
    });

    it('releases the batch when the sample throws', async () => {
        const { serverApp, rec } = await connected();
        const server = serverApp.getResource(Net).server!;
        const original = (server as unknown as { sampleConnected_: (t: number) => void }).sampleConnected_;
        (server as unknown as { sampleConnected_: (t: number) => void }).sampleConnected_ = () => { throw new Error('boom'); };
        rec.log.length = 0;
        expect(() => server.sample(1)).toThrow('boom');
        expect(rec.log).toEqual(['open', 'release']);
        (server as unknown as { sampleConnected_: (t: number) => void }).sampleConnected_ = original;
    });
});

describe('webSocketTransport', () => {
    function fakeSocket(withStream: boolean) {
        const calls: string[] = [];
        let listener: ((data: unknown, isBinary: boolean) => void) | null = null;
        const socket = {
            on: (_e: 'message', l: (data: unknown, isBinary: boolean) => void) => { listener = l; },
            send: () => { calls.push('send'); },
            _socket: withStream ? { cork: () => calls.push('cork'), uncork: () => calls.push('uncork') } : undefined,
        };
        return { socket, calls, deliver: (d: unknown, bin: boolean) => listener!(d, bin) };
    }

    it('holds the socket for the length of a batch', () => {
        const { socket, calls } = fakeSocket(true);
        const t = webSocketTransport(socket);
        const release = t.batch!();
        t.send('a');
        t.send(new ArrayBuffer(4));
        release();
        release(); // a second release must not uncork someone else's hold
        expect(calls).toEqual(['cork', 'send', 'send', 'uncork']);
    });

    it('sends as before on a socket with nothing to hold', () => {
        const { socket, calls } = fakeSocket(false);
        const t = webSocketTransport(socket);
        const release = t.batch!();
        t.send('a');
        release();
        expect(calls).toEqual(['send']);
    });

    it('hands binary frames over as exactly their bytes', () => {
        const { socket, deliver } = fakeSocket(true);
        const t = webSocketTransport(socket);
        const got: (string | ArrayBuffer)[] = [];
        t.on('message', (d) => got.push(d));
        const pool = new Uint8Array([9, 9, 1, 2, 3, 9]);
        deliver(pool.subarray(2, 5), true);
        deliver([new Uint8Array([4]), new Uint8Array([5, 6])], true);
        deliver('text', false);
        expect([...new Uint8Array(got[0] as ArrayBuffer)]).toEqual([1, 2, 3]);
        expect([...new Uint8Array(got[1] as ArrayBuffer)]).toEqual([4, 5, 6]);
        expect(got[2]).toBe('text');
    });
});
