// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Client-side prediction + reconciliation: owned entities respond to input
 * immediately (before any server round trip), unacknowledged commands replay
 * on top of every authoritative update (authority ⊕ replay), server-side
 * corrections win, and mispredictions can never accumulate because the live
 * state is rebuilt from the authority copy every fixed step. The server's
 * per-tick input queue (tickInputOf) is the exactly-once contract that makes
 * the replay deterministic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app';
import { defineComponent, clearUserComponents } from '../src/component';
import { defineSystem, Schedule, GetWorld } from '../src/system';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, type ReplicationServer } from '../src/net/replication';
import type { Entity } from '../src/types';
import type { World } from '../src/world';

const STEP = 1 / 60;
const SPEED = 600; // units/second → 10 units per tick

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0 }, { replicatedFields: ['x', 'y'] });
});

/** The ONE movement function both ends run — the single source of the rules. */
function applyMove(world: World, entity: Entity, actions: Record<string, unknown>, dt: number): void {
    const move = actions.move as { x: number; y: number } | undefined;
    if (!move) return;
    const pos = world.tryGet(entity, NetPos) as { x: number; y: number } | null;
    if (!pos) return;
    pos.x += move.x * SPEED * dt;
    pos.y += move.y * SPEED * dt;
    world.set(entity, NetPos, pos);
}

function makeApp(): App {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    return app;
}

/** Server gameplay: apply each connection's PER-TICK input to its entities. */
function addServerInputSystem(serverApp: App, server: ReplicationServer): void {
    serverApp.addSystemToSchedule(Schedule.FixedUpdate, defineSystem(
        [GetWorld()],
        (world) => {
            for (const e of world.getEntitiesWithComponents([Replicated])) {
                const repl = world.tryGet(e, Replicated)!;
                if (repl.owner === 0) continue;
                const input = server.tickInputOf(repl.owner);
                if (input) applyMove(world as World, e as Entity, input.actions, STEP);
            }
        },
        { name: 'ApplyPlayerInput' },
    ));
}

async function makePredictedPair(interpolationDelayTicks = 0) {
    const serverApp = makeApp();
    const clientApp = makeApp();
    const server = serverApp.getResource(Net).startServer();
    addServerInputSystem(serverApp, server);
    const [ta, tb] = MemoryTransport.pair();
    const connId = server.attachConnection(ta);
    const client = await clientApp.getResource(Net).connect(tb, {
        interpolationDelayTicks,
        prediction: { apply: applyMove },
    });

    const pawn = serverApp.world.spawn('pawn');
    serverApp.world.insert(pawn, Replicated, { owner: connId });
    serverApp.world.insert(pawn, NetPos, {});
    await serverApp.tick(STEP);
    await clientApp.tick(STEP);
    const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];
    expect(client.ownsEntity(ghost)).toBe(true);
    return { serverApp, clientApp, server, client, connId, pawn, ghost };
}

const posX = (app: App, e: Entity): number => (app.world.tryGet(e, NetPos) as { x: number }).x;

