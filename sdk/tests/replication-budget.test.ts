// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A bandwidth budget: what each connection is sent per second is capped,
 *        and what matters most goes first.
 *
 * The claims, each one a way the budget could be wrong: the state stream stays
 * near its cap; a deferred entity is late but never wrong (the client converges
 * on the authority once things settle); nothing waits forever, however low its
 * priority; what a connection owns goes out every sample; and lifting the budget
 * delivers everything still owed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import type { ReliableOrderedTransport } from '../src/net/NetChannel';
import { replicationPlugin, Net, Replicated, type ReplicationServer } from '../src/net/replication';
import type { Entity } from '../src/types';

const STEP = 1 / 60;
let Pos: ReturnType<typeof defineComponent<{ x: number; y: number }>>;

beforeEach(() => {
    clearUserComponents();
    Pos = defineComponent('Pos', { x: 0, y: 0 }, { replicatedFields: ['x', 'y'] });
});

/** The server end of a link, counting the binary (state) bytes it carries. */
function counting(inner: ReliableOrderedTransport) {
    const stats = { stateBytes: 0, stateFrames: 0 };
    const transport: ReliableOrderedTransport = {
        delivery: 'reliable-ordered',
        send: (d) => {
            if (typeof d !== 'string') { stats.stateBytes += d.byteLength; stats.stateFrames++; }
            inner.send(d);
        },
        on: (e, h) => inner.on(e, h),
    };
    return { transport, stats };
}

async function setup(count: number) {
    const serverApp = App.new();
    serverApp.addPlugin(replicationPlugin);
    const server = serverApp.getResource(Net).startServer();
    const clientApp = App.new();
    clientApp.addPlugin(replicationPlugin);
    const [a, b] = MemoryTransport.pair();
    const link = counting(a);
    server.attachConnection(link.transport);
    const client = await clientApp.getResource(Net).connect(b, { interpolationDelayTicks: 0 });
    const entities: Entity[] = [];
    for (let i = 0; i < count; i++) {
        const e = serverApp.world.spawn(`e${i}`);
        serverApp.world.insert(e, Pos, { x: i, y: 0 });
        serverApp.world.insert(e, Replicated, { owner: -1 });
        entities.push(e);
    }
    const step = async (n = 1, move = true) => {
        for (let k = 0; k < n; k++) {
            if (move) for (const e of entities) serverApp.world.update(e, Pos, (d) => { (d as { y: number }).y += 1; });
            await serverApp.tick(STEP);
            await clientApp.tick(STEP);
        }
    };
    await step(2, false); // spawns land, budget-free
    return { serverApp, server, clientApp, client, entities, link, step };
}

const ghostY = (app: App, name: string): number => {
    const e = app.world.getEntitiesWithComponents([Replicated])
        .find((g) => (app.world.tryGet(g, Name) as { value: string } | null)?.value === name)!;
    return (app.world.tryGet(e, Pos) as { y: number }).y;
};
const serverY = (app: App, e: Entity) => (app.world.tryGet(e, Pos) as { y: number }).y;

