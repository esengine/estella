// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  RC11 N5: the authoritative-host story over a real network stack —
 *        a headless server App (createHeadlessApp, real wasm, no renderer)
 *        accepts a `ws` WebSocket connection; the client rides GameSocket on
 *        the global WebSocket. Same engine, same gameplay code, loopback TCP
 *        in between.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { App } from '../src/app/app';
import { createHeadlessApp } from '../src/runtime/webAppFactory';
import { defineComponent, clearUserComponents, Transform } from '../src/ecs/component';
import type { ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';
import { GameSocket } from '../src/net/GameSocket';
import type { NetTransport } from '../src/net/NetChannel';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
import { setPlatform } from '../src/platform/base';
import { nodeAdapter } from '../src/platform/node';

// What the esengine/node entry does for a real server host.
setPlatform(nodeAdapter);

const STEP = 1 / 60;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Server-side end of one accepted `ws` connection as a NetTransport. */
function wsServerTransport(conn: WsSocket): NetTransport {
    const handlers = new Set<(d: string | ArrayBuffer) => void>();
    conn.on('message', (data, isBinary) => {
        const frame = isBinary
            ? (() => {
                const buf = data as Buffer;
                return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
            })()
            : data.toString();
        for (const h of [...handlers]) h(frame);
    });
    return {
        send: (d) => conn.send(d),
        on: (_event, handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
    };
}

describe.skipIf(!HAS_WASM)('replication e2e over real WebSocket', () => {
    let module: ESEngineModule;
    let wss: WebSocketServer;
    let port: number;

    beforeAll(async () => {
        module = await loadWasmModule();
        wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
        await new Promise<void>((r) => wss.on('listening', () => r()));
        port = (wss.address() as { port: number }).port;
    });

    afterAll(async () => {
        await new Promise<void>((r) => wss.close(() => r()));
    });

    it('a headless server replicates to a socket client end-to-end', async () => {
        clearUserComponents();
        const NetHealth = defineComponent('NetHealth', { hp: 100 }, { replicatedFields: ['hp'] });

        // The authoritative host: headless factory, real wasm, no renderer.
        const serverApp = createHeadlessApp(module);
        const server = serverApp.getResource(Net).startServer();
        wss.on('connection', (conn) => server.attachConnection(wsServerTransport(conn)));

        // The client rides the same socket class shipped games use.
        const clientApp = App.new();
        const clientRegistry = new (module as any).Registry();
        clientApp.connectCpp(clientRegistry, module);
        clientApp.addPlugin(replicationPlugin);

        const socket = new GameSocket({ url: `ws://127.0.0.1:${port}` });
        socket.connect();
        const client = await clientApp.getResource(Net).connect(socket, { interpolationDelayTicks: 0 });
        expect(client.connected).toBe(true);

        // Authoritative spawn: an annotated builtin + a user component.
        const e = serverApp.world.spawn('boss');
        serverApp.world.insert(e, Transform, { position: { x: 64, y: -8, z: 0 } });
        serverApp.world.insert(e, NetHealth, { hp: 250 });
        serverApp.world.insert(e, Replicated, {});
        await serverApp.tick(STEP);

        await delay(50); // real network delivery
        await clientApp.tick(STEP);

        const ghosts = clientApp.world.getEntitiesWithComponents([Replicated]);
        expect(ghosts).toHaveLength(1);
        const ghost = ghosts[0];
        expect(clientApp.world.tryGet(ghost, Transform)!.position.x).toBe(64);
        expect(clientApp.world.tryGet(ghost, NetHealth)!.hp).toBe(250);

        // Authoritative mutation streams as a binary delta over the wire.
        const t = serverApp.world.tryGet(e, Transform)!;
        t.position.x = -128.5;
        serverApp.world.set(e, Transform, t);
        const h = serverApp.world.tryGet(e, NetHealth)!;
        h.hp = 1;
        serverApp.world.set(e, NetHealth, h);
        await serverApp.tick(STEP);

        await delay(50);
        await clientApp.tick(STEP);
        expect(clientApp.world.tryGet(ghost, Transform)!.position.x).toBe(-128.5);
        expect(clientApp.world.tryGet(ghost, NetHealth)!.hp).toBe(1);

        // Input uplink back over the same socket.
        client.sendInput({ fire: true });
        await delay(50);
        const connId = client.connectionId;
        expect(server.inputOf(connId)!.actions).toEqual({ fire: true });

        client.disconnect();
        socket.close();
    });
});
