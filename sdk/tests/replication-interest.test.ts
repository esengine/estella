// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Interest management: with a policy installed the server filters
 * spawns/despawns/deltas per connection — ghosts exist only while relevant,
 * leaving despawns them, re-entering respawns them with current state, owned
 * entities can never be culled, and the no-policy broadcast path is unchanged
 * (including installing/removing a policy mid-session).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { defineComponent, clearUserComponents, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import {
    replicationPlugin, Net, Replicated, radiusInterest,
    type InterestPolicy, type ReplicationClientOptions,
} from '../src/net/replication';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';

const STEP = 1 / 60;

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, z: 0 }, {
        replicatedFields: ['x', 'y', 'z'],
    });
});

function makeApp(): App {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    return app;
}

const posOf = (world: World, e: Entity): { x: number; y: number; z: number } | null => {
    const p = world.tryGet(e, NetPos) as { x: number; y: number; z: number } | null;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
};

async function makePair(policy?: InterestPolicy, options: ReplicationClientOptions = {}) {
    const serverApp = makeApp();
    const clientApp = makeApp();
    const server = serverApp.getResource(Net).startServer();
    if (policy) server.setInterestPolicy(policy);
    const [ta, tb] = MemoryTransport.pair();
    const connId = server.attachConnection(ta);
    const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0, ...options });
    return { serverApp, clientApp, server, client, connId };
}

function spawnAt(app: App, name: string, x: number, y: number, owner = 0, z = 0): Entity {
    const e = app.world.spawn(name);
    app.world.insert(e, Replicated, { owner });
    app.world.insert(e, NetPos, { x, y, z });
    return e;
}

