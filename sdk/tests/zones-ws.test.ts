// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A transfer over real sockets: two zone servers on two ports, a client
 *        on GameSocket whose `dial` opens a GameSocket to wherever it is sent.
 *        After the move, a dropped link redials the NEW zone, as an ordinary
 *        reconnect — the one-use ticket is not shown twice.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { App } from '../src/app/app';
import { clearUserComponents, Name } from '../src/ecs/component';
import { GameSocket } from '../src/net/GameSocket';
import { replicationPlugin, Net, Replicated, webSocketTransport } from '../src/net/replication';
import { MemoryStore, type PersistStore } from '../src/persist';
import { ZoneHost } from '../src/zones';

const STEP = 1 / 60;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Running { wss: WebSocketServer; address: string; sockets: WsSocket[]; app: App; zone: ZoneHost; timer: ReturnType<typeof setInterval> }
let zones: Running[] = [];

async function zoneServer(id: string, store: PersistStore, landmark: string, arrivalLeaseMs?: number): Promise<Running> {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    const address = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const zone = new ZoneHost({ zone: { id, address }, store, arrivalLeaseMs, authenticate: (c) => ({ playerId: (c as { token: string }).token }) });
    const server = app.getResource(Net).startServer({ authenticate: zone.authenticate });
    zone.attach(server);
    await zone.start();
    const sockets: WsSocket[] = [];
    wss.on('connection', (socket) => {
        sockets.push(socket);
        const link = server.attachConnection(webSocketTransport(socket));
        socket.on('close', () => server.detachConnection(link));
    });
    const mark = app.world.spawn(landmark);
    app.world.insert(mark, Replicated, {});
    const timer = setInterval(() => { zone.tick(); void app.tick(STEP); }, 16);
    const running = { wss, address, sockets, app, zone, timer };
    zones.push(running);
    return running;
}

beforeEach(() => { clearUserComponents(); zones = []; });
afterEach(async () => {
    for (const z of zones) {
        clearInterval(z.timer);
        for (const s of z.sockets) s.terminate();
        await new Promise<void>((r) => z.wss.close(() => r()));
    }
});

async function until(done: () => boolean, apps: App[], ms = 3000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (done()) return true;
        for (const a of apps) await a.tick(STEP);
        await delay(10);
    }
    return done();
}

const sees = (app: App) => app.world.getEntitiesWithComponents([Replicated])
    .map((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value ?? '').sort();

describe('zones over real sockets', () => {
    it('moves a client to another server, and a later drop redials that one', async () => {
        const store = new MemoryStore();
        const A = await zoneServer('A', store, 'forest tree');
        const B = await zoneServer('B', store, 'town well');

        const app = App.new();
        app.addPlugin(replicationPlugin);
        const socket = new GameSocket({ url: A.address });
        socket.connect();
        const client = await app.getResource(Net).connect(socket, {
            interpolationDelayTicks: 0, credentials: { token: 'ana' },
            reconnect: { minDelayMs: 20, maxDelayMs: 100 },
            dial: (url) => new GameSocket({ url }),
        });
        expect(await until(() => sees(app).includes('forest tree'), [app])).toBe(true);

        await A.zone.transfer(client.connectionId, 'B');
        expect(await until(() => client.state === 'ready' && sees(app).includes('town well'), [app])).toBe(true);
        expect(sees(app)).toEqual(['town well']);
        expect(B.sockets).toHaveLength(1);
        const idInB = client.connectionId;

        // The network drops: the client redials B, not A, and needs no ticket.
        B.sockets[0]!.terminate();
        expect(await until(() => client.state === 'reconnecting', [app])).toBe(true);
        expect(await until(() => client.state === 'ready', [app])).toBe(true);
        expect(B.sockets).toHaveLength(2);
        expect(A.sockets).toHaveLength(1);
        expect(client.connectionId).toBe(idInB);
        client.disconnect();
    });

    it('comes back to the zone it left when the one it was sent to has just died', async () => {
        const store = new MemoryStore();
        const A = await zoneServer('A', store, 'forest tree', 200);
        // A port that was listening a moment ago: the zone there announced itself, then died.
        const gone = new WebSocketServer({ port: 0, host: '127.0.0.1' });
        await new Promise<void>((r) => gone.on('listening', () => r()));
        const deadAddress = `ws://127.0.0.1:${(gone.address() as { port: number }).port}`;
        await new Promise<void>((r) => gone.close(() => r()));
        await store.put('zone:C', { id: 'C', address: deadAddress, players: 0, seenAt: Date.now() });

        const app = App.new();
        app.addPlugin(replicationPlugin);
        const socket = new GameSocket({ url: A.address });
        socket.connect();
        const client = await app.getResource(Net).connect(socket, {
            interpolationDelayTicks: 0, credentials: { token: 'ana' },
            reconnect: { minDelayMs: 20, maxDelayMs: 100 },
            dial: (url) => new GameSocket({ url }),
        });
        expect(await until(() => sees(app).includes('forest tree'), [app])).toBe(true);
        const t0 = Date.now();
        await A.zone.transfer(client.connectionId, 'C');
        expect(await until(() => client.state !== 'ready', [app], 1000)).toBe(true);
        expect(await until(() => client.state === 'ready' && sees(app).includes('forest tree'), [app], 3000)).toBe(true);
        expect(Date.now() - t0).toBeLessThan(2000);
        expect((await A.zone.leases.get('ana'))!.zoneId).toBe('A');
        client.disconnect();
    });
});
