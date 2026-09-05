// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the candidate collector puts on the wire.
 *
 * History selects candidates; shadow × current world decides truth. So the
 * observation record is never the wire record: a component removed and re-added
 * between samples is one candidate holding both, and reduces to a field diff or
 * to silence. These cases are the ones where a collector that trusted the
 * tracker's history would send something the full-shadow one never did.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { defineComponent, clearUserComponents } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
import { defineSystem, Schedule, GetWorld } from '../src/ecs/system';
import type { ReliableOrderedTransport } from '../src/net/NetChannel';
import type { Entity } from '../src/types';

const STEP = 1 / 60;

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;
let Tag: ReturnType<typeof defineComponent<{ v: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
    Tag = defineComponent('NetTag', { v: 0 }, { replicatedFields: ['v'] });
});

const makeApp = (): App => { const a = App.new(); a.addPlugin(replicationPlugin); return a; };

/** Everything the server put on the wire, so "sent nothing" is assertable. */
function spy(inner: ReliableOrderedTransport) {
    const sent: string[] = [];
    return {
        sent,
        transport: {
            delivery: 'reliable-ordered' as const,
            send(d: string | ArrayBuffer) {
                sent.push(typeof d === 'string' ? d : `[binary:${d.byteLength}]`);
                inner.send(d);
            },
            on: (e: 'message', h: (d: string | ArrayBuffer) => void) => inner.on(e, h),
        } as ReliableOrderedTransport,
    };
}

async function connected() {
    const serverApp = makeApp();
    const clientApp = makeApp();
    const server = serverApp.getResource(Net).startServer();
    const [ta, tb] = MemoryTransport.pair();
    const seen = spy(ta);
    server.attachConnection(seen.transport);
    const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
    const step = async (n = 1) => {
        for (let i = 0; i < n; i++) { await serverApp.tick(STEP); await clientApp.tick(STEP); }
    };
    return { serverApp, clientApp, server, client, seen, step };
}

const removes = (sent: string[]): number => sent.filter((m) => m.includes('repl:crm')).length;
const deltas = (sent: string[]): number => sent.filter((m) => m.startsWith('[binary')).length;

function spawn(app: App, x: number): Entity {
    const e = app.world.spawn();
    app.world.insert(e, Replicated, { owner: 0 });
    app.world.insert(e, NetPos, { x, y: 0, z: 0 });
    return e;
}

const clientTag = (app: App): number | undefined => {
    for (const e of app.world.getEntitiesWithComponents([Replicated])) {
        const t = app.world.tryGet(e, Tag) as { v: number } | null;
        if (t) return t.v;
    }
    return undefined;
};

describe('the candidate collector reduces to final state', () => {
    it('A absent → add: the component arrives once, whole', async () => {
        const { serverApp, clientApp, seen, step } = await connected();
        const e = spawn(serverApp, 1);
        await step();
        seen.sent.length = 0;

        serverApp.world.insert(e, Tag, { v: 7 });
        await step();

        expect(clientTag(clientApp)).toBe(7);
        expect(removes(seen.sent)).toBe(0);
    });

    it('B present → remove: exactly one componentRemove', async () => {
        const { serverApp, clientApp, seen, step } = await connected();
        const e = spawn(serverApp, 1);
        serverApp.world.insert(e, Tag, { v: 7 });
        await step();
        seen.sent.length = 0;

        serverApp.world.remove(e, Tag);
        await step(2);

        expect(clientTag(clientApp)).toBeUndefined();
        expect(removes(seen.sent)).toBe(1);
    });

    it('C present → remove → add: no removal, only the value that differs', async () => {
        const { serverApp, clientApp, seen, step } = await connected();
        const e = spawn(serverApp, 1);
        serverApp.world.insert(e, Tag, { v: 7 });
        await step();
        seen.sent.length = 0;

        serverApp.world.remove(e, Tag);
        serverApp.world.insert(e, Tag, { v: 9 });
        await step();

        expect(removes(seen.sent)).toBe(0);
        expect(clientTag(clientApp)).toBe(9);
    });

    it('C2 present → remove → add with the SAME value: nothing at all', async () => {
        const { serverApp, seen, step } = await connected();
        const e = spawn(serverApp, 1);
        serverApp.world.insert(e, Tag, { v: 7 });
        await step();
        seen.sent.length = 0;

        serverApp.world.remove(e, Tag);
        serverApp.world.insert(e, Tag, { v: 7 });
        await step();

        expect(removes(seen.sent)).toBe(0);
        expect(deltas(seen.sent)).toBe(0);
    });

    it('D absent → add → remove: no wire operation', async () => {
        const { serverApp, seen, step } = await connected();
        const e = spawn(serverApp, 1);
        await step();
        seen.sent.length = 0;

        serverApp.world.insert(e, Tag, { v: 7 });
        serverApp.world.remove(e, Tag);
        await step();

        expect(removes(seen.sent)).toBe(0);
        expect(deltas(seen.sent)).toBe(0);
    });

    it('E remove → add → remove: exactly one componentRemove', async () => {
        const { serverApp, clientApp, seen, step } = await connected();
        const e = spawn(serverApp, 1);
        serverApp.world.insert(e, Tag, { v: 7 });
        await step();
        seen.sent.length = 0;

        serverApp.world.remove(e, Tag);
        serverApp.world.insert(e, Tag, { v: 8 });
        serverApp.world.remove(e, Tag);
        await step(2);

        expect(removes(seen.sent)).toBe(1);
        expect(clientTag(clientApp)).toBeUndefined();
    });

    it('field edits still replicate', async () => {
        const { serverApp, clientApp, step } = await connected();
        const e = spawn(serverApp, 1);
        await step();

        serverApp.world.set(e, NetPos, { x: 42, y: 0, z: 0 });
        await step(2);

        const xs = clientApp.world.getEntitiesWithComponents([Replicated])
            .map((g) => (clientApp.world.tryGet(g, NetPos) as { x: number } | null)?.x);
        expect(xs).toContain(42);
    });
});

