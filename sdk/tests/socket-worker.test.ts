// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A replication server whose sockets live on a worker thread.
 *
 * The client is an ordinary GameSocket; the server end of each link is a
 * transport the worker hands over. Everything that crosses the thread — the
 * hello, state frames, game messages, a close from either side, a client that
 * drops and redials — must arrive as it would from a socket on the main thread.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { GameSocket } from '../src/net/GameSocket';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
import { startSocketWorker, type SocketWorker } from '../src/net/socketWorker';

const STEP = 1 / 60;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wsPath = createRequire(path.join(__dirname, '..', 'package.json')).resolve('ws');

async function until(done: () => boolean, apps: App[] = [], ms = 3000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (done()) return true;
        for (const a of apps) await a.tick(STEP);
        await delay(5);
    }
    return done();
}

let sockets: SocketWorker | null = null;
let ticking: ReturnType<typeof setInterval> | null = null;
beforeEach(() => clearUserComponents());
afterEach(async () => {
    if (ticking) clearInterval(ticking);
    ticking = null;
    await sockets?.close();
    sockets = null;
});

async function boot() {
    const Hp = defineComponent('WorkerHp', { hp: 0 }, { replicatedFields: ['hp'] });
    const serverApp = App.new();
    serverApp.addPlugin(replicationPlugin);
    const server = serverApp.getResource(Net).startServer({ authenticate: (c) => ({ playerId: (c as { t: string }).t }) });
    sockets = await startSocketWorker({ port: 0, host: '127.0.0.1', wsPath });
    const closes: number[] = [];
    sockets.onConnection((transport) => {
        const link = server.attachConnection(transport);
        transport.onClose((code) => { closes.push(code); server.detachConnection(link); });
    });
    ticking = setInterval(() => { void serverApp.tick(STEP); }, 16);
    const url = `ws://127.0.0.1:${sockets.port}`;
    return { Hp, serverApp, server, url, closes };
}

async function connect(url: string, token: string) {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const socket = new GameSocket({ url });
    socket.connect();
    const client = await app.getResource(Net).connect(socket, {
        interpolationDelayTicks: 0, credentials: { t: token }, reconnect: { minDelayMs: 20, maxDelayMs: 100 },
    });
    return { app, client, socket };
}

describe('a replication server with its sockets on a worker thread', () => {
    it('says hello, replicates state and carries game messages both ways', async () => {
        const { Hp, serverApp, server, url } = await boot();
        const heard: unknown[] = [];
        server.onMessage('ping', (_id, d) => heard.push(d));
        const ana = await connect(url, 'ana');
        expect(ana.client.playerId).toBe('ana');
        const e = serverApp.world.spawn('crate');
        serverApp.world.insert(e, Hp, { hp: 3 });
        serverApp.world.insert(e, Replicated, {});
        const crate = () => ana.app.world.getEntitiesWithComponents([Replicated])
            .find((g) => (ana.app.world.tryGet(g, Name) as { value: string } | null)?.value === 'crate');
        expect(await until(() => crate() !== undefined, [ana.app])).toBe(true);
        serverApp.world.update(e, Hp, (d) => { (d as { hp: number }).hp = 9; });
        expect(await until(() => (ana.app.world.tryGet(crate()!, Hp) as { hp: number }).hp === 9, [ana.app])).toBe(true);

        const got: unknown[] = [];
        ana.client.onMessage('pong', (d) => got.push(d));
        ana.client.message('ping', { n: 1 });
        expect(await until(() => heard.length === 1)).toBe(true);
        server.message(ana.client.connectionId, 'pong', { n: 2 });
        expect(await until(() => got.length === 1)).toBe(true);
        expect(heard).toEqual([{ n: 1 }]);
        expect(got).toEqual([{ n: 2 }]);
        ana.client.disconnect();
        ana.socket.close();
    });

    it('hears a client that leaves, and closes one the server lets go', async () => {
        const { server, url, closes } = await boot();
        const ana = await connect(url, 'ana');
        const bo = await connect(url, 'bo');
        ana.client.disconnect();
        ana.socket.close();
        expect(await until(() => closes.length === 1)).toBe(true);
        expect(server.kick(bo.client.connectionId, 'bye')).toBe(true);
        expect(await until(() => bo.client.state === 'closed')).toBe(true);
        expect(bo.client.closeReason).toBe('kicked');
        expect(await until(() => closes.length === 2)).toBe(true);
        expect(server.connectionCount).toBe(0);
    });

    it('lets a client that dropped redial to the same id', async () => {
        const { server, url } = await boot();
        const ana = await connect(url, 'ana');
        const id = ana.client.connectionId;
        // The link drops under the client.
        (ana.socket as unknown as { ws_: { close(): void } }).ws_.close();
        expect(await until(() => ana.client.state === 'reconnecting', [ana.app])).toBe(true);
        expect(await until(() => ana.client.state === 'ready', [ana.app])).toBe(true);
        expect(ana.client.connectionId).toBe(id);
        expect(server.clientIds).toEqual([id]);
        ana.client.disconnect();
        ana.socket.close();
    });
});
