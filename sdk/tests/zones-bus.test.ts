// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Messages between server processes, and on to players.
 *
 * Three layers, each against what it is for: a game message between a client
 * and its server; a bus between processes (in memory, and over real sockets
 * through a hub that can restart); and zones that reach a player wherever
 * they are, kick them there, follow one who moved while a message travelled,
 * and tell every zone at once.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { App } from '../src/app/app';
import { clearUserComponents } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { GameSocket } from '../src/net/GameSocket';
import type { ReliableOrderedTransport } from '../src/net/NetChannel';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
import { MemoryStore, PlayerPersistence, type PersistStore } from '../src/persist';
import { ZoneHost, MemoryBus, BusHub, RemoteBus, type ZoneBus } from '../src/zones';

const STEP = 1 / 60;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(done: () => boolean, ms = 2000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (done()) return true; await delay(5); }
    return done();
}

beforeEach(() => clearUserComponents());

describe('game messages between a client and its server', () => {
    it('go both ways by type, only once the client has said hello', async () => {
        const serverApp = App.new();
        serverApp.addPlugin(replicationPlugin);
        const server = serverApp.getResource(Net).startServer();
        const heard: string[] = [];
        server.onMessage('chat', (id, data) => heard.push(`${id}:${(data as { text: string }).text}`));

        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [a, b] = MemoryTransport.pair();
        server.attachConnection(a);
        // Before the hello: nothing is heard, and the client will not send.
        b.send(JSON.stringify({ k: 'event', t: 'repl:msg', d: { type: 'chat', data: { text: 'early' } } }));
        const client = await app.getResource(Net).connect(b, { interpolationDelayTicks: 0 });
        await serverApp.tick(STEP);

        const got: unknown[] = [];
        client.onMessage('notice', (d) => got.push(d));
        expect(client.message('chat', { text: 'hi' })).toBe(true);
        expect(client.message('nobody-listens', 1)).toBe(true);
        expect(server.message(client.connectionId, 'notice', { n: 1 })).toBe(true);
        expect(server.broadcastMessage('notice', { n: 2 }, (id) => id !== client.connectionId)).toBe(0);
        expect(server.broadcastMessage('notice', { n: 3 })).toBe(1);
        await delay(5);
        expect(heard).toEqual([`${client.connectionId}:hi`]);
        expect(got).toEqual([{ n: 1 }, { n: 3 }]);
        expect(server.message(999, 'notice')).toBe(false);
        client.disconnect();
        expect(client.message('chat', { text: 'gone' })).toBe(false);
    });
});

describe('MemoryBus', () => {
    it('delivers later, as a copy, to every subscriber, until unsubscribed', async () => {
        const bus = new MemoryBus();
        const got: unknown[] = [];
        const off = bus.subscribe('t', (m) => got.push(m));
        bus.subscribe('t', (m) => got.push(['second', m]));
        const msg = { n: 1 };
        bus.publish('t', msg);
        msg.n = 2;
        expect(got).toEqual([]); // not inside the publisher's call
        await delay(0);
        expect(got).toEqual([{ n: 1 }, ['second', { n: 1 }]]);
        off();
        bus.publish('t', { n: 3 });
        await delay(0);
        expect(got).toHaveLength(3);
    });
});

