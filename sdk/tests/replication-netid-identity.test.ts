// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A network identity survives what the clients never saw.
 *
 * `Replicated.netId` is server-allocated and defaults to 0, so re-adding the
 * component hands the entity a blank one. If both the removal and the re-add
 * land inside one sampling window the clients never observed a departure —
 * so the identity they hold must still be the identity the server has.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
import type { Entity } from '../src/types';

const STEP = 1 / 60;

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
});

describe('Replicated removed and re-added inside one window', () => {
    it('keeps the NetId the clients were told', async () => {
        const serverApp = App.new();
        serverApp.addPlugin(replicationPlugin);
        const clientApp = App.new();
        clientApp.addPlugin(replicationPlugin);
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });

        const world = serverApp.world;
        const e: Entity = world.spawn();
        world.insert(e, Replicated, { owner: 0 });
        world.insert(e, NetPos, { x: 1, y: 0, z: 0 });
        await serverApp.tick(STEP); await clientApp.tick(STEP);

        const assigned = server.netIds.netIdOf(e);
        expect(assigned).toBeGreaterThan(0);
        const ghostsBefore = clientApp.world.getEntitiesWithComponents([Replicated]).length;

        // Out and back with no sample in between: nothing observed it leave.
        world.remove(e, Replicated);
        world.insert(e, Replicated, { owner: 0 });
        await serverApp.tick(STEP); await clientApp.tick(STEP);

        // Three records of one identity, and they have to agree.
        expect((world.get(e, Replicated) as { netId: number }).netId).toBe(assigned);
        expect(server.netIds.netIdOf(e)).toBe(assigned);
        expect(server.netIds.entityOf(assigned!)).toBe(e);
        // And the client saw no churn at all.
        expect(clientApp.world.getEntitiesWithComponents([Replicated]).length).toBe(ghostsBefore);
    });
});
