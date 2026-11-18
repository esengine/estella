// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A dropped player redials by themselves, over a real socket.
 *
 * The server end is a `ws` server handing sockets over through
 * `webSocketTransport`; the client rides `GameSocket` with `reconnect` on. The
 * network drop is the server tearing the TCP connection down without a word,
 * which is what a phone changing networks looks like from either end.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { GameSocket } from '../src/net/GameSocket';
import { replicationPlugin, Net, Replicated, webSocketTransport } from '../src/net/replication';
import type { ReplicationClient } from '../src/net/replication';
import type { Entity } from '../src/types';

const STEP = 1 / 60;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let wss: WebSocketServer;
let url: string;
let sockets: WsSocket[];
let serverApp: App;
let ticking: ReturnType<typeof setInterval>;

beforeEach(async () => {
    clearUserComponents();
    defineComponent('NetHp', { hp: 100 }, { replicatedFields: ['hp'] });
    serverApp = App.new();
    serverApp.addPlugin(replicationPlugin);
    const server = serverApp.getResource(Net).startServer({
        authenticate: (c) => ({ playerId: (c as { token: string }).token }),
    });
    sockets = [];
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
    wss.on('connection', (socket) => {
        sockets.push(socket);
        const link = server.attachConnection(webSocketTransport(socket));
        socket.on('close', () => server.detachConnection(link));
    });
    ticking = setInterval(() => { void serverApp.tick(STEP); }, 16);
});

afterEach(async () => {
    clearInterval(ticking);
    for (const s of sockets) s.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
});

async function player(token: string) {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    const socket = new GameSocket({ url });
    socket.connect();
    const client = await app.getResource(Net).connect(socket, {
        interpolationDelayTicks: 0, credentials: { token }, reconnect: { minDelayMs: 20, maxDelayMs: 100 },
    });
    return { app, client, socket };
}

async function until(done: () => boolean, apps: App[], ms = 3000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (done()) return true;
        for (const a of apps) await a.tick(STEP);
        await delay(10);
    }
    return done();
}

const ghost = (app: App, name: string): Entity | undefined =>
    app.world.getEntitiesWithComponents([Replicated])
        .find((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value === name);

describe('reconnect over a real socket', () => {
    it('redials after a drop and lands on the same id and the same ghosts', async () => {
        const ana = await player('ana');
        const id = ana.client.connectionId;
        const e = serverApp.world.spawn('pawn');
        serverApp.world.insert(e, Replicated, { owner: id });
        expect(await until(() => ghost(ana.app, 'pawn') !== undefined, [ana.app])).toBe(true);
        const held = ghost(ana.app, 'pawn');

        const states: string[] = [];
        sockets[0].terminate();
        expect(await until(() => { states.push(ana.client.state); return ana.client.state === 'reconnecting'; }, [ana.app])).toBe(true);
        expect(await until(() => ana.client.state === 'ready', [ana.app])).toBe(true);

        expect(ana.client.connectionId).toBe(id);
        expect(sockets).toHaveLength(2);
        await until(() => false, [ana.app], 100);
        expect(ghost(ana.app, 'pawn')).toBe(held);
        expect(ana.client.ownsEntity(held!)).toBe(true);
        ana.client.disconnect();
        ana.socket.close();
    });

    it('a replaced login stays closed instead of taking the seat back', async () => {
        const first = await player('ana');
        const second = await player('ana');
        expect(await until(() => first.client.state === 'closed', [first.app, second.app])).toBe(true);
        expect(first.client.closeReason).toBe('replaced');
        // Long enough for several redials, were it to try.
        await until(() => false, [first.app, second.app], 400);
        expect(first.client.state).toBe('closed');
        expect(second.client.state).toBe('ready');
        expect(sockets).toHaveLength(2);
        second.client.disconnect();
        second.socket.close();
    });

    it('fails a hello at once when nothing is listening, not at the request timeout', async () => {
        const app = App.new();
        app.addPlugin(replicationPlugin);
        // A port that was just listening and is not any more.
        const gone = new WebSocketServer({ port: 0, host: '127.0.0.1' });
        await new Promise<void>((r) => gone.on('listening', () => r()));
        const deadUrl = `ws://127.0.0.1:${(gone.address() as { port: number }).port}`;
        await new Promise<void>((r) => gone.close(() => r()));
        const socket = new GameSocket({ url: deadUrl });
        socket.connect();
        const t0 = Date.now();
        await expect(app.getResource(Net).connect(socket, { credentials: { token: 'x' } })).rejects.toThrow();
        expect(Date.now() - t0).toBeLessThan(3000);
    });

    it('keeps trying while the server is unreachable, and stops on disconnect', async () => {
        const ana = await player('ana');
        const refused: ReplicationClient = ana.client;
        // Stop accepting: every redial now fails at the socket.
        wss.removeAllListeners('connection');
        wss.on('connection', (s) => s.terminate());
        sockets[0].terminate();
        await until(() => false, [ana.app], 300);
        expect(refused.state).toBe('reconnecting');
        expect(sockets.length).toBe(1);
        refused.disconnect();
        expect(refused.state).toBe('closed');
        ana.socket.close();
    });

    it('notices a server that went quiet without closing, and redials', async () => {
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const socket = new GameSocket({ url });
        socket.connect();
        const client = await app.getResource(Net).connect(socket, {
            interpolationDelayTicks: 0, credentials: { token: 'ana' },
            reconnect: { minDelayMs: 20, maxDelayMs: 100 },
            heartbeat: { intervalMs: 20, timeoutMs: 150 },
        });
        expect(client.state).toBe('ready');
        // Half-open: the server neither reads nor sends on this link any more,
        // and the socket stays open — nothing at the TCP level says so.
        clearInterval(ticking);
        (sockets[0] as unknown as { _socket: { pause(): void } })._socket.pause();
        expect(await until(() => client.state === 'reconnecting', [app], 2000)).toBe(true);
        expect(await until(() => client.state === 'ready', [app], 2000)).toBe(true);
        expect(sockets).toHaveLength(2);
        client.disconnect();
    });
});
