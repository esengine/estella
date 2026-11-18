// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  setInterestRefresh: views recomputed every N samples, staggered.
 *
 * What it trades is lateness at the edge of a view — an entity walking into
 * range arrives up to N - 1 samples late — and nothing else: a despawn leaves
 * every view at once, a connection's own entities reach it at once, and the
 * recomputes really are spread one share per sample.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, radiusInterestProvider } from '../src/net/replication';
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

async function serverWith(connections: number, refresh: number) {
    const serverApp = makeApp();
    const server = serverApp.getResource(Net).startServer();
    server.setInterestProvider(radiusInterestProvider(20, { position: posOf }));
    server.setInterestRefresh(refresh);
    const clients: { app: App; id: number }[] = [];
    for (let i = 0; i < connections; i++) {
        const app = makeApp();
        const [ta, tb] = MemoryTransport.pair();
        const id = server.attachConnection(ta);
        await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        clients.push({ app, id });
    }
    // Something moves every sample, so no view is ever certified unchanged and
    // only the refresh interval decides who is recomputed.
    const jitter = serverApp.world.spawn('jitter');
    serverApp.world.insert(jitter, Replicated, { owner: -1 });
    serverApp.world.insert(jitter, NetPos, { x: 10000, y: 0, z: 0 });
    let t = 0;
    const step = async (n = 1) => {
        for (let i = 0; i < n; i++) {
            serverApp.world.update(jitter, NetPos, (d) => { (d as { x: number }).x = 10000 + (++t % 2); });
            await serverApp.tick(STEP);
            for (const c of clients) await c.app.tick(STEP);
        }
    };
    const place = (name: string, x: number, owner = -1): Entity => {
        const e = serverApp.world.spawn(name);
        serverApp.world.insert(e, Replicated, { owner });
        serverApp.world.insert(e, NetPos, { x, y: 0, z: 0 });
        return e;
    };
    return { serverApp, server, clients, step, place };
}

describe('setInterestRefresh', () => {
    it('takes a whole number of samples, at least one', async () => {
        const { server } = await serverWith(0, 1);
        expect(() => server.setInterestRefresh(0)).toThrow(RangeError);
        expect(() => server.setInterestRefresh(2.5)).toThrow(RangeError);
        expect(() => server.setInterestRefresh(3)).not.toThrow();
    });

    it('recomputes one share of the connections each sample', async () => {
        const h = await serverWith(4, 4);
        h.clients.forEach((c, i) => h.place(`anchor${i}`, i * 1000, c.id));
        await h.step(4);
        const before = h.server.visibilityRecomputes;
        await h.step(8);
        // Four connections, every fourth sample each: one a sample.
        expect(h.server.visibilityRecomputes - before).toBe(8);
    });

    it('brings an entity walking into range within the interval, not necessarily at once', async () => {
        const h = await serverWith(1, 5);
        const c = h.clients[0];
        h.place('anchor', 0, c.id);
        const walker = h.place('walker', 500);
        await h.step(6);
        expect(ghosts(c.app)).not.toContain('walker');
        h.serverApp.world.update(walker, NetPos, (d) => { (d as { x: number }).x = 5; });
        let arrivedAfter = -1;
        for (let n = 1; n <= 5; n++) {
            await h.step();
            if (ghosts(c.app).includes('walker')) { arrivedAfter = n; break; }
        }
        expect(arrivedAfter).toBeGreaterThanOrEqual(1);
        expect(arrivedAfter).toBeLessThanOrEqual(5);
    });

    it('takes a despawned entity out of every view in the sample it goes', async () => {
        const h = await serverWith(3, 8);
        h.clients.forEach((c, i) => h.place(`anchor${i}`, i, c.id));
        const crate = h.place('crate', 5);
        await h.step(10);
        for (const c of h.clients) expect(ghosts(c.app)).toContain('crate');
        h.serverApp.world.despawn(crate);
        await h.step();
        for (const c of h.clients) expect(ghosts(c.app)).not.toContain('crate');
    });

    it('recomputes a connection whose own entities change, in that sample', async () => {
        const h = await serverWith(1, 8);
        const c = h.clients[0];
        h.place('anchor', 0, c.id);
        h.place('far-thing', 3000);
        await h.step(10);
        expect(ghosts(c.app)).not.toContain('far-thing');
        // A second anchor far away: what it sees is the connection's at once.
        h.place('scout', 3000, c.id);
        await h.step();
        expect(ghosts(c.app)).toContain('scout');
        expect(ghosts(c.app)).toContain('far-thing');
    });
});
