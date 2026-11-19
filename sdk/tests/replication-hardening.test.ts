// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a replication server does about a client that is not playing fair,
 *        or not there at all.
 *
 * The hostile client here does not use NetChannel: it writes raw frames into
 * the link, which is what someone attacking a server does. Each case is one way
 * a connection could cost the server without end — flooding it, sending frames
 * too big to parse, holding a slot without ever saying hello, saying hello
 * twice, going silent on a half-open link, reading too slowly — and what the
 * server does instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import type { ReliableOrderedTransport } from '../src/net/NetChannel';
import {
    replicationPlugin, Net, Replicated, webSocketTransport, ReplMsg, REPLICATION_PROTOCOL_VERSION,
    type ReplicationServerOptions,
} from '../src/net/replication';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => clearUserComponents());

function server(options: ReplicationServerOptions = {}) {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    return { app, server: app.getResource(Net).startServer(options) };
}

/** The server's end of a link, recording whether the server closed it. */
function closable(inner: ReliableOrderedTransport) {
    const state = { closed: null as null | { code?: number; reason?: string } };
    const transport: ReliableOrderedTransport = {
        delivery: 'reliable-ordered',
        send: (d) => inner.send(d),
        on: (e, h) => inner.on(e, h),
        close: (code, reason) => { state.closed = { code, reason }; },
    };
    return { transport, state };
}

/** A client that writes raw frames: no channel, no manners. */
function hostile(srv: ReturnType<typeof server>['server']) {
    const [a, b] = MemoryTransport.pair();
    const link = closable(a);
    const id = srv.attachConnection(link.transport);
    const received: string[] = [];
    b.on('message', (d) => { if (typeof d === 'string') received.push(d); });
    return {
        id, link, received,
        event: (t: string, d: unknown) => b.send(JSON.stringify({ k: 'event', t, d })),
        request: (id: number, t: string, d: unknown) => b.send(JSON.stringify({ k: 'req', t, id, d })),
        raw: (s: string) => b.send(s),
    };
}

const hello = { protocolVersion: REPLICATION_PROTOCOL_VERSION, abiHash: 'wrong', components: [] };

