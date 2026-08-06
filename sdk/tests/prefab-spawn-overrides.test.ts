// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The runtime spawn door's overrides: aimed at an entity the prefab has.
 *
 * `prefabEntityId` is a stable address inside the prefab, and an override that
 * names one nobody answers to used to be dropped in silence — every bullet then
 * spawns at the position the prefab was authored with, and nothing says why.
 * `'0'` is the id every prefab had before stable ids, so it is what the older
 * examples still show; a prefab saved since gets a uuid.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrefabData } from '../src/prefab';

const instantiateSpy = vi.fn(async () => ({ root: 1 as never, entities: new Map() }));
vi.mock('../src/prefab', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/prefab')>()),
    instantiatePrefab: (...args: unknown[]) => instantiateSpy(...(args as [])),
}));

const { PrefabServer } = await import('../src/prefab/prefabServer');

const PREFAB: PrefabData = {
    version: '2',
    name: 'Bullet',
    rootEntityId: 'aaaa-bbbb',
    entities: [
        { prefabEntityId: 'aaaa-bbbb', name: 'Bullet', parent: null, children: ['cccc-dddd'], components: {}, visible: true },
        { prefabEntityId: 'cccc-dddd', name: 'Trail', parent: 'aaaa-bbbb', children: [], components: {}, visible: true },
    ],
} as unknown as PrefabData;

const positionAt = (x: number, prefabEntityId?: string) => ({
    ...(prefabEntityId ? { prefabEntityId } : {}),
    type: 'property' as const,
    componentType: 'Transform',
    propertyName: 'position',
    value: { x, y: 0, z: 0 },
});

function server(): InstanceType<typeof PrefabServer> {
    const assets = { loadPrefab: async () => ({ data: PREFAB }) };
    return new PrefabServer({} as never, () => assets as never);
}

const overridesPassed = (): unknown[] => {
    const opts = instantiateSpy.mock.calls.at(-1)?.[2] as { overrides?: unknown[] };
    return opts.overrides ?? [];
};

describe('PrefabServer.instantiate overrides', () => {
    it('aims an override with no entity id at the root', async () => {
        instantiateSpy.mockClear();
        await server().instantiate('assets/prefabs/Bullet.esprefab', { overrides: [positionAt(7)] });
        expect(overridesPassed()).toEqual([{ ...positionAt(7), prefabEntityId: 'aaaa-bbbb' }]);
    });

    it('passes an id the prefab has through untouched', async () => {
        instantiateSpy.mockClear();
        await server().instantiate('assets/prefabs/Bullet.esprefab', { overrides: [positionAt(7, 'cccc-dddd')] });
        expect(overridesPassed()).toEqual([positionAt(7, 'cccc-dddd')]);
    });

    it('refuses an id nobody answers to, naming the root and the alternatives', async () => {
        // The `'0'` every pre-stable-id example still shows.
        await expect(server().instantiate('assets/prefabs/Bullet.esprefab', { overrides: [positionAt(7, '0')] }))
            .rejects.toThrow(/no entity "0"/);
        await expect(server().instantiate('assets/prefabs/Bullet.esprefab', { overrides: [positionAt(7, '0')] }))
            .rejects.toThrow(/aaaa-bbbb/);
    });
});
