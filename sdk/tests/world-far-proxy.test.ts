// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world-far-proxy.test.ts
 * @brief   Verify a cell's far proxy stands in for it with no gap, and which surfaces a proxy is made of.
 */
import { describe, it, expect } from 'vitest';
import type { WorldCell, WorldManifest, ResidencySource } from '../src/residency/cells';
import { WorldStreamer, type WorldStreamHost } from '../src/residency/WorldStreamer';
import { farProxySettings, farProxySurfaces, farProxySceneName } from '../src/residency/farProxy';
import type { SceneData } from '../src/scene/scene';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function cell(x: number, proxy = true): WorldCell {
    return {
        name: `c_${x}_0`, path: `world/c_${x}_0.json`, x, z: 0,
        minX: x * 100, minZ: 0, maxX: (x + 1) * 100, maxZ: 100, entityCount: 1, rootCount: 1,
        ...(proxy ? { proxy: `world/c_${x}_0.far.json` } : {}),
    };
}

const at = (x: number, prefetch = 10): ResidencySource => ({ x, z: 50, loadRadius: 10, unloadRadius: 20, prefetchRadius: prefetch });

/** A host whose loads and unloads finish only when told, so the frames in between can be looked at. */
function host() {
    const loaded = new Set<string>();
    const calls: string[] = [];
    const pending: Array<() => void> = [];
    const failing = new Set<string>();
    const h: WorldStreamHost = {
        register() {},
        prepare: () => Promise.resolve(),
        discardPrepared: () => 0,
        loadAdditive(name) {
            calls.push(`load:${name}`);
            if (failing.has(name)) return Promise.reject(new Error('missing'));
            return new Promise((resolve) => pending.push(() => { loaded.add(name); resolve({}); }));
        },
        unload(name) {
            calls.push(`unload:${name}`);
            return new Promise((resolve) => pending.push(() => { loaded.delete(name); resolve(); }));
        },
        isLoaded: (name) => loaded.has(name),
    };
    return {
        h, loaded, calls, failing,
        async settle() { await flush(); while (pending.length > 0) { for (const run of pending.splice(0)) run(); await flush(); } },
    };
}

const world = (farDistance: number | undefined, ...cells: WorldCell[]): WorldManifest =>
    ({ version: 1, scene: 'main', cellSize: 100, persistentRefs: [], cells, ...(farDistance !== undefined ? { farDistance } : {}) });

const near = farProxySceneName('c_0_0');