describe('client prediction', () => {
    it('an owned entity moves the moment input is sent — no server round trip', async () => {
        const { serverApp, clientApp, pawn, ghost, client } = await makePredictedPair();

        client.sendInput({ move: { x: 1, y: 0 } });
        expect(posX(clientApp, ghost)).toBeCloseTo(10, 5); // immediately
        expect(posX(serverApp, pawn)).toBe(0);             // server hasn't ticked

        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(posX(serverApp, pawn)).toBeCloseTo(10, 5);
        expect(posX(clientApp, ghost)).toBeCloseTo(10, 5); // converged, no rubber-band
    });

    it('prediction stays ahead under latency and converges exactly when acks land', async () => {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        addServerInputSystem(serverApp, server);
        const [ta, tb] = MemoryTransport.pair({ manualFlush: true });
        const connId = server.attachConnection(ta);
        const connectP = clientApp.getResource(Net).connect(tb, {
            interpolationDelayTicks: 0,
            prediction: { apply: applyMove },
        });
        for (let i = 0; i < 8; i++) { ta.flush(); tb.flush(); await Promise.resolve(); }
        const client = await connectP;

        const pawn = serverApp.world.spawn('pawn');
        serverApp.world.insert(pawn, Replicated, { owner: connId });
        serverApp.world.insert(pawn, NetPos, {});
        await serverApp.tick(STEP);
        ta.flush(); tb.flush();
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];

        // Three inputs while the wire is held: the client is 3 ticks ahead.
        for (let i = 0; i < 3; i++) client.sendInput({ move: { x: 1, y: 0 } });
        expect(posX(clientApp, ghost)).toBeCloseTo(30, 5);
        expect(posX(serverApp, pawn)).toBe(0);

        // Release the wire: the server consumes the queue one command per tick.
        ta.flush(); tb.flush();
        for (let i = 0; i < 3; i++) {
            await serverApp.tick(STEP);
            ta.flush(); tb.flush();
            await clientApp.tick(STEP);
        }
        expect(posX(serverApp, pawn)).toBeCloseTo(30, 5);
        expect(posX(clientApp, ghost)).toBeCloseTo(30, 5);
    });

    it('a server-side correction wins over the prediction', async () => {
        const { serverApp, clientApp, ghost, pawn, client } = await makePredictedPair();

        // Server-only rule the client's apply knows nothing about: a wall at x=25.
        serverApp.addSystemToSchedule(Schedule.FixedUpdate, defineSystem(
            [GetWorld()],
            (world) => {
                const pos = world.tryGet(pawn, NetPos) as { x: number; y: number } | null;
                if (pos && pos.x > 25) { pos.x = 25; world.set(pawn, NetPos, pos); }
            },
            { name: 'WallClamp' },
        ));

        for (let i = 0; i < 3; i++) client.sendInput({ move: { x: 1, y: 0 } });
        expect(posX(clientApp, ghost)).toBeCloseTo(30, 5); // optimistic

        for (let i = 0; i < 4; i++) {
            await serverApp.tick(STEP);
            await clientApp.tick(STEP);
        }
        expect(posX(serverApp, pawn)).toBeCloseTo(25, 5);
        expect(posX(clientApp, ghost)).toBeCloseTo(25, 5); // corrected
    });

    it('local tampering cannot drift: live state is rebuilt from authority every step', async () => {
        const { serverApp, clientApp, ghost, client } = await makePredictedPair();

        client.sendInput({ move: { x: 1, y: 0 } });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(posX(clientApp, ghost)).toBeCloseTo(10, 5);

        // A wayward local write to a predicted entity — the server sends no
        // new delta for x (it idles on the next command), yet reconciliation
        // snaps the value back to the authority copy.
        clientApp.world.set(ghost, NetPos, { x: 999, y: 0 });
        client.sendInput({ move: { x: 0, y: 0 } }); // the per-tick idle command
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(posX(clientApp, ghost)).toBeCloseTo(10, 5);
    });

    it('non-owned entities are untouched by prediction and still replicate', async () => {
        const { serverApp, clientApp, client, server } = await makePredictedPair();

        const npc = serverApp.world.spawn('npc');
        serverApp.world.insert(npc, Replicated, {});
        serverApp.world.insert(npc, NetPos, { x: 100, y: 0 });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const npcGhost = clientApp.world.getEntitiesWithComponents([Replicated])
            .find((e) => !client.ownsEntity(e))!;
        expect(posX(clientApp, npcGhost)).toBe(100);

        client.sendInput({ move: { x: 1, y: 0 } });
        expect(posX(clientApp, npcGhost)).toBe(100); // prediction never touches it

        serverApp.world.set(npc, NetPos, { x: 120, y: 0 });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(posX(clientApp, npcGhost)).toBe(120); // normal replication path
        void server;
    });

    it('prediction bypasses snapshot interpolation for owned entities', async () => {
        const { clientApp, ghost, client } = await makePredictedPair(/* interpolationDelayTicks */ 2);
        client.sendInput({ move: { x: 1, y: 0 } });
        // With a 2-tick presentation delay a ghost would lag; the owned pawn moves NOW.
        expect(posX(clientApp, ghost)).toBeCloseTo(10, 5);
    });
});