describe('BusHub and RemoteBus over real sockets', () => {
    let wss: WebSocketServer;
    let hub: BusHub;
    let url: string;
    const buses: RemoteBus[] = [];

    async function startHub(port = 0) {
        hub = new BusHub();
        wss = new WebSocketServer({ port, host: '127.0.0.1' });
        await new Promise<void>((r) => wss.on('listening', () => r()));
        url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
        wss.on('connection', (s) => hub.accept(s));
    }
    const remote = () => {
        const bus = new RemoteBus({ connect: () => new GameSocket({ url }), minDelayMs: 20, maxDelayMs: 100 });
        buses.push(bus);
        return bus;
    };

    beforeEach(async () => { await startHub(); });
    afterEach(async () => {
        for (const b of buses.splice(0)) b.close();
        for (const c of wss.clients) c.terminate();
        await new Promise<void>((r) => wss.close(() => r()));
    });

    it('carries a publish to every process subscribed to the topic', async () => {
        const a = remote();
        const b = remote();
        const c = remote();
        const got: string[] = [];
        b.subscribe('zone:B', (m) => got.push(`b:${(m as { n: number }).n}`));
        c.subscribe('zones', (m) => got.push(`c:${(m as { n: number }).n}`));
        expect(await until(() => a.connected && b.connected && c.connected)).toBe(true);
        await delay(20);
        a.publish('zone:B', { n: 1 });
        a.publish('zones', { n: 2 });
        a.publish('zone:nobody', { n: 3 });
        expect(await until(() => got.length === 2)).toBe(true);
        expect(got.sort()).toEqual(['b:1', 'c:2']);
    });

    it('redials a hub that restarted and subscribes again', async () => {
        const a = remote();
        const b = remote();
        const got: number[] = [];
        b.subscribe('t', (m) => got.push((m as { n: number }).n));
        expect(await until(() => a.connected && b.connected)).toBe(true);
        const port = Number(new URL(url).port);
        for (const c of wss.clients) c.terminate();
        await new Promise<void>((r) => wss.close(() => r()));
        expect(await until(() => !a.connected && !b.connected)).toBe(true);
        a.publish('t', { n: 1 }); // lost: nobody to carry it
        await startHub(port);
        expect(await until(() => a.connected && b.connected, 3000)).toBe(true);
        await delay(30);
        a.publish('t', { n: 2 });
        expect(await until(() => got.length === 1)).toBe(true);
        expect(got).toEqual([2]);
    });
});

// ---------------------------------------------------------------------------
// Zones over a bus
// ---------------------------------------------------------------------------

const tokens = (c: unknown) => ({ playerId: (c as { token: string }).token });

async function zone(id: string, store: PersistStore, bus: ZoneBus) {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const records = new PlayerPersistence<{ n: number }>({ store, schema: 1, create: () => ({ n: 0 }) });
    const host = new ZoneHost({ zone: { id, address: `mem://${id}`, kind: 'map' }, store, bus, authenticate: tokens, players: records as PlayerPersistence<unknown> });
    const server = app.getResource(Net).startServer({ authenticate: host.authenticate, reconnectGraceMs: 0 });
    host.attach(server);
    await host.start();
    const tick = async () => { host.tick(); await app.tick(STEP); };
    return { app, server, host, records, tick };
}

/** A store whose every call takes a while: long enough to send into the middle of a transfer. */
function slow(inner: PersistStore, ms: number): PersistStore {
    const wait = () => new Promise((r) => setTimeout(r, ms));
    return {
        get: async (k) => { await wait(); return inner.get(k); },
        put: async (k, v, o) => { await wait(); return inner.put(k, v, o); },
        delete: async (k, o) => { await wait(); return inner.delete(k, o); },
        keys: async (p) => { await wait(); return inner.keys(p); },
    };
}

async function world(storeDelayMs = 0) {
    const store = storeDelayMs > 0 ? slow(new MemoryStore(), storeDelayMs) : new MemoryStore();
    const bus = new MemoryBus();
    const A = await zone('A', store, bus);
    const B = await zone('B', store, bus);
    const zones: Record<string, Awaited<ReturnType<typeof zone>>> = { 'mem://A': A, 'mem://B': B };
    const dial = (address: string): ReliableOrderedTransport => {
        const [a, b] = MemoryTransport.pair();
        zones[address]!.server.attachConnection(a);
        return b;
    };
    const join = async (token: string, at: Awaited<ReturnType<typeof zone>>) => {
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [a, b] = MemoryTransport.pair();
        at.server.attachConnection(a);
        const client = await app.getResource(Net).connect(b, { interpolationDelayTicks: 0, credentials: { token }, dial });
        const inbox: unknown[] = [];
        client.onMessage('whisper', (d) => inbox.push(d));
        return { app, client, inbox };
    };
    const run = async (n = 3) => {
        for (let i = 0; i < n; i++) { await A.tick(); await B.tick(); await delay(0); }
    };
    return { store, bus, A, B, join, run };
}

