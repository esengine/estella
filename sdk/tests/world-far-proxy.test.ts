// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world-far-proxy.test.ts
 * @brief   Verify a cell's far proxy stands in for it with no gap, and which surfaces a proxy is made of.
 */
import { describe, it, expect } from 'vitest';
import type { WorldCell, WorldManifest, ResidencySource } from '../src/residency/cells';
import { WorldStreamer, type WorldStreamHost } from '../src/residency/WorldStreamer';
import { farProxySettings, farProxySurfaces, farProxySceneName, assembleFarProxies } from '../src/residency/farProxy';
import { MeshChannel } from '../src/asset/meshFormat';
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

    it('leaves out a subtree that says so, as what a game turns itself cannot be baked where it stands', async () => {
        const scene = {
            version: 4, name: 'cell', entities: [
                entity(1, null, [place(0), renderer()]),
                entity(2, null, [place(20), { type: 'ExcludeFromFarProxy', data: {} }]),
                entity(3, 2, [place(0), renderer()]),
                entity(4, 3, [place(0), renderer()]),
            ],
        } as unknown as SceneData;
        const { surfaces, skipped } = await farProxySurfaces(scene, async () => null);
        expect(surfaces.map((s) => s.entity)).toEqual([1]);
        expect(skipped).toEqual([{ entity: 3, reason: 'excluded' }, { entity: 4, reason: 'excluded' }]);
    });

    it('is asked for only by a world that ticks it', () => {
        const declared = (data: Record<string, unknown>) =>
            ({ version: 4, name: 'w', entities: [entity(1, null, [{ type: 'StreamedWorld', data }])] }) as unknown as SceneData;
        expect(farProxySettings(declared({ cellSize: 100 }))).toBeNull();
        expect(farProxySettings(declared({ cellSize: 100, farProxies: true, farDistance: 500 })))
            .toEqual({ farDistance: 500, ratio: 0.01, maxWorldError: 1 });
    });

    it('draws surfaces that differ only in tint as one, the tint carried by the vertices, and drops the lightmap UV', async () => {
        const red = { r: 1, g: 0.2, b: 0.2, a: 1 }, blue = { r: 0.2, g: 0.2, b: 1, a: 1 };
        const scene = {
            version: 4, name: 'cell', entities: [
                entity(1, null, [place(10), renderer({ color: red })]),
                entity(2, null, [place(30), renderer({ color: blue })]),
            ],
        } as unknown as SceneData;
        const cell: WorldCell = { name: 'w.cell_0_0', path: 'world/w.cell_0_0.json', x: 0, z: 0,
            minX: 0, minZ: 0, maxX: 100, maxZ: 100, entityCount: 2, rootCount: 2 };
        const cut = { manifest: { version: 1, scene: 'w', cellSize: 100, persistentRefs: [], cells: [cell] },
            persistent: scene, documents: new Map([[cell.name, scene]]), errors: [], warnings: [] };
        const [proxy] = await assembleFarProxies(cut, { farDistance: 500, ratio: 1, maxWorldError: 0 },
            { loadPrefab: async () => null, readMesh: async () => null });
        expect(proxy!.meshes).toHaveLength(1);
        const drawn = proxy!.document.entities[0]!.components.find((c) => c.type === 'MeshRenderer')!.data as { color: unknown };
        expect(drawn.color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
        const mesh = proxy!.meshes[0]!.mesh;
        expect(mesh.channels.some((c) => c.semantic === MeshChannel.TexCoord1)).toBe(false);
        const colour = mesh.channels.find((c) => c.semantic === MeshChannel.Color)!;
        const reds = new Set<string>();
        for (let v = 0; v < mesh.vertexCount; v++) {
            const at = v * mesh.vertexStride + colour.offset;
            reds.add(`${mesh.vertices[at]},${mesh.vertices[at + 2]}`);
        }
        // Both tints are in the one mesh: red-heavy vertices and blue-heavy ones.
        expect([...reds].some((rb) => { const [r, b] = rb.split(',').map(Number); return r! > b! * 3; })).toBe(true);
        expect([...reds].some((rb) => { const [r, b] = rb.split(',').map(Number); return b! > r! * 3; })).toBe(true);
    });
});
