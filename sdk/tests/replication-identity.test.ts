// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Players, not connections.
 *
 * With `authenticate`, the server names who a connection is, and the id it
 * hands out belongs to that player rather than to the link: a reconnect gets
 * the same id back, so everything gameplay keyed by `Replicated.owner` carries
 * over; a dropped player stays present for a grace period; a second login
 * replaces the first; a kick ends it. Without `authenticate` nothing here
 * applies and a connection is anonymous and new, as it always was.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, type ReplicationServerOptions } from '../src/net/replication';
import type { ReplicationClient, ReplicationServer } from '../src/net/replication';
import { SessionRejected } from '../src/net/session';
import type { Entity } from '../src/types';

const STEP = 1 / 60;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let NetHp: ReturnType<typeof defineComponent<{ hp: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetHp = defineComponent('NetHp', { hp: 100 }, { replicatedFields: ['hp'] });
});

const tokens: ReplicationServerOptions['authenticate'] = (credentials) => {
    const token = (credentials as { token?: string } | undefined)?.token;
    if (token === 'banned') throw new SessionRejected('you are banned');
    if (!token) throw new Error('no token');
    return { playerId: token };
};

function makeServer(options?: ReplicationServerOptions) {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const server = app.getResource(Net).startServer(options);
    return { app, server };
}

/** One client app and the link it rides; `link` is the server-side id to detach by. */
async function join(server: ReplicationServer, credentials?: unknown) {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const [a, b] = MemoryTransport.pair();
    const link = server.attachConnection(a);
    const client = await app.getResource(Net).connect(b, { interpolationDelayTicks: 0, credentials });
    return { app, client, link };
}

/** Move a dropped client onto a fresh link with the same credentials. */
async function rejoin(server: ReplicationServer, client: ReplicationClient) {
    const [a, b] = MemoryTransport.pair();
    const link = server.attachConnection(a);
    await client.resume(b);
    return link;
}

function spawn(app: App, name: string, owner = -1, hp = 100): Entity {
    const e = app.world.spawn(name);
    app.world.insert(e, NetHp, { hp });
    app.world.insert(e, Replicated, { owner });
    return e;
}

