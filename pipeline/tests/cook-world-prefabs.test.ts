// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A prefab instance is placed by the root the cook read off disk.
 *
 * An instance that overrides nothing carries no position of its own, so where it
 * stands is a fact only its asset holds. Reading it is the one half of the cut a
 * package does not share with an editor Play session — the realm fetches the same
 * prefab over http — so the reading itself is pinned here, against real files.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cookWorlds } from '../src/world/cookWorld';
import type { WorldManifest } from 'esengine';

const SIZE = 1000;
const UUID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';

let project = '';
afterEach(async () => {
    if (project) await rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    project = '';
});

/** A project holding one prefab whose root sits at `at`, and a scene instancing it. */
async function projectWith(at: [number, number, number], override: number[] | null): Promise<string> {
    project = await mkdtemp(path.join(tmpdir(), 'cook-world-'));
    await mkdir(path.join(project, 'assets', 'scenes'), { recursive: true });
    await mkdir(path.join(project, 'assets', 'prefabs'), { recursive: true });
    await writeFile(path.join(project, 'assets', 'prefabs', 'Hut.esprefab'), JSON.stringify({
        rootEntityId: 'r',
        entities: [{
            prefabEntityId: 'r', name: 'Hut',
            components: [{ type: 'Transform', data: { position: { x: at[0], y: at[1], z: at[2] } } }],
        }],
    }));
    await writeFile(path.join(project, 'assets', 'prefabs', 'Hut.esprefab.meta'),
        JSON.stringify({ uuid: UUID, type: 'prefab' }));
    await writeFile(path.join(project, 'assets', 'scenes', 'main.esscene'), JSON.stringify({
        version: 4, name: 'main',
        entities: [
            { id: 0, name: 'World', parent: null, children: [], visible: true,
              components: [{ type: 'StreamedWorld', data: { cellSize: SIZE } }] },
            {
                id: 1, name: 'Hut', parent: null, prefab: `@uuid:${UUID}`,
                overrides: override === null ? [] : [{
                    type: 'property', prefabEntityId: 'r',
                    componentType: 'Transform', propertyName: 'position',
                    value: { x: override[0], y: override[1], z: override[2] },
                }],
            },
        ],
    }));
    await writeFile(path.join(project, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'Cooked', defaultScene: 'assets/scenes/main.esscene',
    }));
    return project;
}

/** Cook the project in place — the payload IS the project here, which is all the cut reads. */
async function cellsOf(root: string): Promise<string[]> {
    const result = await cookWorlds(root, root, [{ name: 'main', path: 'assets/scenes/main.esscene' }]);
    expect(result.worlds).toHaveLength(1);
    const manifest = JSON.parse(
        await readFile(path.join(root, result.worlds[0].manifest), 'utf8'),
    ) as WorldManifest;
    return manifest.cells.map((c) => c.name);
}

describe('cooking a world that instances a prefab', () => {
    it('puts the instance in the cell its asset root falls in', async () => {
        expect(await cellsOf(await projectWith([1500, 0, 500], null))).toEqual(['main.cell_1_0']);
    });

    it('and in the cell an override moves it to, not the asset\'s', async () => {
        expect(await cellsOf(await projectWith([1500, 0, 500], [500, 0, 500])))
            .toEqual(['main.cell_0_0']);
    });
});
