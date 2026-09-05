// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Finding what changed, by whichever projection is cheaper.
 *
 * A replicated component belongs to the whole world, not to this server: the
 * write journal lists everything written to it, including entities nobody
 * replicates, while the scan asks each known entity and costs the population
 * however few moved. The pass picks per sample, so every claim below has to hold
 * on BOTH sides of that choice — a delta that only survives one of them is a
 * silent loss the totals would never show.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
import type { Entity } from '../src/types';

const STEP = 1 / 60;
let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;
let Health: ReturnType<typeof defineComponent<{ hp: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('DiscPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
    Health = defineComponent('DiscHealth', { hp: 0 }, { replicatedFields: ['hp'] });
});

async function serverWith() {
    const serverApp = App.new();
    serverApp.addPlugin(replicationPlugin);
    const server = serverApp.getResource(Net).startServer();
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const [ta, tb] = MemoryTransport.pair();
    server.attachConnection(ta);
    await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
    const step = async (n = 1) => {
        for (let i = 0; i < n; i++) { await serverApp.tick(STEP); await app.tick(STEP); }
    };
    const place = (name: string, x: number): Entity => {
        const e = serverApp.world.spawn(name);
        serverApp.world.insert(e, Replicated, { owner: -1 });
        serverApp.world.insert(e, NetPos, { x, y: 0, z: 0 });
        return e;
    };
    /** Has the component, is not replicated: journal rows this server must skip. */
    const bystander = (x: number): Entity => {
        const e = serverApp.world.spawn();
        serverApp.world.insert(e, NetPos, { x, y: 0, z: 0 });
        return e;
    };
    const ghostX = (name: string): number | undefined => {
        const e = app.world.getEntitiesWithComponents([Replicated])
            .find((g) => (app.world.tryGet(g, Name) as { value: string } | null)?.value === name);
        return e === undefined ? undefined : (app.world.tryGet(e, NetPos) as { x: number } | null)?.x;
    };
    return { serverApp, app, server, step, place, bystander, ghostX };
}

/** Which projection the pass ACTUALLY took, from the server rather than from a
 *  restatement of its rule — the two have to be able to disagree. */
function projections(server: { journalReads: number; populationScans: number }) {
    const j = server.journalReads, p = server.populationScans;
    return { since: () => ({ journal: server.journalReads - j, scan: server.populationScans - p }) };
}

describe('a change is discovered whichever projection is cheaper', () => {
    it('delivers the delta when the journal is the smaller side', async () => {
        const h = await serverWith();
        const tracked = h.place('tracked', 0);
        for (let i = 0; i < 20; i++) h.place(`filler${i}`, 100 + i);
        await h.step(3);

        const took = projections(h.server);
        h.serverApp.world.update(tracked, NetPos, (d) => { (d as { x: number }).x = 7; });
        await h.step(2);
        expect(took.since().journal).toBeGreaterThan(0);
        expect(h.ghostX('tracked')).toBe(7);
    });

    it('delivers the delta when bystanders make the journal the bigger side', async () => {
        const h = await serverWith();
        const tracked = h.place('tracked', 0);
        const others = [h.place('other', 1)];
        const idle: Entity[] = [];
        for (let i = 0; i < 40; i++) idle.push(h.bystander(500 + i));
        await h.step(3);

        // Entities this server does not replicate, writing the same component.
        const took = projections(h.server);
        for (const e of idle) h.serverApp.world.update(e, NetPos, (d) => { (d as { x: number }).x += 1; });
        h.serverApp.world.update(tracked, NetPos, (d) => { (d as { x: number }).x = 9; });
        await h.step(1);
        expect(took.since().scan).toBeGreaterThan(0);
        await h.step(2);
        expect(h.ghostX('tracked')).toBe(9);
        expect(others).toHaveLength(1);
    });

    // The `known_` filter this does NOT guard: dropping it leaves the pass
    // correct, because a bystander has no shadow and is skipped there. It is a
    // cost bound, and the chooser already caps it below the population.
    it('never spawns a ghost for an entity it does not replicate', async () => {
        const h = await serverWith();
        h.place('tracked', 0);
        const outsider = h.bystander(3);
        await h.step(3);

        h.serverApp.world.update(outsider, NetPos, (d) => { (d as { x: number }).x = 99; });
        await h.step(2);
        // One ghost, and it is not the bystander's.
        expect(h.app.world.getEntitiesWithComponents([Replicated])).toHaveLength(1);
        expect(h.ghostX('tracked')).toBe(0);
    });
});

describe('what the journal alone would miss', () => {
    it('discovers a component ADDED to an entity that is already replicated', async () => {
        // `insert` records an add AND a write; a pass reading only membership
        // would see the arrival, and one reading only values would see nothing.
        const h = await serverWith();
        const e = h.place('grower', 0);
        for (let i = 0; i < 20; i++) h.place(`filler${i}`, 100 + i);
        await h.step(3);

        const took = projections(h.server);
        h.serverApp.world.insert(e, Health, { hp: 55 });
        await h.step(3);
        expect(took.since().journal).toBeGreaterThan(0);
        const ghost = h.app.world.getEntitiesWithComponents([Replicated])[0]!;
        expect((h.app.world.tryGet(ghost, Health) as { hp: number } | null)?.hp).toBe(55);
    });

    it('still reports a component that left, which is not a write at all', async () => {
        const h = await serverWith();
        const e = h.place('shrinker', 0);
        h.serverApp.world.insert(e, Health, { hp: 55 });
        await h.step(3);

        h.serverApp.world.remove(e, Health);
        await h.step(3);
        const ghost = h.app.world.getEntitiesWithComponents([Replicated])[0]!;
        expect(h.app.world.has(ghost, Health)).toBe(false);
    });
});

describe('the claim is a lease', () => {
    it('advances every sample, so the journal does not grow with the session', async () => {
        const h = await serverWith();
        const all: Entity[] = [];
        for (let i = 0; i < 10; i++) all.push(h.place(`e${i}`, i));
        await h.step(3);

        const perSample = () => {
            for (const e of all) h.serverApp.world.update(e, NetPos, (d) => { (d as { x: number }).x += 1; });
        };
        perSample();
        const pending = h.serverApp.world.bufferedWriteRows(NetPos);
        await h.step(1);
        const consumed = h.serverApp.world.bufferedWriteRows(NetPos);
        for (let i = 0; i < 12; i++) { perSample(); await h.step(1); }
        const afterMany = h.serverApp.world.bufferedWriteRows(NetPos);

        // Written rows are there to be read, gone once the claim moves past
        // them, and thirteen samples later still not thirteen samples deep.
        expect(pending).toBeGreaterThanOrEqual(all.length);
        expect(consumed).toBeLessThan(pending);
        expect(afterMany).toBeLessThanOrEqual(pending);
    });
});
