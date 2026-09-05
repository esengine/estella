// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What happens to a connection whose transport refuses a frame.
 *
 * Replication keeps ONE server-global shadow and no replay log, so a connection
 * that misses an authoritative frame can never be brought back into step: the
 * next sample diffs S1→S2 against a client still holding S0. Logging and
 * carrying on leaves a participant whose baseline is unrecoverable, and the
 * warning makes it look handled.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, radiusInterest } from '../src/net/replication';
import type { ReliableOrderedTransport } from '../src/net/NetChannel';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';

const STEP = 1 / 60;

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;
let Tag: ReturnType<typeof defineComponent<{ v: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
    Tag = defineComponent('NetTag', { v: 0 }, { replicatedFields: ['v'] });
});

const makeApp = (): App => { const a = App.new(); a.addPlugin(replicationPlugin); return a; };

/** A transport that refuses the frames `reject` picks, and counts the rest. */
function breakable(inner: ReliableOrderedTransport) {
    const state = { reject: (_d: string | ArrayBuffer) => false, delivered: 0 };
    return {
        state,
        transport: {
            delivery: 'reliable-ordered' as const,
            send(d: string | ArrayBuffer) {
                if (state.reject(d)) throw new Error('transport refused the frame');
                state.delivered++;
                inner.send(d);
            },
            on: (e: 'message', h: (d: string | ArrayBuffer) => void) => inner.on(e, h),
        } as ReliableOrderedTransport,
    };
}

const isBinary = (d: string | ArrayBuffer): boolean => typeof d !== 'string';
const isRemove = (d: string | ArrayBuffer): boolean => typeof d === 'string' && d.includes('repl:crm');
const isSpawn = (d: string | ArrayBuffer): boolean => typeof d === 'string' && d.includes('repl:spawn');

function spawn(app: App, x: number): Entity {
    const e = app.world.spawn();
    app.world.insert(e, Replicated, { owner: 0 });
    app.world.insert(e, NetPos, { x, y: 0, z: 0 });
    return e;
}

const posOf = (world: World, e: Entity): { x: number; y: number; z: number } | null => {
    const p = world.tryGet(e, NetPos) as { x: number; y: number; z: number } | null;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
};

async function serverWith(n: number) {
    const serverApp = makeApp();
    const server = serverApp.getResource(Net).startServer();
    const conns: { clientApp: App; link: ReturnType<typeof breakable>; id: number }[] = [];
    for (let i = 0; i < n; i++) {
        const clientApp = makeApp();
        const [ta, tb] = MemoryTransport.pair();
        const link = breakable(ta);
        const id = server.attachConnection(link.transport);
        await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        conns.push({ clientApp, link, id });
    }
    const step = async (k = 1) => {
        for (let i = 0; i < k; i++) {
            await serverApp.tick(STEP);
            for (const c of conns) await c.clientApp.tick(STEP);
        }
    };
    return { serverApp, server, conns, step };
}

describe('a transport that refuses a frame', () => {
    it('A takes only that connection down, and the others keep their stream', async () => {
        const { serverApp, server, conns, step } = await serverWith(2);
        const e = spawn(serverApp, 1);
        await step();
        expect(server.connectionCount).toBe(2);

        conns[1].link.state.reject = isBinary;
        serverApp.world.set(e, NetPos, { x: 42, y: 0, z: 0 });
        await step(2);

        expect(server.connectionCount).toBe(1);
        const xs = conns[0].clientApp.world.getEntitiesWithComponents([Replicated])
            .map((g) => (conns[0].clientApp.world.tryGet(g, NetPos) as { x: number } | null)?.x);
        expect(xs).toContain(42);
    });

    it('B is fatal on the control plane too, not just on delta frames', async () => {
        const { serverApp, server, conns, step } = await serverWith(2);
        const e = spawn(serverApp, 1);
        serverApp.world.insert(e, Tag, { v: 1 });
        await step();

        conns[1].link.state.reject = isRemove;
        serverApp.world.remove(e, Tag);
        await step(2);

        expect(server.connectionCount).toBe(1);
    });

    it('C has no partial-batch recovery: a failed frame mid-batch ends the connection', async () => {
        const { serverApp, server, conns, step } = await serverWith(2);
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));
        const near = spawn(serverApp, 10);
        await step();

        // Its spawn frame landed; the delta that follows will not.
        conns[1].link.state.reject = isBinary;
        serverApp.world.set(near, NetPos, { x: 20, y: 0, z: 0 });
        await step(2);

        expect(server.connectionCount).toBe(1);
    });

    it('D survives every connection failing, and the next client gets the world as it is', async () => {
        const { serverApp, server, conns, step } = await serverWith(2);
        const e = spawn(serverApp, 1);
        await step();

        for (const c of conns) c.link.state.reject = () => true;
        serverApp.world.set(e, NetPos, { x: 7, y: 0, z: 0 });
        await step(2);
        expect(server.connectionCount).toBe(0);

        // The world moves on with nobody listening; retention must not grow.
        for (let i = 0; i < 20; i++) {
            const t = serverApp.world.spawn();
            serverApp.world.insert(t, Replicated, { owner: 0 });
            serverApp.world.despawn(t);
            await serverApp.tick(STEP);
        }
        expect(serverApp.world.getStorageSizes().changes.removedRows).toBeLessThan(10);

        const appC = makeApp();
        const [sc, cc] = MemoryTransport.pair();
        server.attachConnection(sc);
        await appC.getResource(Net).connect(cc, { interpolationDelayTicks: 0 });
        await appC.tick(STEP);

        const xs = appC.world.getEntitiesWithComponents([Replicated])
            .map((g) => (appC.world.tryGet(g, NetPos) as { x: number } | null)?.x);
        expect(xs).toEqual([7]);
    });

    it('E refuses to half-complete a handshake whose initial state could not be sent', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        spawn(serverApp, 1);
        await serverApp.tick(STEP);

        const clientApp = makeApp();
        const [ta, tb] = MemoryTransport.pair();
        const link = breakable(ta);
        link.state.reject = isSpawn;
        server.attachConnection(link.transport);
        await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        await serverApp.tick(STEP);

        // Neither ready nor lingering: a connection that never got the world
        // cannot be a participant in the next delta.
        expect(server.connectionCount).toBe(0);
    });
});
