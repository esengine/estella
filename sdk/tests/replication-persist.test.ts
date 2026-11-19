// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A player's pawn outlives the server.
 *
 * The pattern the networking manual describes, end to end: the server knows
 * who a player is (`authenticate`), `PlayerPersistence` follows the players
 * present, a pawn is provisioned only once its player's record is loaded and is
 * built from it, and the record is written back from the pawn when the player
 * leaves. A second server App over the same directory is the restarted process.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, type ReplicationServer } from '../src/net/replication';
import { FileStore, PlayerPersistence, snapshotEntity, restoreEntity, type EntitySnapshot } from '../src/persist';
import type { Entity } from '../src/types';

const STEP = 1 / 60;
let dir: string;
let Spot: ReturnType<typeof defineComponent<{ x: number; y: number }>>;

beforeEach(() => {
    clearUserComponents();
    Spot = defineComponent('Spot', { x: 0, y: 0 }, { replicatedFields: ['x', 'y'] });
    dir = mkdtempSync(path.join(tmpdir(), 'estella-repl-persist-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

interface PlayerRecord { pawn: EntitySnapshot | null }

/** One server process: authority, player records, and the provisioning a game writes. */
function bootServer() {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const server = app.getResource(Net).startServer({
        authenticate: (c) => ({ playerId: (c as { token: string }).token }),
        reconnectGraceMs: 0,
    });
    const records = new PlayerPersistence<PlayerRecord>({
        store: new FileStore(dir), schema: 1, create: () => ({ pawn: null }),
    });
    const pawns = new Map<string, Entity>();
    const tick = async () => {
        const present = new Map<string, number>();
        for (const id of server.presentIds) present.set(server.playerIdOf(id)!, id);
        // Write leavers back from their pawn before the records let them go.
        for (const [playerId, pawn] of [...pawns]) {
            if (present.has(playerId)) continue;
            if (records.isReady(playerId)) records.set(playerId, { pawn: snapshotEntity(app.world, pawn, { include: ['Spot'] }) });
            app.world.despawn(pawn);
            pawns.delete(playerId);
        }
        records.track(present.keys());
        for (const [playerId, id] of present) {
            if (pawns.has(playerId) || !records.isReady(playerId)) continue;
            const saved = records.get(playerId)!.pawn;
            const pawn = app.world.spawn(`pawn ${playerId}`);
            app.world.insert(pawn, Spot, {});
            if (saved) restoreEntity(app.world, saved, pawn);
            app.world.insert(pawn, Replicated, { owner: id });
            pawns.set(playerId, pawn);
        }
        await app.tick(STEP);
    };
    return { app, server, records, pawns, tick };
}

async function join(server: ReplicationServer, token: string) {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const [a, b] = MemoryTransport.pair();
    const link = server.attachConnection(a);
    const client = await app.getResource(Net).connect(b, { interpolationDelayTicks: 0, credentials: { token } });
    return { app, client, link };
}

async function run(server: { tick: () => Promise<void> }, clients: App[], n: number) {
    for (let i = 0; i < n; i++) {
        await server.tick();
        for (const c of clients) await c.tick(STEP);
        await new Promise((r) => setTimeout(r, 0));
    }
}

/** Run until `done`, for a store on disk that answers when the machine lets it. */
async function runUntil(server: { tick: () => Promise<void> }, clients: App[], done: () => boolean, ms = 5000) {
    const end = Date.now() + ms;
    while (!done() && Date.now() < end) {
        await run(server, clients, 1);
        await new Promise((r) => setTimeout(r, 5));
    }
    return done();
}

describe('a pawn kept across a server restart', () => {
    it('comes back where its player left it', async () => {
        const first = bootServer();
        const ana = await join(first.server, 'ana');
        expect(await runUntil(first, [ana.app], () => first.pawns.has('ana'))).toBe(true);
        const pawn = first.pawns.get('ana')!;
        expect(pawn).toBeDefined();
        first.app.world.update(pawn, Spot, (d) => { Object.assign(d as object, { x: 12, y: -3 }); });
        await run(first, [ana.app], 2);

        first.server.detachConnection(ana.link);
        expect(await runUntil(first, [], () => first.pawns.size === 0 && first.records.pendingOperations === 0)).toBe(true);
        await first.records.flush();
        expect(first.pawns.size).toBe(0);

        const second = bootServer();
        const back = await join(second.server, 'ana');
        expect(await runUntil(second, [back.app], () => second.pawns.has('ana')
            && back.app.world.getEntitiesWithComponents([Replicated]).some((e) => back.client.ownsEntity(e)))).toBe(true);
        await run(second, [back.app], 2);
        const restored = second.pawns.get('ana')!;
        expect(second.app.world.tryGet(restored, Spot)).toEqual({ x: 12, y: -3 });
        // And the client sees it there, as its own.
        const ghost = back.app.world.getEntitiesWithComponents([Replicated]).find((e) => back.client.ownsEntity(e))!;
        expect(back.app.world.tryGet(ghost, Spot)).toEqual({ x: 12, y: -3 });
    });
});
