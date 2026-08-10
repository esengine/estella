// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a runtime spawn belongs to.
 *
 * An entity a scene authored is retired with that scene. One spawned into it
 * from a prefab — a bullet, a called minion, a dropped pickup — had no owner at
 * all, so it survived every switch and piled up in whatever room came next. It
 * now belongs to the scene that was live when it landed.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrefabData } from '../src/prefab';
import type { Entity } from '../src/types';

const SPAWNED = [11, 12] as Entity[];
vi.mock('../src/prefab', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/prefab')>()),
    instantiatePrefab: async () => ({ root: SPAWNED[0], entities: new Map([[0, SPAWNED[0]], [1, SPAWNED[1]]]) }),
}));

const { PrefabServer } = await import('../src/prefab/prefabServer');

const PREFAB: PrefabData = {
    version: '2',
    name: 'Wisp',
    rootEntityId: 'root',
    entities: [
        { prefabEntityId: 'root', name: 'Wisp', parent: null, children: [], components: {}, visible: true },
    ],
} as unknown as PrefabData;

function scenes(active: string | null): { manager: unknown; adopted: Entity[] } {
    const adopted: Entity[] = [];
    const ctx = { adopt: (e: Entity) => { adopted.push(e); } };
    return {
        manager: {
            getActive: () => active,
            getScene: (name: string) => (name === active ? ctx : null),
        },
        adopted,
    };
}

const spawn = async (active: string | null, opts?: { scene?: boolean }): Promise<Entity[]> => {
    const { manager, adopted } = scenes(active);
    const assets = { loadPrefab: async () => ({ data: PREFAB }) };
    const server = new PrefabServer({} as never, () => assets as never, () => manager as never);
    await server.instantiate('assets/prefabs/Wisp.esprefab', opts);
    return adopted;
};

describe('PrefabServer.instantiate ownership', () => {
    it('hands every spawned entity to the live scene', async () => {
        expect(await spawn('spire')).toEqual(SPAWNED);
    });

    it('leaves the spawn ownerless when asked', async () => {
        expect(await spawn('spire', { scene: false })).toEqual([]);
    });

    it('spawns fine with no scene running at all', async () => {
        expect(await spawn(null)).toEqual([]);
    });
});
