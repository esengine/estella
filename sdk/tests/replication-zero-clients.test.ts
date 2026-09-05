// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a client joining an already-running server is told.
 *
 * `sample()` returns early with no connections, so the replication registry
 * stops tracking the world while nobody is listening. The next client's initial
 * state is built from that registry — so whatever the world did in between has
 * to be reconciled before the first spawn batch goes out, or the client starts
 * from a world that no longer exists.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { defineComponent, clearUserComponents, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
import type { Entity } from '../src/types';

const STEP = 1 / 60;

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
});

const makeApp = (): App => { const a = App.new(); a.addPlugin(replicationPlugin); return a; };

function spawnAt(app: App, name: string, x: number): Entity {
    const e = app.world.spawn(name);
    app.world.insert(e, Replicated, { owner: 0 });
    app.world.insert(e, NetPos, { x, y: 0, z: 0 });
    return e;
}

const ghosts = (app: App): string[] =>
    app.world.getEntitiesWithComponents([Replicated])
        .map((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value ?? '')
        .sort();

const xOf = (app: App, name: string): number | undefined => {
    for (const e of app.world.getEntitiesWithComponents([Replicated])) {
        if ((app.world.tryGet(e, Name) as { value: string } | null)?.value === name) {
            return (app.world.tryGet(e, NetPos) as { x: number } | null)?.x;
        }
    }
    return undefined;
};

describe('a client that joins after the server ran with nobody connected', () => {
    it('is told the world as it is now, not as the last client left it', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();

        const stays = spawnAt(serverApp, 'stays', 10);
        const leaves = spawnAt(serverApp, 'leaves', 20);

        // A connects, sees both, and goes away.
        const appA = makeApp();
        const [sa, ca] = MemoryTransport.pair();
        const connA = server.attachConnection(sa);
        const clientA = await appA.getResource(Net).connect(ca, { interpolationDelayTicks: 0 });
        await serverApp.tick(STEP); await appA.tick(STEP);
        expect(ghosts(appA)).toEqual(['leaves', 'stays']);
        clientA.disconnect();
        server.detachConnection(connA);

        // The world moves on with nobody listening.
        serverApp.world.despawn(leaves);
        const joined = spawnAt(serverApp, 'joined', 30);
        serverApp.world.set(stays, NetPos, { x: 99, y: 0, z: 0 });
        for (let i = 0; i < 4; i++) await serverApp.tick(STEP);

        // B connects. What the INITIAL STATE says, before any later sample can
        // correct it: only the client ticks here, so this is the handshake alone.
        const appB = makeApp();
        const [sb, cb] = MemoryTransport.pair();
        server.attachConnection(sb);
        await appB.getResource(Net).connect(cb, { interpolationDelayTicks: 0 });
        await appB.tick(STEP);

        expect(ghosts(appB)).toEqual(['joined', 'stays']);
        expect(xOf(appB, 'stays')).toBe(99);
        expect(joined).toBeGreaterThan(0);
    });
});
