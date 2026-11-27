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
import { StreamPlane, type WorldManifest } from 'esengine';

const SIZE = 1000;
const UUID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';

let project = '';
afterEach(async () => {
    if (project) await rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    project = '';
});

/** A project holding one prefab whose root sits at `at`, and a scene instancing it. */
async function projectWith(at: [number, number, number], override: number[] | null, ref = `@uuid:${UUID}`): Promise<string> {
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
                id: 1, name: 'Hut', parent: null, prefab: ref,
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
    const references = [UUID, UUID.toUpperCase(), `@uuid:${UUID}`, `@uuid:${UUID.toUpperCase()}`, 'assets/prefabs/Hut.esprefab'];
    it.each(references)('places the instance of %s in the cell containing its asset root', async ref => {
        expect(await cellsOf(await projectWith([1500, 0, 500], null, ref))).toEqual(['main.cell_1_0']);
    });

    it('and in the cell an override moves it to, not the asset\'s', async () => {
        expect(await cellsOf(await projectWith([1500, 0, 500], [500, 0, 500])))
            .toEqual(['main.cell_0_0']);
    });

    it('writes canonical child lists and texture settings into streamed output files', async () => {
        const root = await projectWith([1500, 0, 500], null);
        const sceneFile = path.join(root, 'assets/scenes/main.esscene');
        const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
        scene.entities[0].children = [1];
        scene.entities.push(
            { id: 2, parent: 1, name: 'Group', children: [0], components: [] },
            { id: 3, parent: 2, name: 'Sign', children: [], components: [] },
        );
        scene.textureImporterSettings = { 'assets/sign.png': { sRGB: false } };
        await writeFile(sceneFile, JSON.stringify(scene));

        expect(await cellsOf(root)).toEqual(['main.cell_1_0']);
        const persistent = JSON.parse(await readFile(sceneFile, 'utf8'));
        const cell = JSON.parse(await readFile(path.join(root, 'world/main.cell_1_0.json'), 'utf8'));
        expect(persistent.entities[0].children).toEqual([]);
        expect(cell.entities.find((row: { id: number }) => row.id === 2).children).toEqual([3]);
        expect(cell.entities.find((row: { id: number }) => row.id === 1)).not.toHaveProperty('children');
        expect(persistent.textureImporterSettings).toEqual(scene.textureImporterSettings);
        expect(cell.textureImporterSettings).toEqual(scene.textureImporterSettings);
    });

    it('rejects overflowing cell bounds before replacing the staged scene or writing a manifest', async () => {
        const root = await projectWith([Number.MAX_VALUE, 0, 0], null);
        const scenePath = 'assets/scenes/main.esscene';
        const sceneFile = path.join(root, scenePath);
        const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
        scene.entities[0].components[0].data.cellSize = Number.MAX_VALUE;
        const staged = JSON.stringify(scene);
        await writeFile(sceneFile, staged);

        await expect(cookWorlds(root, root, [{ name: 'main', path: scenePath }])).rejects.toThrow(/cell \(1, 0\).*non-finite bounds/);
        expect(await readFile(sceneFile, 'utf8')).toBe(staged);
        await expect(readFile(path.join(root, 'world/main.world.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('refuses a cyclic source hierarchy before writing any world files', async () => {
        const root = await projectWith([1500, 0, 500], null);
        const scenePath = 'assets/scenes/main.esscene';
        const sceneFile = path.join(root, scenePath);
        const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
        scene.entities.push(
            { id: 2, name: 'First', parent: 3, children: [], components: [] },
            { id: 3, name: 'Second', parent: 2, children: [], components: [] },
        );
        const staged = JSON.stringify(scene);
        await writeFile(sceneFile, staged);

        await expect(cookWorlds(root, root, [{ name: 'main', path: scenePath }])).rejects.toThrow(/parent cycle/);
        expect(await readFile(sceneFile, 'utf8')).toBe(staged);
        await expect(readFile(path.join(root, 'world/main.world.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('refuses competing world declarations without writing cells or a manifest', async () => {
        const root = await projectWith([1500, 0, 500], null);
        const scenePath = 'assets/scenes/main.esscene';
        const sceneFile = path.join(root, scenePath);
        const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
        scene.entities.push({ id: 2, name: 'Overlay', parent: null, children: [], components: [
            { type: 'StreamedWorld', data: { cellSize: 250, plane: StreamPlane.Screen, farProxies: true } },
        ] });
        const staged = JSON.stringify(scene);
        await writeFile(sceneFile, staged);

        await expect(cookWorlds(root, root, [{ name: 'main', path: scenePath }])).rejects.toThrow(/only one StreamedWorld.*Overlay/);
        expect(await readFile(sceneFile, 'utf8')).toBe(staged);
        await expect(readFile(path.join(root, 'world/main.world.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('writes persistent entity links from instance components into the world manifest', async () => {
        const root = await projectWith([1500, 0, 500], null);
        const sceneFile = path.join(root, 'assets/scenes/main.esscene');
        const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
        scene.entities[1].overrides.push({ prefabEntityId: 'r', type: 'component_added',
            componentData: { type: 'MeshSkin', data: { joints: ['r', 2, 0] } } });
        scene.entities[1].added = [];
        scene.entities[1].removed = [];
        scene.entities.push({ id: 2, name: 'Persistent joint', parent: null, children: [], components: [] });
        await writeFile(sceneFile, JSON.stringify(scene));

        expect(await cellsOf(root)).toEqual(['main.cell_1_0']);
        const manifest = JSON.parse(await readFile(path.join(root, 'world/main.world.json'), 'utf8')) as WorldManifest;
        expect(manifest.persistentRefs).toEqual([2]);
    });

    it('exports a prefab instance with a root persistence override in the persistent scene', async () => {
        const root = await projectWith([1500, 0, 500], null);
        const sceneFile = path.join(root, 'assets/scenes/main.esscene');
        const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
        scene.entities[1].overrides.push({ prefabEntityId: 'r', type: 'component_added',
            componentData: { type: 'WorldPersistent', data: {} } });
        scene.entities.push({ id: 2, name: 'Streamed mesh', parent: null, children: [], components: [
            { type: 'Transform', data: { position: { x: 2500, y: 0, z: 500 } } },
            { type: 'MeshSkin', data: { joints: [1] } },
        ] });
        await writeFile(sceneFile, JSON.stringify(scene));

        expect(await cellsOf(root)).toEqual(['main.cell_2_0']);
        const persistent = JSON.parse(await readFile(sceneFile, 'utf8'));
        expect(persistent.entities.map((entity: { id: number }) => entity.id)).toEqual([0, 1]);
        const manifest = JSON.parse(await readFile(path.join(root, 'world/main.world.json'), 'utf8')) as WorldManifest;
        expect(manifest.persistentRefs).toEqual([1]);
    });

    it.each([
        { axes: 'XY', plane: StreamPlane.Screen, rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, edge: 'maxZ' as const, extent: 1300 },
        { axes: 'XZ', plane: StreamPlane.Ground, rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, edge: 'minZ' as const, extent: -1100 },
    ])('places a replaced root Transform and composes child bounds in $axes', async ({ plane, rotation, edge, extent }) => {
        const root = await projectWith([500, 0, 500], null);
        const sceneFile = path.join(root, 'assets/scenes/main.esscene');
        const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
        scene.entities[0].components[0].data.plane = plane;
        scene.entities[1].overrides = [{ prefabEntityId: 'r', type: 'component_replaced', componentData: {
            type: 'Transform', data: { position: { x: 2500, y: 100, z: 100 }, rotation, scale: { x: 2, y: 1, z: 1 } },
        } }];
        scene.entities.push({ id: 2, parent: 1, name: 'Child', children: [], components: [
            { type: 'Transform', data: { position: { x: 600, y: 0, z: 0 } } },
        ] });
        await writeFile(sceneFile, JSON.stringify(scene));

        expect(await cellsOf(root)).toEqual(['main.cell_2_0']);
        const manifest = JSON.parse(await readFile(path.join(root, 'world/main.world.json'), 'utf8')) as WorldManifest;
        expect(manifest.cells[0][edge]).toBeCloseTo(extent);
        expect(manifest.cells[0].entityCount).toBe(2);
    });

    it.each([
        { axes: 'XY', plane: StreamPlane.Screen, cell: 'main.cell_2_3' },
        { axes: 'XZ', plane: StreamPlane.Ground, cell: 'main.cell_2_4' },
    ])(
        'cuts a variant using its effective root in the $axes plane even if a replaced mount asset is missing',
        async ({ plane, cell }) => {
            const root = await projectWith([1500, 500, 500], null);
            const prefabs = path.join(root, 'assets', 'prefabs');
            const hut = path.join(prefabs, 'Hut.esprefab');
            const base = JSON.parse(await readFile(hut, 'utf8'));
            const mount = { prefabEntityId: 'mount', name: 'Mount', parent: 'r', children: [], components: [], visible: true };
            base.entities[0].children = ['mount'];
            base.entities.push({ ...mount, nestedPrefab: { prefabPath: 'assets/prefabs/Removed.esprefab', overrides: [] } });
            await writeFile(path.join(prefabs, 'Base.esprefab'), JSON.stringify(base));
            await writeFile(hut, JSON.stringify({ name: 'Variant', rootEntityId: 'r', basePrefab: 'assets/prefabs/Base.esprefab',
                entities: [mount], overrides: [{ type: 'property', prefabEntityId: 'r', componentType: 'Transform',
                    propertyName: 'position', value: { x: 2500, y: 3500, z: 4500 } }],
            }));
            const sceneFile = path.join(root, 'assets/scenes/main.esscene');
            const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
            scene.entities[0].components[0].data.plane = plane;
            await writeFile(sceneFile, JSON.stringify(scene));

            expect(await cellsOf(root)).toEqual([cell]);
        },
    );
});