describe('zones over a bus', () => {
    it('reaches a player in another zone, and says when nobody is there', async () => {
        const { A, B, join, run } = await world();
        const ana = await join('ana', A);
        await run();
        expect(await B.host.sendToPlayer('ana', 'whisper', { from: 'bo', text: 'hi' })).toBe(true);
        expect(await A.host.sendToPlayer('ana', 'whisper', { from: 'cy', text: 'yo' })).toBe(true);
        expect(await until(() => ana.inbox.length === 2)).toBe(true);
        expect(ana.inbox).toContainEqual({ from: 'bo', text: 'hi' });
        expect(await B.host.sendToPlayer('nobody', 'whisper', {})).toBe(false);
    });

    it('kicks a player in another zone', async () => {
        const { A, B, join, run } = await world();
        const ana = await join('ana', A);
        await run();
        expect(await B.host.kickPlayer('ana', 'banned')).toBe(true);
        expect(await until(() => ana.client.state === 'closed')).toBe(true);
        expect(ana.client.closeReason).toBe('kicked');
    });

    it('tells every zone, and lets a zone handle a player message itself', async () => {
        const { A, B, join, run } = await world();
        const heard: string[] = [];
        A.host.onZoneMessage('event', (d, from) => heard.push(`A<-${from}:${d}`));
        B.host.onZoneMessage('event', (d, from) => heard.push(`B<-${from}:${d}`));
        A.host.broadcastZones('event', 'double-xp');
        expect(await until(() => heard.length === 2)).toBe(true);
        expect(heard.sort()).toEqual(['A<-A:double-xp', 'B<-A:double-xp']);

        const ana = await join('ana', A);
        await run();
        const filtered: string[] = [];
        A.host.onPlayerMessage('whisper', (pid, _id, d) => filtered.push(`${pid}:${(d as { text: string }).text}`));
        await B.host.sendToPlayer('ana', 'whisper', { text: 'kept by the zone' });
        expect(await until(() => filtered.length === 1)).toBe(true);
        expect(ana.inbox).toEqual([]);
    });

    it('follows a player who moved on while the message travelled', async () => {
        const { A, B, join, run } = await world();
        const ana = await join('ana', A);
        await run();
        // The message is aimed at A, and she is in B by the time it lands.
        await A.host.transfer(ana.client.connectionId, 'B');
        await run(4);
        expect(ana.client.state).toBe('ready');
        // Sent the way a zone that still believed she was in A would.
        (A.host as unknown as { options_: { bus: ZoneBus } }).options_.bus.publish('zone:A', { k: 'player', playerId: 'ana', type: 'whisper', data: { late: true }, hops: 0 });
        expect(await until(() => ana.inbox.length === 1)).toBe(true);
        expect(ana.inbox).toEqual([{ late: true }]);
        void Replicated;
    });

    it('delivers a message sent while the player is being transferred, once they arrive', async () => {
        const { A, B, join, run } = await world(15);
        const ana = await join('ana', A);
        await run();
        const moving = A.host.transfer(ana.client.connectionId, 'B');
        // Into the middle of it: she is leaving A and not yet in B.
        await delay(40);
        expect(await B.host.sendToPlayer('ana', 'whisper', { from: 'B' })).toBe(true);
        expect(await A.host.sendToPlayer('ana', 'whisper', { from: 'A' })).toBe(true);
        await moving;
        for (let i = 0; i < 40 && ana.inbox.length < 2; i++) await run(1);
        expect(ana.client.state).toBe('ready');
        expect(ana.inbox).toHaveLength(2);
        expect(ana.inbox).toContainEqual({ from: 'A' });
        expect(ana.inbox).toContainEqual({ from: 'B' });
    });
});