describe('the observation window against the real clock', () => {
    it('sees BOTH fixed steps of one App frame', async () => {
        const { serverApp, clientApp, server, client } = await connected();
        const e = spawn(serverApp, 0);
        await serverApp.tick(STEP); await clientApp.tick(STEP);

        // worldTick advances once per APP frame; two fixed steps share it. A
        // floor at the current tick would drop the second step's write.
        let steps = 0;
        serverApp.addSystemToSchedule(Schedule.FixedUpdate, defineSystem(
            [GetWorld()],
            (world) => {
                if (steps >= 2) return;
                steps++;
                const p = world.get(e, NetPos) as { x: number };
                world.update(e, NetPos, (d: { x: number }) => { d.x = p.x + 1; });
            },
            { name: 'CandStep' },
        ));

        await serverApp.tick(STEP * 2);
        await clientApp.tick(STEP); await clientApp.tick(STEP);
        await serverApp.tick(STEP); await clientApp.tick(STEP);

        expect(steps).toBe(2);
        expect((serverApp.world.get(e, NetPos) as { x: number }).x).toBe(2);
        const xs = clientApp.world.getEntitiesWithComponents([Replicated])
            .map((g) => (clientApp.world.tryGet(g, NetPos) as { x: number } | null)?.x);
        expect(xs).toContain(2);
        expect(server.connectionCount).toBe(1);
        expect(client).toBeTruthy();
    });

    it('sees a write that lands AFTER the sample, on the next one', async () => {
        const { serverApp, clientApp, step } = await connected();
        const e = spawn(serverApp, 0);
        await step();

        // PostUpdate runs after FixedPostUpdate, where replication samples: this
        // write carries the tick the sample just closed.
        let once = true;
        serverApp.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [GetWorld()],
            (world) => {
                if (!once) return;
                once = false;
                world.update(e, NetPos, (d: { x: number }) => { d.x = 77; });
            },
            { name: 'CandLate' },
        ));

        await step(3);

        const xs = clientApp.world.getEntitiesWithComponents([Replicated])
            .map((g) => (clientApp.world.tryGet(g, NetPos) as { x: number } | null)?.x);
        expect(xs).toContain(77);
    });
});

describe('the server owns what it registered', () => {
    it('gives its removal claims back on stop, and does not stack them on restart', () => {
        const app = makeApp();
        const net = app.getResource(Net);
        const world = app.world;

        const before = world.removedReaderCount(NetPos);
        const server = net.startServer();
        void server.table;
        expect(world.removedReaderCount(NetPos)).toBe(before + 1);

        net.stop();
        expect(world.removedReaderCount(NetPos)).toBe(before);

        const again = net.startServer();
        void again.table;
        expect(world.removedReaderCount(NetPos)).toBe(before + 1);
        net.stop();
        net.stop();
        expect(world.removedReaderCount(NetPos)).toBe(before);
    });

    it('keeps removal history bounded while nobody is connected', async () => {
        const { serverApp, server, step } = await connected();
        const e = spawn(serverApp, 1);
        serverApp.world.insert(e, Tag, { v: 1 });
        await step();

        for (let id = 0; id < 8; id++) server.detachConnection(id);
        expect(server.connectionCount).toBe(0);

        // The world keeps losing components with nobody listening. Retention has
        // to follow the window, not the length of the quiet period.
        for (let i = 0; i < 30; i++) {
            const t = serverApp.world.spawn();
            serverApp.world.insert(t, Replicated, { owner: 0 });
            serverApp.world.insert(t, Tag, { v: i });
            serverApp.world.remove(t, Tag);
            await serverApp.tick(STEP);
        }

        expect(serverApp.world.getStorageSizes().changes.removedRows).toBeLessThan(10);
    });
});

