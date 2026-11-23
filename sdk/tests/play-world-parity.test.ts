// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Play cuts the world it was handed, and cuts it the way a package will.
 *
 * The deliberate gap this closes was that a package streamed its world and the
 * editor played the whole thing — so an author could only find out what the
 * world does after building it. What is pinned here is that Play now boots the
 * PERSISTENT half, holds the same manifest a cook would write, and refuses the
 * same worlds a build refuses.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// The runtime itself is not under test here; what it was HANDED is.
const initRuntime = vi.hoisted(() => vi.fn());
vi.mock('../src/runtime/runtimeLoader', () => ({ initRuntime }));
vi.mock('../src/runtime/packagedRuntime', () => ({ applyAssetRefResolvers: vi.fn() }));

import { cutPlayWorld, initPlayRealmRuntime } from '../src/runtime/playRealmRuntime';
import type { RuntimeInitConfig } from '../src/runtime/runtimeLoader';
import { cellDocumentPath } from '../src/residency/cutWorld';
import { defineComponent } from '../src/ecs/component';
import type { Entity } from '../src/types';
import type { SceneData } from '../src/scene/scene';
import { decodeMesh, type MeshData } from '../src/asset/meshFormat';

// A project's own component, which is the case only Play can catch: a cook loads
// the engine's registry and never sees this one, so the cross-cell reference it
// holds is refused HERE and nowhere earlier.
defineComponent<{ watches: Entity }>('Watchtower', { watches: 0 as Entity },
    { entityFields: ['watches'] });

const SIZE = 1000;
const PREFAB = '@uuid:aaaabbbb-cccc-dddd-eeee-ffff00001111';

type Component = { type: string; data: Record<string, unknown> };

function entity(
    id: number, name: string, at: [number, number, number] | null,
    extra: { parent?: number | null; components?: Component[] } = {},
): Record<string, unknown> {
    const components: Component[] = [...(extra.components ?? [])];
    if (at !== null) {
        components.unshift({ type: 'Transform', data: { position: { x: at[0], y: at[1], z: at[2] } } });
    }
    return { id, name, parent: extra.parent ?? null, children: [], visible: true, components };
}

const declaration: Component = { type: 'StreamedWorld', data: { cellSize: SIZE } };

function scene(...entities: Array<Record<string, unknown>>): SceneData {
    return { version: 4, name: 'main', entities } as unknown as SceneData;
}

/** Nothing in this realm is fetchable unless a case says otherwise. */
const refuseFetch = (): never => { throw new Error('nothing should have been fetched'); };
const resolveRef = (ref: string): string => `estella://project/${ref}`;

const names = (document: SceneData): string[] =>
    (document.entities as unknown as Array<{ name: string }>).map((e) => e.name);

afterEach(() => vi.unstubAllGlobals());

describe('the snapshot Play boots', () => {
    it('is left whole when the scene never declared itself a world', async () => {
        vi.stubGlobal('fetch', refuseFetch);
        expect(await cutPlayWorld(scene(entity(0, 'Ground', [0, 0, 0])), '__play', resolveRef))
            .toBeNull();
    });

    it('is the persistent half, with the places in cells that carry their ship paths', async () => {
        vi.stubGlobal('fetch', refuseFetch);
        const cut = (await cutPlayWorld(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Player', [10, 0, 10], { components: [{ type: 'WorldPersistent', data: {} }] }),
            entity(2, 'RockA', [500, 0, 500]),
            entity(3, 'RockB', [1500, 0, 500]),
        ), 'main', resolveRef))!;

        expect(names(cut.persistent).sort()).toEqual(['Player', 'World']);
        expect(cut.manifest.cellSize).toBe(SIZE);
        expect(cut.manifest.cells.map((c) => c.name)).toEqual(['main.cell_0_0', 'main.cell_1_0']);
        // The path a package would fetch. Play never does, but a manifest that
        // differed in a field one host ignores is still a different manifest.
        for (const cell of cut.manifest.cells) {
            expect(cell.path).toBe(cellDocumentPath(cell.name));
        }
        // And every cell the manifest names is actually deliverable from memory.
        expect([...cut.documents.keys()].sort()).toEqual(cut.manifest.cells.map((c) => c.name).sort());
        expect(names(cut.documents.get('main.cell_0_0')!)).toEqual(['RockA']);
        expect(names(cut.documents.get('main.cell_1_0')!)).toEqual(['RockB']);
    });

    it('places a prefab instance by the root it reads over the realm origin', async () => {
        const fetched: string[] = [];
        vi.stubGlobal('fetch', (url: string) => {
            fetched.push(url);
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    rootEntityId: 'r',
                    entities: [{
                        prefabEntityId: 'r',
                        components: [{ type: 'Transform', data: { position: { x: 1500, y: 0, z: 500 } } }],
                    }],
                }),
            });
        });
        const cut = (await cutPlayWorld(scene(
            entity(0, 'World', null, { components: [declaration] }),
            { id: 1, name: 'Hut', parent: null, prefab: PREFAB, overrides: [] },
        ), 'main', resolveRef))!;

        expect(fetched).toEqual([`estella://project/${PREFAB}`]);
        expect(cut.errors).toEqual([]);
        expect(cut.manifest.cells.map((c) => c.name)).toEqual(['main.cell_1_0']);
    });

    it('refuses a world a build would refuse, rather than playing it whole', async () => {
        vi.stubGlobal('fetch', refuseFetch);
        await expect(cutPlayWorld(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Watcher', [500, 0, 500], {
                components: [{ type: 'Watchtower', data: { watches: 2 } }],
            }),
            entity(2, 'Quarry', [1500, 0, 500]),
        ), 'main', resolveRef)).rejects.toThrow(/cannot be cut into cells/);
    });
});