describe('correction smoothing', () => {
    async function makeSmoothedPair(smoothing: { halfLife: number; maxError?: number }) {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        addServerInputSystem(serverApp, server);
        const [ta, tb] = MemoryTransport.pair();
        const connId = server.attachConnection(ta);
        const client = await clientApp.getResource(Net).connect(tb, {
            interpolationDelayTicks: 0,
            prediction: { apply: applyMove, smoothing },
        });
        const pawn = serverApp.world.spawn('pawn');
        serverApp.world.insert(pawn, Replicated, { owner: connId });
        serverApp.world.insert(pawn, NetPos, {});
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];
        return { serverApp, clientApp, server, client, pawn, ghost };
    }

    it('eases a correction out instead of snapping, and converges on the authority', async () => {
        // Error halves every 4 ticks — slow enough to observe.
        const { serverApp, clientApp, pawn, ghost, client } = await makeSmoothedPair({ halfLife: 4 * STEP });

        // Server-only wall at x=25; the client optimistically predicts to 30.
        serverApp.addSystemToSchedule(Schedule.FixedUpdate, defineSystem(
            [GetWorld()],
            (world) => {
                const pos = world.tryGet(pawn, NetPos) as { x: number; y: number } | null;
                if (pos && pos.x > 25) { pos.x = 25; world.set(pawn, NetPos, pos); }
            },
            { name: 'WallClamp' },
        ));
        for (let i = 0; i < 3; i++) client.sendInput({ move: { x: 1, y: 0 } });
        expect(posX(clientApp, ghost)).toBeCloseTo(30, 5);

        // While the replay still accounts for the prediction there is NO error
        // (deterministic replay); the correction materialises the tick the
        // server clamps — and lands BETWEEN authority (25) and prediction (30).
        for (let i = 0; i < 3; i++) {
            await serverApp.tick(STEP);
            await clientApp.tick(STEP);
        }
        const eased = posX(clientApp, ghost);
        expect(eased).toBeGreaterThan(25.5);
        expect(eased).toBeLessThan(30);

        // The error decays monotonically to the authoritative value.
        let prev = eased;
        for (let i = 0; i < 40; i++) {
            await serverApp.tick(STEP);
            await clientApp.tick(STEP);
            const x = posX(clientApp, ghost);
            expect(x).toBeLessThanOrEqual(prev + 1e-6);
            prev = x;
        }
        expect(prev).toBeCloseTo(25, 1);
    });

    it('a correction beyond maxError snaps — a teleport must look like one', async () => {
        const { serverApp, clientApp, pawn, ghost, client } = await makeSmoothedPair({ halfLife: 4 * STEP, maxError: 50 });

        client.sendInput({ move: { x: 1, y: 0 } });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(posX(clientApp, ghost)).toBeCloseTo(10, 5);

        // The server teleports the pawn far beyond maxError.
        serverApp.world.set(pawn, NetPos, { x: 500, y: 0 });
        client.sendInput({ move: { x: 0, y: 0 } });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(posX(clientApp, ghost)).toBeCloseTo(500, 5); // no easing
    });
});

describe('late enablePrediction (host-connected realms)', () => {
    it('seeds authority for already-spawned owned entities and predicts from then on', async () => {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        addServerInputSystem(serverApp, server);
        const [ta, tb] = MemoryTransport.pair();
        const connId = server.attachConnection(ta);
        // Connected WITHOUT prediction — the editor-host shape.
        const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });

        const pawn = serverApp.world.spawn('pawn');
        serverApp.world.insert(pawn, Replicated, { owner: connId });
        serverApp.world.insert(pawn, NetPos, { x: 5, y: 0 });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];

        expect(client.predictionEnabled).toBe(false);
        client.enablePrediction({ apply: applyMove });
        expect(client.predictionEnabled).toBe(true);

        // Immediate local movement…
        client.sendInput({ move: { x: 1, y: 0 } });
        expect(posX(clientApp, ghost)).toBeCloseTo(15, 5);

        // …and the late seed holds the authority baseline: a tampered value
        // snaps back even though the server never re-sends it.
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        clientApp.world.set(ghost, NetPos, { x: 999, y: 0 });
        client.sendInput({ move: { x: 0, y: 0 } });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(posX(clientApp, ghost)).toBeCloseTo(15, 5);
    });
});

describe('per-tick input queue (tickInputOf)', () => {
    it('consumes exactly one command per tick, repeats on starvation, and inputOf stays latest', async () => {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        const connId = server.attachConnection(ta);
        const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });

        client.sendInput({ n: 1 });
        client.sendInput({ n: 2 });
        expect(server.inputOf(connId)!.seq).toBe(2);      // latest-persists, unchanged
        expect(server.tickInputOf(connId)).toBeNull();    // nothing consumed yet

        await serverApp.tick(STEP);
        expect(server.tickInputOf(connId)!.actions).toEqual({ n: 1 });
        await serverApp.tick(STEP);
        expect(server.tickInputOf(connId)!.actions).toEqual({ n: 2 });
        await serverApp.tick(STEP); // queue dry → the held command repeats
        expect(server.tickInputOf(connId)!.actions).toEqual({ n: 2 });
    });
});
