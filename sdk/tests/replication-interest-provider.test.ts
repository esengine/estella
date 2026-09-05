// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Interest as prepare-once/query-many.
 *
 * A policy is handed the population per connection, so whatever it reads it
 * reads C times. A provider prepares one snapshot per sample and answers every
 * connection from it. The two cost fixtures here — a position read once per
 * entity, and one prepare per sample rather than one per connection — are the
 * reason the shape exists, so they are contracts rather than benchmark notes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import {
    replicationPlugin, Net, Replicated, radiusInterest, radiusInterestProvider,
    type InterestProvider, type PreparedInterest,
} from '../src/net/replication';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';

const STEP = 1 / 60;
let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
});

const makeApp = (): App => { const a = App.new(); a.addPlugin(replicationPlugin); return a; };
const posOf = (world: World, e: Entity): { x: number; y: number; z: number } | null => {
    const p = world.tryGet(e, NetPos) as { x: number; y: number; z: number } | null;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
};
const ghosts = (app: App): string[] =>
    app.world.getEntitiesWithComponents([Replicated])
        .map((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value ?? '')
        .sort();

async function serverWith(connections: number) {
    const serverApp = makeApp();
    const server = serverApp.getResource(Net).startServer();
    const clients: { app: App; id: number }[] = [];
    for (let i = 0; i < connections; i++) {
        const app = makeApp();
        const [ta, tb] = MemoryTransport.pair();
        const id = server.attachConnection(ta);
        await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        clients.push({ app, id });
    }
    const step = async (n = 1) => {
        for (let i = 0; i < n; i++) {
            await serverApp.tick(STEP);
            for (const c of clients) await c.app.tick(STEP);
        }
    };
    const place = (name: string, x: number, owner = -1, y = 0): Entity => {
        const e = serverApp.world.spawn(name);
        serverApp.world.insert(e, Replicated, { owner });
        serverApp.world.insert(e, NetPos, { x, y, z: 0 });
        return e;
    };
    const placeless = (name: string, owner = -1): Entity => {
        const e = serverApp.world.spawn(name);
        serverApp.world.insert(e, Replicated, { owner });
        return e;
    };
    return { serverApp, server, clients, step, place, placeless };
}

describe('a radius provider answers what the radius policy answers', () => {
    it('agrees entity for entity across the interesting shapes', async () => {
        const shapes = async (useProvider: boolean): Promise<string[]> => {
            const h = await serverWith(1);
            const c = h.clients[0];
            h.place('anchor', 0, c.id);
            h.place('near', 10);
            h.place('far', 500);
            h.place('edge-in', 0, -1, 19);
            h.place('edge-out', 20, -1, 20);
            h.place('owned-far', 900, c.id);
            h.placeless('nowhere');
            if (useProvider) h.server.setInterestProvider(radiusInterestProvider(20, { position: posOf }));
            else h.server.setInterestPolicy(radiusInterest(20, { position: posOf }));
            await h.step(3);
            return ghosts(c.app);
        };

        const viaPolicy = await shapes(false);
        const viaProvider = await shapes(true);
        expect(viaProvider).toEqual(viaPolicy);
        expect(viaProvider).toEqual(['anchor', 'edge-in', 'near', 'nowhere', 'owned-far'].sort());
    });

    it('falls open to everything for a connection with no positioned anchor', async () => {
        const h = await serverWith(1);
        h.place('somewhere', 5000);
        h.placeless('nowhere');
        h.server.setInterestProvider(radiusInterestProvider(20, { position: posOf }));
        await h.step(3);
        expect(ghosts(h.clients[0].app)).toEqual(['nowhere', 'somewhere']);
    });

    it('sees from every anchor a connection owns', async () => {
        const h = await serverWith(1);
        const c = h.clients[0];
        h.place('a1', 0, c.id);
        h.place('a2', 1000, c.id);
        h.place('by-a1', 10);
        h.place('by-a2', 1010);
        h.place('between', 500);
        h.server.setInterestProvider(radiusInterestProvider(20, { position: posOf }));
        await h.step(3);
        expect(ghosts(c.app)).toEqual(['a1', 'a2', 'by-a1', 'by-a2']);
    });
});

describe('what a provider costs', () => {
    it('reads each position once per snapshot, not once per connection', async () => {
        const h = await serverWith(4);
        for (const c of h.clients) h.place(`pawn${c.id}`, c.id * 5, c.id);
        for (let i = 0; i < 20; i++) h.place(`e${i}`, i);
        await h.step();

        let reads = 0;
        h.server.setInterestProvider(radiusInterestProvider(50, {
            position: (world, e) => { reads++; return posOf(world, e); },
        }));
        reads = 0;
        await h.step();

        const population = h.serverApp.world.getEntitiesWithComponents([Replicated]).length;
        expect(reads).toBe(population);
    });

    it('prepares once per sample and queries once per connection', async () => {
        const h = await serverWith(4);
        for (const c of h.clients) h.place(`pawn${c.id}`, c.id * 5, c.id);
        await h.step();

        let prepares = 0;
        let queries = 0;
        const inner = radiusInterestProvider(50, { position: posOf });
        const counting: InterestProvider = {
            prepare(view) {
                prepares++;
                // Not an array: preparing may walk the population, installing
                // must not force it to be materialized first.
                expect(Array.isArray(view.entities)).toBe(false);
                expect(view.entityCount).toBeGreaterThan(0);
                const prepared = inner.prepare(view);
                return { query: (q) => { queries++; return prepared.query(q); } } as PreparedInterest;
            },
        };
        h.server.setInterestProvider(counting);
        prepares = 0; queries = 0;

        // One frame, one replication sample: one snapshot, four queries — not
        // one snapshot per connection, which is the whole point of the shape.
        await h.step(1);
        expect(prepares).toBe(1);
        expect(queries).toBe(4);

        await h.step(1);
        expect(prepares).toBe(2);
        expect(queries).toBe(8);
    });
});

describe('the interest slot holds one source', () => {
    it('switches between policy, provider and off, disposing what it drops', async () => {
        const h = await serverWith(1);
        const c = h.clients[0];
        h.place('anchor', 0, c.id);
        h.place('far', 500);
        h.server.setInterestPolicy(radiusInterest(20, { position: posOf }));
        await h.step(3);
        expect(ghosts(c.app)).toEqual(['anchor']);

        let disposed = 0;
        const wide = radiusInterestProvider(1000, { position: posOf });
        h.server.setInterestProvider({
            prepare: (v) => wide.prepare(v),
            dispose: () => { disposed++; },
        });
        await h.step(3);
        expect(ghosts(c.app)).toEqual(['anchor', 'far']);

        h.server.setInterestPolicy(radiusInterest(20, { position: posOf }));
        await h.step(3);
        expect(disposed).toBe(1);
        expect(ghosts(c.app)).toEqual(['anchor']);

        h.server.setInterestProvider(null);
        await h.step(3);
        expect(ghosts(c.app)).toEqual(['anchor', 'far']);
        expect(disposed).toBe(1);
    });

    it('disposes the installed provider when the server does', async () => {
        const h = await serverWith(1);
        let disposed = 0;
        const inner = radiusInterestProvider(20, { position: posOf });
        h.server.setInterestProvider({
            prepare: (v) => inner.prepare(v),
            dispose: () => { disposed++; },
        });
        h.serverApp.getResource(Net).stop();
        expect(disposed).toBe(1);
    });

    it('gives a joining client its own snapshot', async () => {
        const h = await serverWith(1);
        const c = h.clients[0];
        h.place('anchor', 0, c.id);
        h.place('far', 500);
        h.server.setInterestProvider(radiusInterestProvider(20, { position: posOf }));
        await h.step(3);

        const late = makeApp();
        const [ta, tb] = MemoryTransport.pair();
        const lateId = h.server.attachConnection(ta);
        await late.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        await late.tick(STEP);

        // No positioned anchor of its own: it fails open and sees everything.
        expect(ghosts(late)).toEqual(['anchor', 'far']);
        expect(lateId).toBeGreaterThan(0);
    });
});