function ghostNames(app: App): string[] {
    return app.world.getEntitiesWithComponents([Replicated])
        .map((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value ?? '')
        .sort();
}

async function step(serverApp: App, clientApp: App, n = 1): Promise<void> {
    for (let i = 0; i < n; i++) {
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
    }
}

describe('entity references across changes in visibility and network identity', () => {
    it.each(['immediate', 'interpolated', 'predicted'])('resolves current reference fields as targets enter and leave (%s)', async mode => {
        const Links = defineComponent('ViewLinks', { focus: 0, members: [] as number[], weights: [] as number[] }, {
            entityFields: ['focus', 'members'], replicatedFields: ['focus', 'members', 'weights'],
        });
        const { serverApp, clientApp, connId } = await makePair(radiusInterest(50, { position: posOf }), {
            interpolationDelayTicks: mode === 'interpolated' ? 2 : 0,
            prediction: mode === 'predicted' ? { apply() {} } : undefined,
        });
        const sw = serverApp.world, cw = clientApp.world;
        cw.spawn('client only');
        const holder = spawnAt(serverApp, 'holder', 0, 0, connId);
        const first = spawnAt(serverApp, 'first', 300, 0), next = spawnAt(serverApp, 'next', 400, 0);
        sw.insert(holder, Links, { focus: first, members: [first, holder, first, 0], weights: [first, next] });
        const tick = () => step(serverApp, clientApp, 6);
        const move = (entity: Entity, x: number) => sw.update(entity, NetPos, pos => { pos.x = x; });
        await tick();
        const ghost = cw.findEntityByName('holder')!;
        const expectLinks = (focus: number, members: number[]) => {
            expect(cw.get(ghost, Links)).toEqual({ focus, members, weights: [first, next] });
        };
        expectLinks(0, [0, ghost, 0, 0]);

        move(first, 5);
        await tick();
        const firstGhost = cw.findEntityByName('first')!;
        expect(firstGhost).toBeDefined();
        expectLinks(firstGhost, [firstGhost, ghost, firstGhost, 0]);
        move(first, 300);
        await tick();
        expect(cw.valid(firstGhost)).toBe(false);
        expectLinks(0, [0, ghost, 0, 0]);

        // The new state frame points outside the view. The old target entering
        // again must only fill the slots the new state still assigns to it.
        sw.update(holder, Links, links => { links.focus = next; links.members = [next, first, next]; });
        await tick();
        move(first, 5);
        await tick();
        const returned = cw.findEntityByName('first')!;
        expect(returned).toBeDefined();
        expect(returned).not.toBe(firstGhost);
        expectLinks(0, [0, returned, 0]);
        move(next, 10);
        await tick();
        const nextGhost = cw.findEntityByName('next')!;
        expect(nextGhost).toBeDefined();
        expectLinks(nextGhost, [nextGhost, returned, nextGhost]);
        sw.despawn(next);
        await tick();
        expectLinks(0, [0, returned, 0]);

        sw.remove(holder, Links);
        await tick();
        move(first, 300);
        await tick();
        move(first, 5);
        await tick();
        expect(cw.has(ghost, Links)).toBe(false);
    });

    it('resolves an interpolated reference against the ghost present at presentation time', async () => {
        const Link = defineComponent('DelayedLink', { focus: 0 }, { entityFields: ['focus'], replicatedFields: ['focus'] });
        const { serverApp, clientApp, client, connId } = await makePair(radiusInterest(50, { position: posOf }), {
            interpolationDelayTicks: 3,
        });
        const sw = serverApp.world, cw = clientApp.world;
        const holder = spawnAt(serverApp, 'holder', 0, 0, connId);
        const target = spawnAt(serverApp, 'target', 5, 0);
        sw.insert(holder, Link, { focus: holder });
        await step(serverApp, clientApp);
        const ghost = cw.findEntityByName('holder')!, before = cw.findEntityByName('target')!;
        const receive = async () => { await serverApp.tick(STEP); client.applyPending(); };
        sw.update(holder, Link, data => { data.focus = target; });
        await receive();
        sw.update(target, NetPos, pos => { pos.x = 150; });
        await receive();
        sw.update(target, NetPos, pos => { pos.x = 5; });
        await receive();
        const after = cw.findEntityByName('target')!;
        expect(after).toBeDefined();
        expect(after).not.toBe(before);
        client.sampleInterpolation(0);
        expect(cw.get(ghost, Link).focus).toBe(ghost);
        for (let i = 0; i < 12; i++) client.sampleInterpolation(1);
        expect(cw.get(ghost, Link).focus).toBe(after);
    });

    it('hands the newest buffered references to prediction when an interpolated owner takes control', async () => {
        const Link = defineComponent('PredictedViewLink', { focus: 0, marks: [] as number[] }, {
            entityFields: ['focus'], replicatedFields: ['focus', 'marks'],
        });
        const { serverApp, clientApp, client, connId } = await makePair(undefined, { interpolationDelayTicks: 4 });
        const sw = serverApp.world, cw = clientApp.world;
        const holder = spawnAt(serverApp, 'holder', 0, 0, connId), target = spawnAt(serverApp, 'target', 5, 0);
        sw.insert(holder, Link, { focus: holder });
        await step(serverApp, clientApp);
        const ghost = cw.findEntityByName('holder')!, other = cw.findEntityByName('target')!;
        sw.update(holder, Link, data => { data.marks = [3]; });
        await step(serverApp, clientApp, 12);
        expect(cw.get(ghost, Link).marks).toEqual([3]);
        sw.update(holder, Link, data => { data.focus = target; });
        await serverApp.tick(STEP);
        client.applyPending();
        client.sampleInterpolation(0);
        expect(cw.get(ghost, Link).focus).toBe(ghost);
        client.enablePrediction({ apply() {} });
        cw.get(ghost, Link).marks.push(9);
        await clientApp.tick(STEP);
        expect(cw.get(ghost, Link).focus).toBe(other);
        expect(cw.get(ghost, Link).marks).toEqual([3]);
        sw.update(holder, Link, data => { data.focus = holder; });
        await step(serverApp, clientApp, 12);
        expect(cw.get(ghost, Link).focus).toBe(ghost);
    });

    it('resolves a new predicted component when its target enters in the same client step', async () => {
        const Link = defineComponent('PredictedLink', { focus: 0 }, { entityFields: ['focus'], replicatedFields: ['focus'] });
        const { serverApp, clientApp, connId } = await makePair(radiusInterest(50, { position: posOf }), {
            prediction: { apply() {} },
        });
        const sw = serverApp.world, cw = clientApp.world;
        const holder = spawnAt(serverApp, 'holder', 0, 0, connId), target = spawnAt(serverApp, 'target', 150, 0);
        await step(serverApp, clientApp);
        const ghost = cw.findEntityByName('holder')!;
        expect(cw.has(ghost, Link)).toBe(false);
        sw.insert(holder, Link, { focus: target });
        await serverApp.tick(STEP);
        sw.update(target, NetPos, pos => { pos.x = 5; });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const arrived = cw.findEntityByName('target')!;
        expect(arrived).toBeDefined();
        expect(cw.get(ghost, Link).focus).toBe(arrived);
    });

    it.each(['broadcast', 'filtered', 'budgeted'])('updates references when an existing entity gains a new network ID (%s)', async route => {
        const Link = defineComponent('RegistrationLinks', { focus: 0, members: [] as number[], numbers: [] as number[] }, {
            entityFields: ['focus', 'members'], replicatedFields: ['focus', 'members', 'numbers'],
        });
        const { serverApp, clientApp, server } = await makePair();
        if (route === 'filtered') server.setInterestPolicy(() => 'all');
        if (route === 'budgeted') server.setBandwidthBudget({ bytesPerSecond: 16384 });
        const sw = serverApp.world, cw = clientApp.world;
        cw.spawn('local only');
        const holder = spawnAt(serverApp, 'holder', 0, 0), target = sw.spawn('target');
        sw.insert(holder, Link, { focus: target, members: [target, holder, target], numbers: [target] });
        const tick = () => step(serverApp, clientApp, 3);
        await tick();
        const ghost = cw.findEntityByName('holder')!;
        const check = (local: number) => expect(cw.get(ghost, Link)).toEqual({
            focus: local, members: [local, ghost, local], numbers: [target],
        });
        check(0);
        sw.insert(target, Replicated, {});
        await tick();
        const original = cw.findEntityByName('target')!;
        expect(original).toBeDefined();
        check(original);
        sw.remove(target, Replicated);
        await tick();
        expect(cw.valid(original)).toBe(false);
        check(0);
        sw.insert(target, Replicated, {});
        await tick();
        const next = cw.findEntityByName('target')!;
        expect(next).toBeDefined();
        expect(next).not.toBe(original);
        check(next);

        sw.update(holder, Link, links => { links.focus = 0; links.members.length = 0; });
        await tick();
        const frames = server.stats.stateFrames;
        sw.remove(target, Replicated);
        await tick();
        sw.insert(target, Replicated, {});
        await tick();
        expect(server.stats.stateFrames).toBe(frames);
        expect(cw.get(ghost, Link)).toEqual({ focus: 0, members: [], numbers: [target] });
    });

});

describe('interest management (radius policy)', () => {
    it('spawns only relevant ghosts, despawns on leave, respawns with current state on re-enter', async () => {
        const { serverApp, clientApp, server, client, connId } = await makePair();
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));

        spawnAt(serverApp, 'pawn', 0, 0, connId);
        const near = spawnAt(serverApp, 'near', 50, 0);
        const far = spawnAt(serverApp, 'far', 500, 0);
        await step(serverApp, clientApp);

        expect(ghostNames(clientApp)).toEqual(['near', 'pawn']);

        // `near` wanders out of range → its ghost despawns.
        serverApp.world.set(near, NetPos, { x: 400, y: 0, z: 0 });
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['pawn']);

        // `far` wanders in — while out of interest it also changed y; the
        // respawn must carry CURRENT state, not the state at first spawn.
        serverApp.world.set(far, NetPos, { x: 80, y: 33, z: 0 });
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['far', 'pawn']);
        const farGhost = client.netIds.entityOf(
            (serverApp.world.tryGet(far, Replicated) as { netId: number }).netId,
        )!;
        const farPos = clientApp.world.tryGet(farGhost, NetPos) as { x: number; y: number };
        expect(farPos).toMatchObject({ x: 80, y: 33 });
    });

    it('deltas for out-of-interest entities never reach the client', async () => {
        const { serverApp, clientApp, server, client, connId } = await makePair();
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));

        spawnAt(serverApp, 'pawn', 0, 0, connId);
        const far = spawnAt(serverApp, 'far', 500, 0);
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['pawn']);

        // Move the far entity (still out of range): no ghost may appear and
        // the client's netId table must not learn it.
        serverApp.world.set(far, NetPos, { x: 510, y: 5, z: 0 });
        await step(serverApp, clientApp, 2);
        expect(ghostNames(clientApp)).toEqual(['pawn']);
        const farNetId = (serverApp.world.tryGet(far, Replicated) as { netId: number }).netId;
        expect(client.netIds.entityOf(farNetId)).toBeUndefined();
    });

    it('a policy can never cull entities the connection owns', async () => {
        const { serverApp, clientApp, server, connId } = await makePair();
        // A hostile policy that claims nothing is relevant.
        server.setInterestPolicy(() => new Set<Entity>());

        spawnAt(serverApp, 'pawn', 12345, 0, connId);
        spawnAt(serverApp, 'scenery', 0, 0);
        await step(serverApp, clientApp);

        expect(ghostNames(clientApp)).toEqual(['pawn']);
    });

    it('a server-despawned entity inside interest despawns the ghost', async () => {
        const { serverApp, clientApp, server, connId } = await makePair();
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));

        spawnAt(serverApp, 'pawn', 0, 0, connId);
        const near = spawnAt(serverApp, 'near', 10, 0);
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['near', 'pawn']);

        serverApp.world.despawn(near);
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['pawn']);
    });

    it('the initial state for a late joiner is policy-filtered', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));

        const laterApp = makeApp();
        const [tc, td] = MemoryTransport.pair();
        const connId = server.attachConnection(tc);
        spawnAt(serverApp, 'pawn', 0, 0, connId);
        spawnAt(serverApp, 'near', 20, 0);
        spawnAt(serverApp, 'far', 900, 0);
        await serverApp.tick(STEP); // entities become known before the join completes

        await laterApp.getResource(Net).connect(td, { interpolationDelayTicks: 0 });
        await step(serverApp, laterApp);
        expect(ghostNames(laterApp)).toEqual(['near', 'pawn']);
    });

    // Interest is a sphere, not a column. Two floors of a building sit at the same
    // x/y, and a radius that drops z sends every connection both of them — the one
    // saving it means is the one that stops being saved.
    it('culls by depth as it culls by width', async () => {
        const { serverApp, clientApp, server, connId } = await makePair();
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));

        spawnAt(serverApp, 'pawn', 0, 0, connId);
        spawnAt(serverApp, 'sameFloor', 50, 0);
        spawnAt(serverApp, 'upstairs', 0, 0, 0, 500);
        await step(serverApp, clientApp);

        expect(ghostNames(clientApp)).toEqual(['pawn', 'sameFloor']);
    });

    it('radius policy fails open while the connection owns no positioned entity', async () => {
        const { serverApp, clientApp, server } = await makePair();
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));

        spawnAt(serverApp, 'a', 0, 0);
        spawnAt(serverApp, 'b', 9999, 0);
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['a', 'b']);
    });
});

