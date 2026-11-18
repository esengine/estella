// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  esengine/zones: a world split over server processes.
 *
 * The parts first, each against the failure it exists for: a directory entry
 * that stops being refreshed is a zone that is gone; two zones racing for one
 * player cannot both hold them; a ticket works once, at its zone, in time.
 * Then two zones end to end (two server Apps over one shared store standing in
 * for two processes): a player transferred from one to the other arrives with
 * the record they left with, at the place the ticket says, seeing only the
 * new zone's world — and the zone they left neither holds nor writes them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import type { ReliableOrderedTransport } from '../src/net/NetChannel';
import { replicationPlugin, Net, Replicated, type ReplicationServer } from '../src/net/replication';
import { MemoryStore, PlayerPersistence, type PersistStore } from '../src/persist';
import {
    ZoneDirectory, PlayerLeases, LeaseHeld, TransferTickets, TicketRefused, ZoneHost,
} from '../src/zones';
import type { Entity } from '../src/types';

const STEP = 1 / 60;
let Spot: ReturnType<typeof defineComponent<{ x: number }>>;

beforeEach(() => {
    clearUserComponents();
    Spot = defineComponent('Spot', { x: 0 }, { replicatedFields: ['x'] });
});

describe('ZoneDirectory', () => {
    it('lists live zones, forgets quiet ones, and picks the one with most room', async () => {
        let clock = 0;
        const dir = new ZoneDirectory({ store: new MemoryStore(), ttlMs: 1000, now: () => clock });
        await dir.announce({ id: 'forest#1', address: 'ws://a', kind: 'forest', players: 90, capacity: 100 });
        await dir.announce({ id: 'forest#2', address: 'ws://b', kind: 'forest', players: 40, capacity: 100 });
        await dir.announce({ id: 'forest#3', address: 'ws://c', kind: 'forest', players: 100, capacity: 100 });
        await dir.announce({ id: 'town', address: 'ws://d', kind: 'town', players: 5 });
        expect((await dir.pick('forest'))!.id).toBe('forest#2');
        expect((await dir.list('forest')).map((z) => z.id).sort()).toEqual(['forest#1', 'forest#2', 'forest#3']);
        clock = 800;
        await dir.announce({ id: 'forest#1', address: 'ws://a', kind: 'forest', players: 10, capacity: 100 });
        clock = 1500;
        expect((await dir.list()).map((z) => z.id)).toEqual(['forest#1']);
        expect(await dir.get('town')).toBeNull();
        await dir.withdraw('forest#1');
        expect(await dir.pick('forest')).toBeNull();
    });
});

