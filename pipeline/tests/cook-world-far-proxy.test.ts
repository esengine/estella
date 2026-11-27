// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A world that asks for far proxies ships one per cell that has static meshes, beside the cell.
 *
 * The proxy is read from the cell the cut produced, prefab instances expanded, with mesh bytes read from the project; what is
 * pinned here is what lands in the package: the manifest's far distance and proxy paths, a proxy document of one renderer per
 * material, and mesh files that decode.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { builtinMeshTemplate, decodeMesh, encodeMesh, type WorldManifest, type SceneData } from 'esengine';
import { cookWorlds } from '../src/world/cookWorld';

const PREFAB = 'aaaabbbb-cccc-dddd-eeee-ffff00002222';
const ROCK = 'aaaabbbb-cccc-dddd-eeee-ffff00003333';

let project = '';
afterEach(async () => {
    if (project) await rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    project = '';
});

const transform = (x: number, z: number) => ({ type: 'Transform', data: { position: { x, y: 0, z } } });
const renderer = (mesh: string, material = '') =>
    ({ type: 'MeshRenderer', data: { mesh, material, opaque: true, lit: true, color: { r: 1, g: 1, b: 1, a: 1 } } });

async function world(declaration: Record<string, unknown>, meshRef = `@uuid:${ROCK}`, prefabRef = `@uuid:${PREFAB}`): Promise<string> {
    project = await mkdtemp(path.join(tmpdir(), 'cook-far-'));
    for (const dir of ['scenes', 'prefabs', 'models']) await mkdir(path.join(project, 'assets', dir), { recursive: true });
    // A prefab whose child carries the mesh, so a proxy has to expand it to find anything.
    await writeFile(path.join(project, 'assets', 'prefabs', 'Hut.esprefab'), JSON.stringify({
        rootEntityId: 'r',
        entities: [
            { prefabEntityId: 'r', name: 'Hut', children: ['w'], components: [transform(0, 0)] },
            { prefabEntityId: 'w', name: 'Walls', parent: 'r', children: [], components: [transform(2, 0), renderer('builtin:cube', 'assets/hut.esmaterial')] },
        ],
    }));
    await writeFile(path.join(project, 'assets', 'prefabs', 'Hut.esprefab.meta'), JSON.stringify({ uuid: PREFAB, type: 'prefab' }));
    await writeFile(path.join(project, 'assets', 'models', 'rock.esmesh'), encodeMesh(builtinMeshTemplate('builtin:sphere')!.build()));
    await writeFile(path.join(project, 'assets', 'models', 'rock.esmesh.meta'), JSON.stringify({ uuid: ROCK, type: 'mesh' }));
    await writeFile(path.join(project, 'assets', 'scenes', 'main.esscene'), JSON.stringify({
        version: 4, name: 'main',
        entities: [
            { id: 0, name: 'World', parent: null, children: [], visible: true,
              components: [{ type: 'StreamedWorld', data: { cellSize: 1000, ...declaration } }] },
            { id: 1, name: 'Hut', parent: null, prefab: prefabRef,
              overrides: [{ type: 'property', prefabEntityId: 'r', componentType: 'Transform', propertyName: 'position', value: { x: 100, y: 0, z: 100 } }] },
            { id: 2, name: 'Rock', parent: null, children: [], visible: true, components: [transform(300, 300), renderer(meshRef)] },
            { id: 3, name: 'Shed', parent: null, children: [], visible: true, components: [transform(400, 400), renderer('builtin:cube', 'assets/hut.esmaterial')] },
            // The cell next door holds only something that moves, so it has nothing a proxy could be made of.
            { id: 4, name: 'Cart', parent: null, children: [], visible: true,
              components: [transform(1500, 500), renderer('builtin:cube'), { type: 'RigidBody3D', data: { bodyType: 2 } }] },
        ],
    }));
    await writeFile(path.join(project, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'Far', defaultScene: 'assets/scenes/main.esscene',
    }));
    return project;
}