describe('a hostile client', () => {
    it('is kicked for flooding the server with messages', async () => {
        const { server: srv } = server({ limits: { messagesPerSecond: 50, burst: 50, maxViolationsPerMinute: 20 } });
        const h = hostile(srv);
        for (let i = 1; i <= 500; i++) h.event(ReplMsg.input, { seq: i, actions: {} });
        expect(srv.closedFor.abuse).toBe(1);
        expect(h.link.state.closed).not.toBeNull();
        expect(srv.connectionCount).toBe(0);
    });

    it('has a frame too big to parse dropped unread, and counted', async () => {
        const { server: srv } = server({ limits: { maxFrameBytes: 1024, maxViolationsPerMinute: 2 } });
        const h = hostile(srv);
        h.raw(JSON.stringify({ k: 'event', t: ReplMsg.input, d: { seq: 1, actions: { junk: 'x'.repeat(5000) } } }));
        expect(srv.inputOf(h.id)).toBeNull();
        expect(srv.connectionCount).toBe(1);
        for (let i = 0; i < 2; i++) h.raw('y'.repeat(5000));
        expect(srv.closedFor.abuse).toBe(1);
        expect(srv.connectionCount).toBe(0);
    });

    it('cannot hold a slot without saying hello', async () => {
        const { server: srv } = server({ helloTimeoutMs: 30 });
        const h = hostile(srv);
        expect(srv.connectionCount).toBe(1);
        await delay(60);
        expect(srv.connectionCount).toBe(0);
        expect(srv.closedFor.noHello).toBe(1);
        expect(h.link.state.closed!.reason).toBe('no hello');
    });

    it('cannot say hello twice', async () => {
        const { server: srv } = server();
        const h = hostile(srv);
        h.request(1, ReplMsg.hello, hello);
        h.request(2, ReplMsg.hello, hello);
        await delay(10);
        const answers = h.received.map((r) => JSON.parse(r)).filter((m) => m.k === 'res');
        expect(answers.find((m) => m.id === 2)!.d).toMatchObject({ ok: false, error: 'already said hello' });
    });

    it('is closed when it goes silent, and an authenticated player still gets their grace', async () => {
        const { server: srv } = server({
            heartbeat: { intervalMs: 10, timeoutMs: 60 },
            authenticate: (c) => ({ playerId: (c as { token: string }).token }),
        });
        // A real client says hello, then its link goes half-open: nothing more arrives.
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [a, b] = MemoryTransport.pair({ manualFlush: true });
        const link = closable(a);
        srv.attachConnection(link.transport);
        const connecting = app.getResource(Net).connect(b, { credentials: { token: 'ana' } });
        for (let i = 0; i < 10; i++) { b.flush(); a.flush(); await delay(1); }
        const client = await connecting;
        const id = client.connectionId;
        // From here the client's frames (its pongs) never arrive.
        await delay(120);
        a.flush();
        expect(srv.closedFor.silence).toBe(1);
        expect(link.state.closed!.reason).toBe('heartbeat timeout');
        expect(srv.clientIds).toEqual([]);
        expect(srv.presentIds).toEqual([id]);
    });

    it('is told the server is full, as something to try again', async () => {
        const { server: srv } = server({ maxConnections: 1 });
        const first = hostile(srv);
        first.request(1, ReplMsg.hello, hello);
        const second = hostile(srv);
        second.request(1, ReplMsg.hello, hello);
        await delay(10);
        const answer = second.received.map((r) => JSON.parse(r)).find((m) => m.k === 'res')!;
        expect(answer.d).toMatchObject({ ok: false, error: 'server full; try again shortly', fatal: false });
    });
});

describe('a client that reads too slowly', () => {
    it('is closed and detached instead of buffered for without end', async () => {
        // Defined before the server builds its replication table at the hello.
        const Hp = defineComponent('SlowHp', { hp: 0 }, { replicatedFields: ['hp'] });
        const { app, server: srv } = server();
        const sent: unknown[] = [];
        const closed: number[] = [];
        let backlog = 0;
        let listener: ((data: unknown, isBinary: boolean) => void) | null = null;
        const socket = {
            on: (_e: 'message', l: (data: unknown, isBinary: boolean) => void) => { listener = l; },
            send: (d: unknown) => { sent.push(d); },
            close: (code?: number) => { closed.push(code ?? 0); },
            get bufferedAmount() { return backlog; },
        };
        const transport = webSocketTransport(socket, { maxBufferedBytes: 1000 });
        const id = srv.attachConnection(transport);
        // A real hello through the fake socket.
        const { REPLICATION_PROTOCOL_VERSION: v } = await import('../src/net/replication');
        const { ABI_LAYOUT_HASH } = await import('../src/ecs/component.generated');
        const { tableSchemas } = await import('../src/net/replication');
        listener!(JSON.stringify({ k: 'req', t: ReplMsg.hello, id: 1, d: { protocolVersion: v, abiHash: ABI_LAYOUT_HASH, components: tableSchemas(srv.table) } }), false);
        await delay(5);
        expect(srv.clientIds).toEqual([id]);
        // Something to send every tick.
        const e = app.world.spawn('thing');
        app.world.insert(e, Hp, { hp: 1 });
        app.world.insert(e, Replicated, {});
        await app.tick(1 / 60);
        expect(closed).toEqual([]);
        backlog = 5000; // it stopped reading
        for (let i = 0; i < 3 && closed.length === 0; i++) {
            app.world.update(e, Hp, (d) => { (d as { hp: number }).hp = 2 + i; });
            await app.tick(1 / 60);
        }
        expect(closed).toEqual([1013]);
        expect(srv.connectionCount).toBe(0);
    });
});
