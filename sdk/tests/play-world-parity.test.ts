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
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';

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

    it.each([false, true])('places a fetched prefab root with WorldPersistent=%s', async persistent => {
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
            { id: 1, name: 'Hut', parent: null, prefab: PREFAB, overrides: persistent ? [{
                type: 'component_added', prefabEntityId: 'r', componentData: { type: 'WorldPersistent', data: {} },
            }] : [] },
        ), 'main', resolveRef))!;

        expect(fetched).toEqual([`estella://project/${PREFAB}`]);
        expect(cut.errors).toEqual([]);
        expect(cut.manifest.cells.map((c) => c.name)).toEqual(persistent ? [] : ['main.cell_1_0']);
        expect(names(cut.persistent)).toEqual(persistent ? ['World', 'Hut'] : ['World']);
    });

    it('fetches an inherited root once and uses the variant position for all its instances', async () => {
        const base = 'assets/prefabs/Base.esprefab';
        const documents = new Map<string, unknown>([
            [PREFAB, { rootEntityId: 'r', basePrefab: base, entities: [], overrides: [{ type: 'property',
                prefabEntityId: 'r', componentType: 'Transform', propertyName: 'position', value: { x: 2500, y: 0, z: 1500 },
            }] }],
            [base, { rootEntityId: 'r', entities: [{ prefabEntityId: 'r', ...entity(9, 'Base', [500, 0, 500]) }] }],
        ]);
        const fetch = vi.fn(async (url: string) => {
            const document = documents.get(url.slice('estella://project/'.length));
            return { ok: document !== undefined, json: async () => document };
        });
        vi.stubGlobal('fetch', fetch);
        const cut = await cutPlayWorld(scene(
            entity(0, 'World', null, { components: [declaration] }),
            { id: 1, name: 'First Hut', parent: null, prefab: PREFAB, overrides: [] },
            { id: 2, name: 'Second Hut', parent: null, prefab: PREFAB, overrides: [] },
        ), 'main', resolveRef);

        expect(fetch.mock.calls.flat()).toEqual([resolveRef(PREFAB), resolveRef(base)]);
        expect(cut?.manifest.cells.map(cell => cell.name)).toEqual(['main.cell_2_1']);
        expect(names(cut!.documents.get('main.cell_2_1')!)).toEqual(['First Hut', 'Second Hut']);
    });

    it('rejects a cut whose cell bounds would overflow', async () => {
        vi.stubGlobal('fetch', refuseFetch);
        await expect(cutPlayWorld(scene(
            entity(0, 'World', null, { components: [{ ...declaration, data: { cellSize: Number.MAX_VALUE } }] }),
            entity(1, 'Rock', [Number.MAX_VALUE, 0, 0]),
        ), 'main', resolveRef)).rejects.toThrow(/cell \(1, 0\).*non-finite bounds/);
    });

    it('refuses competing world declarations in Play', async () => {
        vi.stubGlobal('fetch', refuseFetch);
        await expect(cutPlayWorld(scene(
            entity(1, 'Landscape', null, { components: [declaration] }),
            entity(2, 'Overlay', null, { components: [{ ...declaration, data: { cellSize: SIZE / 2, plane: 1 } }] }),
        ), 'main', resolveRef)).rejects.toThrow(/only one StreamedWorld.*Landscape.*Overlay/);
    });

    it('cuts Play when the world declaration is an explicit prefab root override', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
            rootEntityId: 'r', entities: [{ prefabEntityId: 'r', ...entity(0, 'Settings', [0, 0, 0]) }],
        }) })));
        const cut = (await cutPlayWorld(scene({ id: 1, name: 'Settings', parent: null, prefab: PREFAB, added: [], removed: [],
            overrides: [{ type: 'component_added', prefabEntityId: 'r', componentData: declaration }],
        }, entity(2, 'Rock', [1500, 0, 0])), 'main', resolveRef))!;
        expect(names(cut.persistent)).toEqual(['Settings']);
        expect(cut.manifest.cells.map(cell => cell.name)).toEqual(['main.cell_1_0']);
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
            app: { enableStats: vi.fn(), run: vi.fn(), signal: new AbortController().signal } as never,
            module: {} as never,
            canvas: { width: 800, height: 600 } as never,
            sceneData: data,
            entrySceneName: 'main',
            assetManifest: {},
            ...extra,
        });
        return initRuntime.mock.calls[0][0] as RuntimeInitConfig;
    }

    it('loads the captured text through path and UUID refs in its own game instance', async () => {
        const path = 'assets/motion/shot.estimeline';
        const url = 'estella://project/' + path;
        const contents = '{"name":"镜头"}\n';
        const options = { assetBaseUrl: 'estella://project', assetManifest: { abc: url } };
        const { source } = await boot(scene(), { ...options, assetDocuments: [{ path, contents }] });
        expect(await source.backend.fetchText(path)).toBe(contents);
        expect(await source.backend.fetchBinary(source.resolveRef!('@uuid:abc'))).toEqual(new TextEncoder().encode(contents).buffer);
        const standalone = await boot(scene(), options);
        setPlatform(webAdapter);
        const fetchFile = vi.fn(() => Promise.resolve(new Response('saved')));
        vi.stubGlobal('fetch', fetchFile);
        expect(await standalone.source.backend.fetchText(url)).toBe('saved');
        expect(await source.backend.fetchText('estella://project/other.json')).toBe('saved');
        expect(fetchFile).toHaveBeenCalledTimes(2);
    });

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

    it('keeps near cells in Play and leaves out proxies at zero far distance', async () => {
        const config = await boot(scene(
            entity(0, 'World', null, { components: [{
                type: 'StreamedWorld', data: { cellSize: SIZE, farProxies: true, farDistance: 0 },
            }] }),
            entity(2, 'Rock', [500, 0, 500], { components: [{
                type: 'MeshRenderer', data: { mesh: 'builtin:cube', opaque: true },
            }] }),
        ));
        const cut = (await config.prepareWorld!(config.scenes[0].data!, 'main'))!;
        expect(cut.manifest.farDistance).toBeUndefined();
        expect(cut.manifest.cells).toHaveLength(1);
        expect(cut.manifest.cells[0].proxy).toBeUndefined();
        expect(names(cut.documents.get('main.cell_0_0')!)).toEqual(['Rock']);
    });
});
