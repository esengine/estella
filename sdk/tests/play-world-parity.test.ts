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
    async function boot(data: SceneData): Promise<RuntimeInitConfig> {
        initRuntime.mockClear();
        vi.stubGlobal('fetch', refuseFetch);
        await initPlayRealmRuntime({
            app: { enableStats: vi.fn(), run: vi.fn() } as never,
            module: {} as never,
            canvas: { width: 800, height: 600 } as never,
            sceneData: data,
            entrySceneName: 'main',
            assetManifest: {},
        });
        return initRuntime.mock.calls[0][0] as RuntimeInitConfig;
    }

    it('is the world, its cells and their documents — not the scene played whole', async () => {
        const config = await boot(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Player', [10, 0, 10], { components: [{ type: 'WorldPersistent', data: {} }] }),
            entity(2, 'RockA', [500, 0, 500]),
            entity(3, 'RockB', [1500, 0, 500]),
        ));

        // The entry is the persistent half. Handing over the whole document is
        // exactly the gap this closes, and it would leave everything else here
        // true — the streamer would simply publish a second copy of the world.
        expect(names(config.scenes[0].data!).sort()).toEqual(['Player', 'World']);
        expect(config.worlds).toHaveLength(1);
        expect(config.worlds![0].cells.map((c) => c.name))
            .toEqual(['main.cell_0_0', 'main.cell_1_0']);
        // Registered by path and delivered from memory: without the documents the
        // realm would reach for `world/main.cell_0_0.json`, which only a package has.
        for (const cell of config.worlds![0].cells) {
            expect(config.cellDocuments?.get(cell.name)).toBeDefined();
        }
    });

    it('carries no world at all for a scene that is not one', async () => {
        const config = await boot(scene(entity(0, 'Ground', [0, 0, 0])));
        expect(config.worlds).toBeUndefined();
        expect(config.cellDocuments).toBeUndefined();
        expect(names(config.scenes[0].data!)).toEqual(['Ground']);
    });
});