describe('a far proxy', () => {
    it('stands in for a cell that is far, and is not asked for past the far distance', async () => {
        const t = host();
        const streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(1000, cell(0), cell(30)));
        streamer.update([at(500)]);
        await t.settle();
        expect(t.loaded.has(near)).toBe(true);
        expect(t.loaded.has(farProxySceneName('c_30_0'))).toBe(false);
        expect(streamer.status().proxyCells).toEqual(['c_0_0']);
    });

    it('leaves only once its cell is in, so walking into a place never shows a hole', async () => {
        const t = host();
        const streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(500)]);
        await t.settle();
        streamer.update([at(50)]);
        await flush();
        // The cell is on its way and the proxy still stands.
        expect(t.calls).toContain('load:c_0_0');
        expect(t.calls).not.toContain(`unload:${near}`);
        await t.settle();
        streamer.update([at(50)]);
        await t.settle();
        expect(t.loaded.has('c_0_0')).toBe(true);
        expect(t.loaded.has(near)).toBe(false);
    });

    it('arrives before its cell leaves, so walking away never shows a hole', async () => {
        const t = host();
        const streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(50)]);
        await t.settle();
        streamer.update([at(50)]);
        await t.settle();
        expect(t.loaded.has('c_0_0')).toBe(true);
        t.calls.length = 0;
        streamer.update([at(500)]);
        await flush();
        expect(t.calls).toEqual([`load:${near}`]);
        await t.settle();
        streamer.update([at(500)]);
        await t.settle();
        expect(t.calls).toEqual([`load:${near}`, 'unload:c_0_0']);
        expect(t.loaded.has(near)).toBe(true);
        expect(t.loaded.has('c_0_0')).toBe(false);
    });

    it('arrives before its cell leaves when the cell is still near enough to prefetch', async () => {
        // A leaving cell inside the prefetch radius is stepped on the prefetch pass, before the unload pass: its proxy's want has to
        // be known by then.
        const t = host();
        const streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(50, 1000)]);
        await t.settle();
        streamer.update([at(50, 1000)]);
        await t.settle();
        t.calls.length = 0;
        streamer.update([at(500, 1000)]);
        await flush();
        expect(t.calls).toEqual([`load:${near}`]);
    });

    it('that fails to load does not hold its cell in the world', async () => {
        const t = host();
        t.failing.add(near);
        const streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(50)]);
        await t.settle();
        streamer.update([at(50)]);
        await t.settle();
        streamer.update([at(500)]);
        await t.settle();
        streamer.update([at(500)]);
        await t.settle();
        expect(t.loaded.has('c_0_0')).toBe(false);
    });

    it('is released with the world', async () => {
        const t = host();
        const streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(500)]);
        const cleared = streamer.clear();
        await t.settle();
        await cleared;
        expect(t.loaded.size).toBe(0);
    });

    it('is ignored by a manifest with no far distance', async () => {
        const t = host();
        const streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(undefined, cell(0)));
        streamer.update([at(500)]);
        await t.settle();
        expect(t.calls).toEqual([]);
    });
});

describe('what a far proxy is made of', () => {
    const entity = (id: number, parent: number | null, components: Array<{ type: string; data: Record<string, unknown> }>) =>
        ({ id, name: `e${id}`, parent, children: [], visible: true, components });
    const renderer = (data: Record<string, unknown> = {}) => ({ type: 'MeshRenderer', data: { mesh: 'builtin:cube', opaque: true, ...data } });
    const place = (x: number) => ({ type: 'Transform', data: { position: { x, y: 0, z: 0 } } });

    it('takes static opaque meshes, placed through their parents, and says why it left the rest out', async () => {
        const scene = {
            version: 4, name: 'cell', entities: [
                entity(1, null, [place(10)]),
                entity(2, 1, [place(5), renderer()]),
                entity(3, null, [place(0), renderer({ opaque: false })]),
                entity(4, null, [place(0), renderer({ enabled: false })]),
                entity(5, null, [place(0), { type: 'RigidBody3D', data: { bodyType: 2 } }]),
                entity(6, 5, [place(0), renderer()]),
                entity(7, null, [place(0), { type: 'RigidBody3D', data: { bodyType: 0 } }, renderer()]),
                entity(8, null, [place(0), renderer(), { type: 'MeshSkin', data: {} }]),
            ],
        } as unknown as SceneData;
        const { surfaces, skipped } = await farProxySurfaces(scene, async () => null);
        expect(surfaces.map((s) => s.entity)).toEqual([2, 7]);
        expect(surfaces[0]!.world[12]).toBe(15);
        expect(skipped).toEqual([
            { entity: 3, reason: 'blended' }, { entity: 4, reason: 'disabled' },
            { entity: 6, reason: 'moves' }, { entity: 8, reason: 'skinned' },
        ]);
    });

    it('is asked for only by a world that ticks it', () => {
        const declared = (data: Record<string, unknown>) =>
            ({ version: 4, name: 'w', entities: [entity(1, null, [{ type: 'StreamedWorld', data }])] }) as unknown as SceneData;
        expect(farProxySettings(declared({ cellSize: 100 }))).toBeNull();
        expect(farProxySettings(declared({ cellSize: 100, farProxies: true, farDistance: 500 })))
            .toEqual({ farDistance: 500, ratio: 0.1, maxWorldError: 1 });
    });
});