async function cook(root: string) {
    const result = await cookWorlds(root, root, [{ name: 'main', path: 'assets/scenes/main.esscene' }]);
    const manifest = JSON.parse(await readFile(path.join(root, result.worlds[0]!.manifest), 'utf8')) as WorldManifest;
    return { result, manifest };
}

describe('cooking a world with far proxies', () => {
    it.each(['main.cell_0_0', 'main.cell_0_0#far'])('refuses a conflict with the shipped scene %s before writing world files', async name => {
        const root = await world({ farProxies: true, farDistance: 5000 });
        const main = 'assets/scenes/main.esscene', other = 'assets/scenes/other.esscene';
        const source = await readFile(path.join(root, main), 'utf8');
        await writeFile(path.join(root, other), JSON.stringify({ version: 4, name, entities: [] }));
        await expect(cookWorlds(root, root, [{ name: 'main', path: main }, { name, path: other }]))
            .rejects.toThrow(`scene name "${name}" is already used`);
        expect(await readFile(path.join(root, main), 'utf8')).toBe(source);
        await expect(stat(path.join(root, 'world'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('allows a scene using a far name when the corresponding cell has no proxy', async () => {
        const root = await world({ farProxies: true, farDistance: 5000 });
        const name = 'main.cell_1_0#far', other = 'assets/scenes/other.esscene';
        await writeFile(path.join(root, other), JSON.stringify({ version: 4, name, entities: [] }));
        const result = await cookWorlds(root, root, [
            { name: 'main', path: 'assets/scenes/main.esscene' }, { name, path: other },
        ]);
        expect(result.farProxies[0]?.cells).toBe(1);
    });

    it('cooks a staged declaration written with a JSON escape', async () => {
        const root = await world({ farProxies: true, farDistance: 5000 });
        const file = path.join(root, 'assets/scenes/main.esscene');
        await writeFile(file, (await readFile(file, 'utf8')).replace('"StreamedWorld"', '"\\u0053treamedWorld"'));
        const { manifest } = await cook(root);
        expect(manifest.farDistance).toBe(5000);
        expect(manifest.cells[0]?.proxy).toBe('world/main.cell_0_0.far.json');
    });

    it('bakes far proxies from an inherited prefab declaration with instance overrides', async () => {
        const root = await world({ farProxies: true, farDistance: 5000 });
        const file = path.join(root, 'assets/scenes/main.esscene');
        const scene = JSON.parse(await readFile(file, 'utf8'));
        const asset = 'assets/prefabs/WorldSettings.esprefab';
        await writeFile(path.join(root, asset), JSON.stringify({ rootEntityId: 'r', entities: [
            { prefabEntityId: 'r', name: 'Settings', components: scene.entities[0].components },
        ] }));
        scene.entities[0] = { id: 0, name: 'Settings', parent: null, prefab: asset, added: [], removed: [],
            overrides: [{ prefabEntityId: 'r', type: 'property', componentType: 'StreamedWorld', propertyName: 'farDistance', value: 3500 }],
        };
        await writeFile(file, JSON.stringify(scene));
        const { manifest } = await cook(root);
        expect(manifest.farDistance).toBe(3500);
        expect(manifest.cells[0]?.proxy).toBe('world/main.cell_0_0.far.json');
    });

    it('keeps manifests, cells, proxies and meshes distinct for nested names, literal escapes and Unicode', async () => {
        const root = await world({ farProxies: true, farDistance: 5000 });
        const names = ['levels/second', 'levels_second', 'levels~2f~second', '地图一', '地图二'];
        const original = await readFile(path.join(root, 'assets/scenes/main.esscene'), 'utf8');
        const scenes = names.map(name => ({ name, path: `assets/scenes/${name}.esscene` }));
        for (const scene of scenes) {
            const file = path.join(root, scene.path);
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, original);
        }
        const cooked = await cookWorlds(root, root, scenes);
        expect(cooked.worlds.map(world => world.scene)).toEqual(names);
        const paths = new Set<string>();
        for (const world of cooked.worlds) {
            const readUnique = async (file: string) => {
                expect(paths.has(file), file).toBe(false);
                paths.add(file);
                return readFile(path.join(root, file));
            };
            const manifest = JSON.parse((await readUnique(world.manifest)).toString()) as WorldManifest;
            expect(manifest.scene).toBe(world.scene);
            for (const cell of manifest.cells) {
                expect(JSON.parse((await readUnique(cell.path)).toString()).name).toBe(cell.name);
                if (!cell.proxy) continue;
                const proxy = JSON.parse((await readUnique(cell.proxy)).toString()) as SceneData;
                for (const entity of proxy.entities) {
                    const renderer = entity.components.find(c => c.type === 'MeshRenderer')!;
                    const mesh = await readUnique((renderer.data as { mesh: string }).mesh);
                    expect(decodeMesh(mesh).indices.length).toBeGreaterThan(0);
                }
            }
        }
    });

    it('writes a proxy for each cell with static meshes, one renderer per material, and names it on the manifest', async () => {
        const root = await world({ farProxies: true, farDistance: 5000 });
        const { result, manifest } = await cook(root);
        expect(manifest.farDistance).toBe(5000);
        const [home, next] = manifest.cells;
        expect(home!.name).toBe('main.cell_0_0');
        expect(home!.proxy).toBe('world/main.cell_0_0.far.json');
        expect(next!.proxy).toBeUndefined();

        const proxy = JSON.parse(await readFile(path.join(root, home!.proxy!), 'utf8')) as SceneData;
        const renderers = proxy.entities.map((e) => e.components.find((c) => c.type === 'MeshRenderer')!.data as Record<string, unknown>);
        // Hut and shed share a material and merge; the rock has none and stays a group of its own.
        expect(renderers.map((r) => r.material).sort()).toEqual(['', 'assets/hut.esmaterial']);
        for (const r of renderers) {
            expect(r.opaque).toBe(true);
            const mesh = decodeMesh(new Uint8Array(await readFile(path.join(root, r.mesh as string))));
            expect(mesh.indices.length).toBeGreaterThan(0);
        }
        const stats = result.farProxies[0]!;
        expect(stats).toMatchObject({ scene: 'main', cells: 1, surfaces: 3 });
        expect(stats.trianglesAfter).toBeLessThanOrEqual(stats.trianglesBefore);
    });

    it('omits an inactive prefab and a moving 2D mesh from the baked proxies', async () => {
        const root = await world({ farProxies: true, farDistance: 5000 });
        const file = path.join(root, 'assets/scenes/main.esscene');
        const document = JSON.parse(await readFile(file, 'utf8'));
        document.entities[1].overrides.push({ prefabEntityId: 'r', type: 'component_added',
            componentData: { type: 'Disabled', data: {} } });
        document.entities[4].components[2].type = 'RigidBody2D';
        await writeFile(file, JSON.stringify(document));

        const { result, manifest } = await cook(root);
        expect(manifest.cells.map(cell => !!cell.proxy)).toEqual([true, false]);
        expect(result.farProxies[0]).toMatchObject({ cells: 1, surfaces: 2 });
    });

    it.each([{}, { farProxies: true, farDistance: 0 }])('omits far files when proxies are off (%j)', async declaration => {
        const root = await world(declaration);
        const { result, manifest } = await cook(root);
        expect(manifest.farDistance).toBeUndefined();
        expect(manifest.cells.every((c) => c.proxy === undefined)).toBe(true);
        expect(result.farProxies).toEqual([]);
        await expect(readFile(path.join(root, 'world/main.cell_0_0.far.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('includes both an indexed mesh and its neighboring prefab with legacy references', async () => {
        const root = await world({ farProxies: true, farDistance: 5000 }, ROCK.toUpperCase(), PREFAB);
        const { result } = await cook(root);
        expect(result.farProxies[0]).toMatchObject({ cells: 1, surfaces: 3 });
    });
});
