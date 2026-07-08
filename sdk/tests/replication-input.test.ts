// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  RC11 N4: input uplink + ownership. Clients send seq-stamped input
 *        commands; the server keeps the latest per connection, gameplay
 *        applies it to the entities that connection owns (Replicated.owner),
 *        and the authoritative result replicates back — the full loop in one
 *        process.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app';
import { defineComponent, clearUserComponents } from '../src/component';
import { defineSystem, Schedule, GetWorld } from '../src/system';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';

const STEP = 1 / 60;

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0 }, { replicatedFields: ['x', 'y'] });
});

function makeApp(): App {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    return app;
}

describe('input uplink', () => {
    it('the server sees the latest command; stale seq never overwrites', async () => {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        const connId = server.attachConnection(ta);
        const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });

        expect(server.inputOf(connId)).toBeNull();

        client.sendInput({ move: { x: 1, y: 0 }, jump: false });
        client.sendInput({ move: { x: 0, y: 1 }, jump: true });
        const latest = server.inputOf(connId)!;
        expect(latest.actions).toEqual({ move: { x: 0, y: 1 }, jump: true });
        expect(latest.seq).toBe(2);
    });

    it('drives the full loop: input → owned entity moves on the server → ghost follows', async () => {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        const connId = server.attachConnection(ta);
        const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });

        // Server gameplay: each fixed tick, apply each connection's input to
        // the entities it owns — plain ECS code against the server resource.
        serverApp.addSystemToSchedule(Schedule.FixedUpdate, defineSystem(
            [GetWorld()],
            (world) => {
                for (const e of world.getEntitiesWithComponents([Replicated, NetPos])) {
                    const repl = world.tryGet(e, Replicated)!;
                    if (repl.owner === 0) continue;
                    const input = server.inputOf(repl.owner);
                    const move = input?.actions.move as { x: number; y: number } | undefined;
                    if (!move) continue;
                    const pos = world.tryGet(e, NetPos)!;
                    pos.x += move.x * 10;
                    pos.y += move.y * 10;
                    world.set(e, NetPos, pos);
                }
            },
            { name: 'ApplyPlayerInput' },
        ));

        // The player entity, owned by the client's connection.
        const player = serverApp.world.spawn('player');
        serverApp.world.insert(player, Replicated, { owner: connId });
        serverApp.world.insert(player, NetPos, {});

        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];
        expect(client.ownsEntity(ghost)).toBe(true);

        // Hold "right" for three ticks.
        client.sendInput({ move: { x: 1, y: 0 } });
        for (let i = 0; i < 3; i++) {
            await serverApp.tick(STEP);
            await clientApp.tick(STEP);
        }
        expect(serverApp.world.tryGet(player, NetPos)!.x).toBe(30);
        expect(clientApp.world.tryGet(ghost, NetPos)!.x).toBe(30);

        // Release: server stops integrating, ghost stays put.
        client.sendInput({});
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(clientApp.world.tryGet(ghost, NetPos)!.x).toBe(30);
    });

    it('ownership is per connection: a second client does not own the first player', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();

        const clientA = makeApp();
        const [a1, a2] = MemoryTransport.pair();
        const connA = server.attachConnection(a1);
        const ca = await clientA.getResource(Net).connect(a2, { interpolationDelayTicks: 0 });

        const clientB = makeApp();
        const [b1, b2] = MemoryTransport.pair();
        server.attachConnection(b1);
        const cb = await clientB.getResource(Net).connect(b2, { interpolationDelayTicks: 0 });

        const player = serverApp.world.spawn('playerA');
        serverApp.world.insert(player, Replicated, { owner: connA });
        serverApp.world.insert(player, NetPos, {});
        await serverApp.tick(STEP);
        await clientA.tick(STEP);
        await clientB.tick(STEP);

        const ghostA = clientA.world.getEntitiesWithComponents([Replicated])[0];
        const ghostB = clientB.world.getEntitiesWithComponents([Replicated])[0];
        expect(ca.ownsEntity(ghostA)).toBe(true);
        expect(cb.ownsEntity(ghostB)).toBe(false);
    });
});
