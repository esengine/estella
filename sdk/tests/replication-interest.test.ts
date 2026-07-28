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
import { App } from '../src/app';
import { defineComponent, clearUserComponents, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import {
    replicationPlugin, Net, Replicated, radiusInterest,
    type InterestPolicy,
} from '../src/net/replication';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';

const STEP = 1 / 60;

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0 }, {
        replicatedFields: ['x', 'y'],
    });
});

function makeApp(): App {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    return app;
}

const posOf = (world: World, e: Entity): { x: number; y: number } | null => {
    const p = world.tryGet(e, NetPos) as { x: number; y: number } | null;
    return p ? { x: p.x, y: p.y } : null;
};

async function makePair(policy?: InterestPolicy) {
    const serverApp = makeApp();
    const clientApp = makeApp();
    const server = serverApp.getResource(Net).startServer();
    if (policy) server.setInterestPolicy(policy);
    const [ta, tb] = MemoryTransport.pair();
    const connId = server.attachConnection(ta);
    const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
    return { serverApp, clientApp, server, client, connId };
}

function spawnAt(app: App, name: string, x: number, y: number, owner = 0): Entity {
    const e = app.world.spawn(name);
    app.world.insert(e, Replicated, { owner });
    app.world.insert(e, NetPos, { x, y });
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
        serverApp.world.set(near, NetPos, { x: 400, y: 0 });
        await step(serverApp, clientApp);
        expect(ghostNames(clientApp)).toEqual(['pawn']);

        // `far` wanders in — while out of interest it also changed y; the
        // respawn must carry CURRENT state, not the state at first spawn.
        serverApp.world.set(far, NetPos, { x: 80, y: 33 });
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
        serverApp.world.set(far, NetPos, { x: 510, y: 5 });
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