describe('what Play hands the shipping runtime', () => {
    /** The realm's boot, reduced to the one argument this is about. */
    async function boot(data: SceneData, extra: Partial<Parameters<typeof initPlayRealmRuntime>[0]> = {}): Promise<RuntimeInitConfig> {
        initRuntime.mockClear();
        vi.stubGlobal('fetch', refuseFetch);
        await initPlayRealmRuntime({
            ...extra,
            app: { enableStats: vi.fn(), run: vi.fn(), signal: new AbortController().signal } as never,
            module: {} as never,
            canvas: { width: 800, height: 600 } as never,
            sceneData: data,
            entrySceneName: 'main',
            assetManifest: {},
        });
        return initRuntime.mock.calls[0][0] as RuntimeInitConfig;
    }

    it('checks declared achievements in Play using its local provider', async () => {
        const settings = { achievements: ['FIRST_MAP'], steamAppId: 42 };
        const config = await boot(scene(), settings);
        expect(config.achievements).toEqual(settings.achievements);
        expect(config.steamAppId).toBeUndefined();
    });

    it.each(['main', 'levels/next'])('cuts the requested scene %s into its persistent rows and cell documents', async name => {
        const data = scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Player', [10, 0, 10], { components: [{ type: 'WorldPersistent', data: {} }] }),
            entity(2, 'RockA', [500, 0, 500]),
            entity(3, 'RockB', [1500, 0, 500]),
        );
        const config = await boot(data, { extraScenes: [{ name: 'levels/next', data }] });
        const requested = config.scenes.find(scene => scene.name === name)!;
        const cut = (await config.prepareWorld!(requested.data!, name))!;
        expect(names(cut.persistent).sort()).toEqual(['Player', 'World']);
        expect(cut.manifest.scene).toBe(name);
        expect(cut.manifest.cells.map(c => c.name)).toEqual([`${name}.cell_0_0`, `${name}.cell_1_0`]);
        // Registered by path and delivered from memory: without the documents the
        // realm would reach for `world/main.cell_0_0.json`, which only a package has.
        for (const cell of cut.manifest.cells) {
            expect(cut.documents.get(cell.name)).toBeDefined();
        }
    });

    it('gives each cell with static meshes the far proxy a build would, made when first fetched and served from memory', async () => {
        const cube: Component = { type: 'MeshRenderer', data: { mesh: 'builtin:cube', opaque: true } };
        // The editor's simplifier, stood in for: what it hands back is what the proxy draws.
        const simplify = vi.fn(async (mesh: MeshData) => ({ ...mesh, indices: mesh.indices.slice(0, 3) }));
        const config = await boot(scene(
            entity(0, 'World', null, { components: [{ type: 'StreamedWorld', data: { cellSize: SIZE, farProxies: true, farDistance: 4000 } }] }),
            entity(1, 'Player', [10, 0, 10], { components: [{ type: 'WorldPersistent', data: {} }] }),
            entity(2, 'RockA', [500, 0, 500], { components: [cube] }),
            entity(3, 'RockB', [1500, 0, 500]),
        ), { simplifyFarProxy: simplify });
        const world = (await config.prepareWorld!(config.scenes[0].data!, 'main'))!.manifest;
        expect(world.farDistance).toBe(4000);
        expect(world.cells.map((c) => c.proxy)).toEqual(['world/main.cell_0_0.far.json', undefined]);
        // Nothing simplified before the game starts: a large world would make it wait.
        expect(simplify).not.toHaveBeenCalled();
        // Fetching anything would throw: the proxy's document and mesh are the realm's own.
        const proxy = JSON.parse(await config.source.backend.fetchText(world.cells[0]!.proxy!)) as SceneData;
        expect(simplify).toHaveBeenCalledTimes(1);
        const mesh = (proxy.entities[0]!.components.find((c) => c.type === 'MeshRenderer')!.data as { mesh: string }).mesh;
        expect(decodeMesh(new Uint8Array(await config.source.backend.fetchBinary(mesh))).indices.length).toBe(3);
    });

    it('carries no world at all for a scene that is not one', async () => {
        const config = await boot(scene(entity(0, 'Ground', [0, 0, 0])));
        expect(await config.prepareWorld!(config.scenes[0].data!, 'main')).toBeNull();
        expect(names(config.scenes[0].data!)).toEqual(['Ground']);
    });
});