const ghostByName = (app: App, name: string): Entity | undefined =>
    app.world.getEntitiesWithComponents([Replicated])
        .find((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value === name);

const hpOf = (app: App, e: Entity) => (app.world.tryGet(e, NetHp) as { hp: number }).hp;

async function step(apps: App[], n = 1) {
    for (let i = 0; i < n; i++) for (const a of apps) await a.tick(STEP);
}

describe('without authenticate', () => {
    it('stays anonymous: no player, a new id per link, nobody waited for', async () => {
        const { app, server } = makeServer();
        const c1 = await join(server);
        await step([app, c1.app]);
        expect(c1.client.playerId).toBeUndefined();
        expect(server.presentIds).toEqual(server.clientIds);
        server.detachConnection(c1.link);
        expect(server.presentIds).toEqual([]);
        const c2 = await join(server);
        expect(c2.client.connectionId).not.toBe(c1.client.connectionId);
    });
});

describe('with authenticate', () => {
    it('names the player and refuses who it throws for', async () => {
        const { server } = makeServer({ authenticate: tokens });
        const ok = await join(server, { token: 'ana' });
        expect(ok.client.playerId).toBe('ana');
        expect(server.playerIdOf(ok.client.connectionId)).toBe('ana');
        expect(server.connectionIdOf('ana')).toBe(ok.client.connectionId);
        await expect(join(server, { token: 'banned' })).rejects.toThrow('you are banned');
        await expect(join(server, {})).rejects.toThrow('no token');
    });

    it('keeps a dropped player present, then gives the same id back', async () => {
        const { app, server } = makeServer({ authenticate: tokens });
        const ana = await join(server, { token: 'ana' });
        const id = ana.client.connectionId;
        const pawn = spawn(app, 'pawn', id);
        await step([app, ana.app], 2);
        const ghost = ghostByName(ana.app, 'pawn')!;
        expect(ana.client.ownsEntity(ghost)).toBe(true);

        server.detachConnection(ana.link);
        expect(server.clientIds).toEqual([]);
        expect(server.presentIds).toEqual([id]);
        expect(server.isAway(id)).toBe(true);
        expect(server.tickInputOf(id)).toBeNull();

        // The world moves on while she is gone.
        app.world.update(pawn, NetHp, (d) => { (d as { hp: number }).hp = 42; });
        await step([app], 2);

        await rejoin(server, ana.client);
        expect(ana.client.connectionId).toBe(id);
        expect(server.isAway(id)).toBe(false);
        expect(server.clientIds).toEqual([id]);
        await step([app, ana.app], 2);
        // The same ghost entity, with the state it missed, still hers.
        expect(ghostByName(ana.app, 'pawn')).toBe(ghost);
        expect(hpOf(ana.app, ghost)).toBe(42);
        expect(ana.client.ownsEntity(ghost)).toBe(true);
    });

    it('reconciles held ghosts: what left is dropped, what came is spawned', async () => {
        const { app, server } = makeServer({ authenticate: tokens });
        const ana = await join(server, { token: 'ana' });
        const stays = spawn(app, 'stays');
        const leaves = spawn(app, 'leaves');
        await step([app, ana.app], 2);
        const staysGhost = ghostByName(ana.app, 'stays')!;
        expect(ghostByName(ana.app, 'leaves')).toBeDefined();

        server.detachConnection(ana.link);
        app.world.despawn(leaves);
        spawn(app, 'arrives');
        await step([app], 2);

        await rejoin(server, ana.client);
        await step([app, ana.app], 2);
        expect(ghostByName(ana.app, 'stays')).toBe(staysGhost);
        expect(ghostByName(ana.app, 'leaves')).toBeUndefined();
        expect(ghostByName(ana.app, 'arrives')).toBeDefined();
        expect(ana.app.world.getEntitiesWithComponents([Replicated])).toHaveLength(2);
        void stays;
    });

    it('forgets a player whose grace ran out', async () => {
        const { app, server } = makeServer({ authenticate: tokens, reconnectGraceMs: 5 });
        const ana = await join(server, { token: 'ana' });
        const id = ana.client.connectionId;
        server.detachConnection(ana.link);
        expect(server.presentIds).toEqual([id]);
        await delay(20);
        await step([app]);
        expect(server.presentIds).toEqual([]);
        expect(server.connectionIdOf('ana')).toBeUndefined();
        const again = await join(server, { token: 'ana' });
        expect(again.client.connectionId).not.toBe(id);
    });

    it('lets a dropped player go at once with no grace', async () => {
        const { server } = makeServer({ authenticate: tokens, reconnectGraceMs: 0 });
        const ana = await join(server, { token: 'ana' });
        server.detachConnection(ana.link);
        expect(server.presentIds).toEqual([]);
    });

    it('replaces the first login with the second, and tells the first', async () => {
        const { app, server } = makeServer({ authenticate: tokens });
        const first = await join(server, { token: 'ana' });
        await step([app, first.app]);
        const second = await join(server, { token: 'ana' });
        expect(second.client.connectionId).toBe(first.client.connectionId);
        expect(server.connectionCount).toBe(1);
        expect(first.client.state).toBe('closed');
        expect(first.client.closeReason).toBe('replaced');
        expect(second.client.state).toBe('ready');
        // The replaced link's own close, arriving late, must not touch the new one.
        server.detachConnection(first.link);
        expect(server.clientIds).toEqual([second.client.connectionId]);
    });

    it('kicks: the client is told, and the player is not waited for', async () => {
        const { app, server } = makeServer({ authenticate: tokens });
        const ana = await join(server, { token: 'ana' });
        const id = ana.client.connectionId;
        await step([app, ana.app]);
        expect(server.kick(id, 'cheating')).toBe(true);
        expect(ana.client.state).toBe('closed');
        expect(ana.client.closeReason).toBe('kicked');
        expect(server.presentIds).toEqual([]);
        server.detachConnection(ana.link);
        expect(server.kick(id)).toBe(false);
    });

    it('keeps two players apart', async () => {
        const { app, server } = makeServer({ authenticate: tokens });
        const ana = await join(server, { token: 'ana' });
        const bo = await join(server, { token: 'bo' });
        expect(ana.client.connectionId).not.toBe(bo.client.connectionId);
        server.detachConnection(ana.link);
        await rejoin(server, ana.client);
        await step([app, ana.app, bo.app]);
        expect(server.connectionIdOf('bo')).toBe(bo.client.connectionId);
        expect(server.clientIds.sort()).toEqual([ana.client.connectionId, bo.client.connectionId].sort());
    });
});