describe('PlayerLeases', () => {
    it('keeps a player in one zone, frees them on release or expiry, and hands them over', async () => {
        let clock = 0;
        const leases = new PlayerLeases({ store: new MemoryStore(), ttlMs: 1000, now: () => clock });
        await leases.acquire('ana', 'A');
        await leases.acquire('ana', 'A'); // the holder may take it again
        await expect(leases.acquire('ana', 'B')).rejects.toBeInstanceOf(LeaseHeld);
        await leases.handOff('ana', 'A', 'B');
        expect((await leases.get('ana'))!.zoneId).toBe('B');
        await expect(leases.handOff('ana', 'A', 'C')).rejects.toBeInstanceOf(LeaseHeld);
        expect(await leases.release('ana', 'A')).toBe(false);
        expect(await leases.release('ana', 'B')).toBe(true);
        await leases.acquire('ana', 'C');
        clock = 1001; // C crashed and stopped renewing
        await leases.acquire('ana', 'D');
        expect((await leases.get('ana'))!.zoneId).toBe('D');
    });

    it('lets exactly one of two racing zones win', async () => {
        const store = new MemoryStore();
        const a = new PlayerLeases({ store });
        const b = new PlayerLeases({ store });
        const results = await Promise.allSettled([a.acquire('ana', 'A'), b.acquire('ana', 'B')]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const holder = (await a.get('ana'))!.zoneId;
        const winner = results[0]!.status === 'fulfilled' ? 'A' : 'B';
        expect(holder).toBe(winner);
    });
});

describe('TransferTickets', () => {
    it('admits once, to its zone, before it expires', async () => {
        let clock = 0;
        const tickets = new TransferTickets({ store: new MemoryStore(), ttlMs: 1000, now: () => clock });
        const t = await tickets.issue({ playerId: 'ana', toZone: 'B', fromZone: 'A', arrival: { portal: 3 } });
        await expect(tickets.redeem(t, 'C')).rejects.toBeInstanceOf(TicketRefused);
        const t2 = await tickets.issue({ playerId: 'ana', toZone: 'B', fromZone: 'A', arrival: { portal: 3 } });
        expect(await tickets.redeem(t2, 'B')).toMatchObject({ playerId: 'ana', arrival: { portal: 3 } });
        await expect(tickets.redeem(t2, 'B')).rejects.toThrow('used');
        const t3 = await tickets.issue({ playerId: 'ana', toZone: 'B', fromZone: 'A', arrival: null });
        clock = 1001;
        await expect(tickets.redeem(t3, 'B')).rejects.toThrow('expired');
        await expect(tickets.redeem('../../etc', 'B')).rejects.toThrow('not a ticket');
    });
});

// ---------------------------------------------------------------------------
// Two zones end to end
// ---------------------------------------------------------------------------

interface Rec { gold: number }
const tokens = (c: unknown) => {
    const token = (c as { token?: string } | undefined)?.token;
    if (!token) throw new Error('no token');
    return { playerId: token };
};

/** One zone process: a server App, its ZoneHost and records, and the game's provisioning. */
async function bootZone(id: string, store: PersistStore, landmark: string, arrivalLeaseMs?: number) {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const records = new PlayerPersistence<Rec>({ store, schema: 1, create: () => ({ gold: 10 }) });
    const zone = new ZoneHost<{ x: number }>({
        zone: { id, address: `mem://${id}`, kind: 'map' }, store, authenticate: tokens,
        players: records as PlayerPersistence<unknown>, arrivalLeaseMs,
    });
    const server = app.getResource(Net).startServer({ authenticate: zone.authenticate, reconnectGraceMs: 0 });
    zone.attach(server);
    await zone.start();
    // Something only this zone has, so a client can tell which world it sees.
    const mark = app.world.spawn(landmark);
    app.world.insert(mark, Replicated, {});
    const pawns = new Map<string, Entity>();
    const tick = async () => {
        zone.tick();
        const present = new Map<string, number>();
        for (const cid of server.presentIds) present.set(server.playerIdOf(cid)!, cid);
        for (const [pid, pawn] of [...pawns]) {
            if (present.has(pid)) continue;
            app.world.despawn(pawn);
            pawns.delete(pid);
        }
        for (const [pid, cid] of present) {
            if (pawns.has(pid) || !records.isReady(pid)) continue;
            const pawn = app.world.spawn(`pawn ${pid}`);
            app.world.insert(pawn, Spot, { x: zone.takeArrival(pid)?.x ?? 0 });
            app.world.insert(pawn, Replicated, { owner: cid });
            pawns.set(pid, pawn);
        }
        await app.tick(STEP);
    };
    return { app, server, zone, records, pawns, tick };
}

type Zone = Awaited<ReturnType<typeof bootZone>>;

async function setupTwo(arrivalLeaseMs?: number) {
    const store = new MemoryStore();
    const A = await bootZone('A', store, 'forest tree', arrivalLeaseMs);
    const B = await bootZone('B', store, 'town well', arrivalLeaseMs);
    const zones: Record<string, Zone> = { 'mem://A': A, 'mem://B': B };
    /** A client's dial: an in-memory link to whichever zone the address names. */
    const dial = (address: string): ReliableOrderedTransport => {
        const target = zones[address];
        if (!target) throw new Error(`nothing at ${address}`); // a zone that died
        const [a, b] = MemoryTransport.pair();
        target.server.attachConnection(a);
        return b;
    };
    const client = async (token: string, at: Zone) => {
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [a, b] = MemoryTransport.pair();
        at.server.attachConnection(a);
        const c = await app.getResource(Net).connect(b, {
            interpolationDelayTicks: 0, credentials: { token }, dial, reconnect: { minDelayMs: 20, maxDelayMs: 40 },
        });
        return { app, client: c };
    };
    const run = async (apps: App[], n: number) => {
        for (let i = 0; i < n; i++) {
            await A.tick();
            await B.tick();
            for (const a of apps) await a.tick(STEP);
            await new Promise((r) => setTimeout(r, 0));
        }
    };
    return { store, A, B, client, run };
}

const names = (app: App) => app.world.getEntitiesWithComponents([Replicated])
    .map((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value ?? '').sort();

describe('two zones', () => {
    it('moves a player across with their record, to where the ticket says, into the new world only', async () => {
        const { A, B, client, run } = await setupTwo();
        const ana = await client('ana', A);
        await run([ana.app], 4);
        expect(names(ana.app)).toEqual(['forest tree', 'pawn ana']);
        A.records.set('ana', { gold: 77 });

        await A.zone.transfer(ana.client.connectionId, 'B', { x: 42 });
        await run([ana.app], 6);

        expect(ana.client.state).toBe('ready');
        expect(names(ana.app)).toEqual(['pawn ana', 'town well']);
        const pawn = ana.app.world.getEntitiesWithComponents([Replicated]).find((e) => ana.client.ownsEntity(e))!;
        expect((ana.app.world.tryGet(pawn, Spot) as { x: number }).x).toBe(42);
        expect(B.records.get('ana')).toEqual({ gold: 77 });
        expect(A.pawns.has('ana')).toBe(false);
        expect(A.server.presentIds).toEqual([]);
        expect((await B.zone.leases.get('ana'))!.zoneId).toBe('B');
    });

    it('turns away a login to another zone while one holds the player, and lets it through after', async () => {
        const { A, B, client, run } = await setupTwo();
        const ana = await client('ana', A);
        await run([ana.app], 3);
        await expect(client('ana', B)).rejects.toThrow('already in zone "A"');
        // She leaves A; once her record is written A lets the lease go.
        ana.client.disconnect();
        A.server.detachConnection(1);
        await run([], 4);
        const again = await client('ana', B);
        expect(again.client.state).toBe('ready');
    });

    it('refuses to send a player to a zone that is not up, and keeps them', async () => {
        const { A, client, run } = await setupTwo();
        const ana = await client('ana', A);
        await run([ana.app], 3);
        await expect(A.zone.transfer(ana.client.connectionId, 'nowhere')).rejects.toThrow('not up');
        await run([ana.app], 3);
        expect(ana.client.state).toBe('ready');
        expect(A.pawns.has('ana')).toBe(true);
        expect((await A.zone.leases.get('ana'))!.zoneId).toBe('A');
    });

    it('sends nobody to a zone it has not heard from lately', async () => {
        const { A, client, run, store } = await setupTwo();
        const ana = await client('ana', A);
        await run([ana.app], 3);
        // Listed, but its last heartbeat was 5 s ago: well inside the directory's
        // 15 s, well outside three 1 s heartbeats.
        await store.put('zone:C', { id: 'C', address: 'mem://C', players: 0, seenAt: Date.now() - 5000 });
        expect(await A.zone.directory.get('C')).not.toBeNull();
        await expect(A.zone.transfer(ana.client.connectionId, 'C')).rejects.toThrow('not up');
        expect(A.pawns.has('ana')).toBe(true);
    });

    it('a player sent to a zone that just died comes back by itself, record intact', async () => {
        const { A, client, run, store } = await setupTwo(150);
        const ana = await client('ana', A);
        await run([ana.app], 3);
        A.records.set('ana', { gold: 31 });
        // C announced a moment ago, and has died since.
        await store.put('zone:C', { id: 'C', address: 'mem://C', players: 0, seenAt: Date.now() });
        await A.zone.transfer(ana.client.connectionId, 'C');
        expect(ana.client.state).toBe('reconnecting');
        // Back at A once the 150 ms arrival lease runs out.
        const t0 = Date.now();
        for (let i = 0; i < 100 && !(ana.client.state === 'ready' && A.pawns.has('ana')); i++) {
            await run([ana.app], 1);
            await new Promise((r) => setTimeout(r, 10));
        }
        expect(ana.client.state).toBe('ready');
        expect(Date.now() - t0).toBeLessThan(1500);
        expect(names(ana.app)).toEqual(['forest tree', 'pawn ana']);
        expect(A.records.get('ana')).toEqual({ gold: 31 });
        expect((await A.zone.leases.get('ana'))!.zoneId).toBe('A');
    });

    it('a client with no dial is told where to go and stops', async () => {
        const { A, run } = await setupTwo();
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [a, b] = MemoryTransport.pair();
        A.server.attachConnection(a);
        const c = await app.getResource(Net).connect(b, { interpolationDelayTicks: 0, credentials: { token: 'bo' } });
        await run([app], 3);
        await A.zone.transfer(c.connectionId, 'B');
        expect(c.state).toBe('closed');
        expect(c.closeReason).toBe('transfer');
        expect(c.transferTarget!.address).toBe('mem://B');
    });

    it('stop() writes records, frees leases and leaves the directory', async () => {
        const { A, B, client, run, store } = await setupTwo();
        const ana = await client('ana', A);
        await run([ana.app], 3);
        A.records.set('ana', { gold: 5 });
        await A.zone.stop();
        expect(await A.zone.leases.get('ana')).toBeNull();
        expect(await B.zone.directory.get('A')).toBeNull();
        expect((await store.get<{ data: Rec }>('player:ana'))!.value.data.gold).toBe(5);
    });
});

/** Type-only: a server satisfies what ZoneHost asks of it. */
export type _ServerShape = ReplicationServer;