describe('the registry runs on candidates too', () => {
    it('gives back its membership claim on dispose', () => {
        const app = makeApp();
        const net = app.getResource(Net);
        const world = app.world;
        const before = world.topologyReaderCount(Replicated);

        net.startServer();
        expect(world.topologyReaderCount(Replicated)).toBe(before + 1);

        net.stop();
        expect(world.topologyReaderCount(Replicated)).toBe(before);

        net.startServer();
        net.stop();
        net.stop();
        expect(world.topologyReaderCount(Replicated)).toBe(before);
    });

    it('does no full world scan in a steady-state sample', async () => {
        const { serverApp, server, step } = await connected();
        spawn(serverApp, 1);
        await step();

        // The baseline is behind us; from here the registry must run on the
        // membership journal alone. A helper that "just checks" with a full scan
        // is what this counts, whatever it is called.
        const baseline = server.fullScans;
        await step(5);
        expect(server.fullScans).toBe(baseline);
    });

    it('does exactly one when a client arrives to a quiet server', async () => {
        const { serverApp, server, step } = await connected();
        spawn(serverApp, 1);
        await step();
        for (let id = 0; id < 8; id++) server.detachConnection(id);
        const before = server.fullScans;

        const [sb, cb] = MemoryTransport.pair();
        server.attachConnection(sb);
        const appB = makeApp();
        await appB.getResource(Net).connect(cb, { interpolationDelayTicks: 0 });

        expect(server.fullScans).toBe(before + 1);
    });

    it('handles an entity slot reused by a new generation', async () => {
        const { serverApp, server, clientApp, step } = await connected();
        const world = serverApp.world;
        const old = spawn(serverApp, 1);
        await step();
        const oldNetId = server.netIds.netIdOf(old);
        expect(oldNetId).toBeGreaterThan(0);

        world.despawn(old);
        // Same slot, new generation: two DIFFERENT candidates in one window.
        const fresh = spawn(serverApp, 2);
        expect(fresh).not.toBe(old);
        expect(world.valid(old)).toBe(false);
        expect(world.valid(fresh)).toBe(true);

        await step(2);

        expect(server.netIds.entityOf(oldNetId!)).toBeUndefined();
        const freshNetId = server.netIds.netIdOf(fresh);
        expect(freshNetId).toBeGreaterThan(0);
        expect(freshNetId).not.toBe(oldNetId);
        expect(clientApp.world.getEntitiesWithComponents([Replicated]).length).toBe(1);
    });

    it('reconciles the registry BEFORE collecting fields, on the way out', async () => {
        const { serverApp, seen, step } = await connected();
        const world = serverApp.world;
        const e = spawn(serverApp, 1);
        world.insert(e, Tag, { v: 7 });
        await step();
        seen.sent.length = 0;

        // The registry drops the entity first, so the field pass never sees a
        // shadow to reconcile. The other order emits a componentRemove for an
        // entity the client is about to be told no longer exists.
        world.despawn(e);
        await step(2);

        expect(removes(seen.sent)).toBe(0);
    });

    it('reconciles the registry BEFORE collecting fields, on the way in', async () => {
        const { serverApp, clientApp, seen, step } = await connected();
        const world = serverApp.world;
        await step();
        seen.sent.length = 0;

        // Arrives and is written in the same window: the spawn payload carries
        // the current value, so the field pass must find nothing left to send.
        const e = world.spawn();
        world.insert(e, Replicated, { owner: 0 });
        world.insert(e, NetPos, { x: 5, y: 0, z: 0 });
        world.set(e, NetPos, { x: 6, y: 0, z: 0 });
        await step();

        expect(deltas(seen.sent)).toBe(0);
        const xs = clientApp.world.getEntitiesWithComponents([Replicated])
            .map((g) => (clientApp.world.tryGet(g, NetPos) as { x: number } | null)?.x);
        expect(xs).toContain(6);
    });
});