describe('interest management (mid-session transitions)', () => {
    it('installing a policy mid-session despawns now-irrelevant ghosts', async () => {
        const { serverApp, clientApp, server, connId } = await makePair();

        spawnAt(serverApp, 'pawn', 0, 0, connId);
        spawnAt(serverApp, 'far', 800, 0);
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['far', 'pawn']); // broadcast path

        server.setInterestPolicy(radiusInterest(100, { position: posOf }));
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['pawn']);
    });

    it('removing the policy catches connections up on everything they missed', async () => {
        const { serverApp, clientApp, server, connId } = await makePair();
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));

        spawnAt(serverApp, 'pawn', 0, 0, connId);
        spawnAt(serverApp, 'far', 800, 0);
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['pawn']);

        server.setInterestPolicy(null);
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['far', 'pawn']);
    });

    it('two connections receive different worlds under the same policy', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        server.setInterestPolicy(radiusInterest(100, { position: posOf }));

        const appA = makeApp();
        const appB = makeApp();
        const [ta, tb] = MemoryTransport.pair();
        const [tc, td] = MemoryTransport.pair();
        const connA = server.attachConnection(ta);
        const connB = server.attachConnection(tc);
        await appA.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        await appB.getResource(Net).connect(td, { interpolationDelayTicks: 0 });

        spawnAt(serverApp, 'pawnA', 0, 0, connA);
        spawnAt(serverApp, 'pawnB', 1000, 0, connB);
        spawnAt(serverApp, 'nearA', 30, 0);
        spawnAt(serverApp, 'nearB', 1030, 0);

        await serverApp.tick(STEP);
        await appA.tick(STEP);
        await appB.tick(STEP);

        expect(ghostNames(appA)).toEqual(['nearA', 'pawnA']);
        expect(ghostNames(appB)).toEqual(['nearB', 'pawnB']);
    });
});
