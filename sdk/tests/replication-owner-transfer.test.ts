// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Ownership decides two different things, and both have to keep up.
 *
 * `Replicated.owner` places a connection's VIEW — `radiusInterest` reads the
 * entities a connection owns to find its anchors — and it separately forces
 * those entities to stay visible whatever a policy says. A lookup that goes
 * stale on a transfer can satisfy the second and quietly fail the first, so the
 * fixture watches an entity that is only visible THROUGH the moved anchor.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, radiusInterest } from '../src/net/replication';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';

const STEP = 1 / 60;
/** Sim ticks between replication samples: 60Hz simulation, 20Hz replication. */
const SAMPLE_FRAMES = 3;

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

describe('the ownership a policy is handed', () => {
    it('already reflects a transfer made before this sample', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const world = serverApp.world;

        const ids: number[] = [];
        const clientApps: App[] = [];
        for (let i = 0; i < 2; i++) {
            const app = makeApp();
            const [ta, tb] = MemoryTransport.pair();
            ids.push(server.attachConnection(ta));
            await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
            clientApps.push(app);
        }

        // Watching what the server hands the policy removes the wire from the
        // question: this is about WHEN the index is refreshed within a sample,
        // and a client's copy arrives a frame later either way.
        const seen: { conn: number; owned: number[] }[] = [];
        server.setInterestPolicy(({ connectionId, owned, candidates }) => {
            seen.push({ conn: connectionId, owned: owned ? [...(owned as number[])] : [] });
            return new Set(candidates);
        });

        const e = world.spawn('pawn');
        world.insert(e, Replicated, { owner: ids[0] });
        world.insert(e, NetPos, { x: 0, y: 0, z: 0 });
        const step = async (n = 1) => {
            for (let i = 0; i < n; i++) {
                await serverApp.tick(STEP);
                for (const a of clientApps) await a.tick(STEP);
            }
        };
        await step(4);
        expect(seen.some((r) => r.conn === ids[0] && r.owned.includes(e as number))).toBe(true);

        world.update(e, Replicated, (r) => { (r as { owner: number }).owner = ids[1] as number; });
        seen.length = 0;
        await step(SAMPLE_FRAMES);

        // The FIRST evaluation after the transfer, not eventually.
        const firstForNewOwner = seen.find((r) => r.conn === ids[1]);
        expect(firstForNewOwner?.owned).toContain(e as number);
        const firstForOldOwner = seen.find((r) => r.conn === ids[0]);
        expect(firstForOldOwner?.owned).not.toContain(e as number);
    });
});

describe('what the ownership pass costs', () => {
    it('reads no candidates once the index is installed', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const world = serverApp.world;
        const clientApp = makeApp();
        const [ta, tb] = MemoryTransport.pair();
        const id = server.attachConnection(ta);
        await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        server.setInterestPolicy(radiusInterest(20, { position: posOf }));

        for (let i = 0; i < 200; i++) {
            const e = world.spawn(`e${i}`);
            world.insert(e, Replicated, { owner: i === 0 ? id : -1 });
            world.insert(e, NetPos, { x: i * 10, y: 0, z: 0 });
        }
        await serverApp.tick(STEP); await clientApp.tick(STEP);

        // The forced-owner pass answered from the index reads nothing; answering
        // it off the candidate list is the second O(population) walk per
        // connection this exists to remove.
        const before = server.ownerScanVisits;
        for (let i = 0; i < 6; i++) { await serverApp.tick(STEP); await clientApp.tick(STEP); }
        expect(server.ownerScanVisits).toBe(before);
    });
});

describe('an anchor changing hands', () => {
    it('moves the view with it, not just the entity itself', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const world = serverApp.world;

        const clients: { app: App; id: number }[] = [];
        for (let i = 0; i < 2; i++) {
            const app = makeApp();
            const [ta, tb] = MemoryTransport.pair();
            const id = server.attachConnection(ta);
            await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
            clients.push({ app, id });
        }
        const [c0, c1] = clients;
        server.setInterestPolicy(radiusInterest(20, { position: posOf }));

        const place = (name: string, x: number, owner: number): Entity => {
            const e = world.spawn(name);
            world.insert(e, Replicated, { owner });
            world.insert(e, NetPos, { x, y: 0, z: 0 });
            return e;
        };
        // c0 holds the anchor that will move, AND a second one far away — without
        // it, losing its last positioned anchor makes radiusInterest fail open to
        // 'all' and the target would never leave, for the wrong reason.
        const moving = place('moving', 0, c0.id);
        place('c0-far', 1000, c0.id);
        place('c1-own', 500, c1.id);
        const target = place('target', 5, -1);

        const step = async (n = 1) => {
            for (let i = 0; i < n; i++) {
                await serverApp.tick(STEP);
                for (const c of clients) await c.app.tick(STEP);
            }
        };
        await step(2);

        expect(ghosts(c0.app)).toContain('target');
        expect(ghosts(c1.app)).not.toContain('target');
        // The prerequisite the whole case rests on: c0 keeps a positioned anchor
        // after the transfer, so a `leave` means the view moved, not that the
        // policy gave up.
        expect(ghosts(c0.app)).toContain('c0-far');

        world.update(moving, Replicated, (r) => { (r as { owner: number }).owner = c1.id; });

        // Counted, not slept through: ownership must place the view on the FIRST
        // sample after the transfer. Refreshing the index later in the sample
        // than the interest evaluation still converges — one sample late.
        let frames = 0;
        while (ghosts(c0.app).includes('target') && frames < 12) {
            await step();
            frames++;
        }
        expect(frames).toBeLessThanOrEqual(SAMPLE_FRAMES + 1);

        // The anchor left c0, so what only it could see leaves too.
        expect(ghosts(c0.app)).not.toContain('target');
        expect(ghosts(c0.app)).toContain('c0-far');
        // And c1 gets both the anchor it now owns and what stands beside it.
        expect(ghosts(c1.app)).toContain('moving');
        expect(ghosts(c1.app)).toContain('target');
        expect(target).toBeGreaterThan(0);
    });
});