describe('a bandwidth budget', () => {
    it('keeps the state stream near its cap where unbudgeted it is far above', async () => {
        const free = await setup(200);
        free.link.stats.stateBytes = 0;
        await free.step(60);
        const unbudgeted = free.link.stats.stateBytes;

        const capped = await setup(200);
        capped.server.setBandwidthBudget({ bytesPerSecond: 8000 });
        capped.link.stats.stateBytes = 0;
        await capped.step(60);
        // One simulated second at 60 Hz. The cap is soft by at most one row a
        // sample plus a tick's carry-over.
        expect(capped.link.stats.stateBytes).toBeLessThan(8000 * 1.25);
        expect(capped.link.stats.stateBytes).toBeGreaterThan(8000 * 0.6);
        expect(unbudgeted).toBeGreaterThan(capped.link.stats.stateBytes * 4);
        expect(capped.server.rowsDeferred).toBeGreaterThan(0);
    });

    it('is late, never wrong: once things stop moving every ghost reaches the authority', async () => {
        const h = await setup(150);
        h.server.setBandwidthBudget({ bytesPerSecond: 6000 });
        await h.step(30);
        expect(h.server.owedCount(h.client.connectionId)).toBeGreaterThan(0);
        await h.step(240, false);
        expect(h.server.owedCount(h.client.connectionId)).toBe(0);
        for (let i = 0; i < h.entities.length; i++) {
            expect(ghostY(h.clientApp, `e${i}`)).toBe(serverY(h.serverApp, h.entities[i]!));
        }
    });

    it('sends the urgent often and the rest less often, but never never', async () => {
        const h = await setup(100);
        const urgent = new Set(h.entities.slice(0, 5));
        h.server.setBandwidthBudget({
            bytesPerSecond: 4000,
            priority: ({ entity }) => (urgent.has(entity) ? 10 : 0.2),
        });
        const lastSeen = new Map<string, number>();
        const updates = new Map<string, number>();
        for (let t = 0; t < 180; t++) {
            await h.step(1);
            for (let i = 0; i < h.entities.length; i++) {
                const name = `e${i}`;
                const y = ghostY(h.clientApp, name);
                if (lastSeen.get(name) !== y) updates.set(name, (updates.get(name) ?? 0) + 1);
                lastSeen.set(name, y);
            }
        }
        const urgentMin = Math.min(...[0, 1, 2, 3, 4].map((i) => updates.get(`e${i}`) ?? 0));
        const restMax = Math.max(...h.entities.slice(5).map((_, i) => updates.get(`e${i + 5}`) ?? 0));
        const restMin = Math.min(...h.entities.slice(5).map((_, i) => updates.get(`e${i + 5}`) ?? 0));
        expect(urgentMin).toBeGreaterThan(restMax);
        expect(restMin).toBeGreaterThan(0);
    });

    it('always sends what the connection owns', async () => {
        const h = await setup(200);
        const mine = h.entities[150]!;
        h.serverApp.world.insert(mine, Replicated, { owner: h.client.connectionId });
        await h.step(1);
        h.server.setBandwidthBudget({ bytesPerSecond: 500, priority: () => 1 });
        for (let t = 0; t < 20; t++) {
            await h.step(1);
            expect(ghostY(h.clientApp, 'e150')).toBe(serverY(h.serverApp, mine));
        }
    });

    it('delivers everything still owed when lifted, then broadcasts as before', async () => {
        const h = await setup(150);
        h.server.setBandwidthBudget({ bytesPerSecond: 3000 });
        await h.step(20);
        expect(h.server.owedCount(h.client.connectionId)).toBeGreaterThan(0);
        h.server.setBandwidthBudget(null);
        await h.step(1, false);
        expect(h.server.owedCount(h.client.connectionId)).toBe(0);
        for (let i = 0; i < h.entities.length; i++) {
            expect(ghostY(h.clientApp, `e${i}`)).toBe(serverY(h.serverApp, h.entities[i]!));
        }
        await h.step(3);
        for (let i = 0; i < h.entities.length; i++) {
            expect(ghostY(h.clientApp, `e${i}`)).toBe(serverY(h.serverApp, h.entities[i]!));
        }
    });

    it('drops what an entity owed when it leaves, and a despawn mid-debt breaks nothing', async () => {
        const h = await setup(80);
        h.server.setBandwidthBudget({ bytesPerSecond: 2000 });
        await h.step(10);
        for (const e of h.entities.slice(0, 40)) h.serverApp.world.despawn(e);
        h.entities.splice(0, 40);
        await h.step(5);
        await h.step(200, false);
        expect(h.server.owedCount(h.client.connectionId)).toBe(0);
        expect(h.clientApp.world.getEntitiesWithComponents([Replicated])).toHaveLength(40);
        for (const e of h.entities) {
            const name = (h.serverApp.world.tryGet(e, Name) as { value: string }).value;
            expect(ghostY(h.clientApp, name)).toBe(serverY(h.serverApp, e));
        }
    });

    it('refuses a budget that is not positive', () => {
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const server: ReplicationServer = app.getResource(Net).startServer();
        expect(() => server.setBandwidthBudget({ bytesPerSecond: 0 })).toThrow('positive');
    });
});
