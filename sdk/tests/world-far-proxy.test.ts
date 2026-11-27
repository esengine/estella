// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world-far-proxy.test.ts
 * @brief   Verify a cell's far proxy stands in for it with no gap, and which surfaces a proxy is made of.
 */
import { describe, it, expect, vi } from 'vitest';
import type { WorldCell, WorldManifest, ResidencySource } from '../src/residency/cells';
import { WorldStreamer, type WorldStreamHost } from '../src/residency/WorldStreamer';
import { farProxySettings, farProxySurfaces, farProxySceneName, assembleFarProxies, createFarProxyBuilder, deferFarProxies } from '../src/residency/farProxy';
import type { CutWorld } from '../src/residency/cutWorld';
import type { PrefabData } from '../src/prefab/types';
import { MeshChannel } from '../src/asset/meshFormat';
import { loadSceneData, type SceneData } from '../src/scene/scene';
import { Transform, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

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

    it('uses the current far distance independently of the cell radii', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        const manifest = world(399, cell(0), ...Array.from({ length: 100 }, (_, i) => cell(10 + i)));
        await streamer.loadManifest(manifest);
        let reads = 0;
        const focus = { ...at(500), get x() { reads++; return 500; } };
        streamer.update([focus]);
        await t.settle();
        expect(streamer.status().proxyCells).toEqual([]);
        manifest.farDistance = 400;
        streamer.update([focus]);
        await t.settle();
        expect(streamer.status().proxyCells).toEqual(['c_0_0']);
        expect(reads).toBeLessThan(16);
        manifest.farDistance = 0;
        streamer.update([focus]);
        await t.settle();
        expect(t.loaded.size).toBe(0);
    });

    it('does not prepare a zero-distance proxy even while the near cell is loading under the source', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        const prepare = vi.spyOn(t.h, 'prepare');
        const manifest = world(0, cell(0));
        await streamer.loadManifest(manifest);
        streamer.update([at(50)]);
        await t.settle();
        expect(prepare.mock.calls).toEqual([['c_0_0']]);
        expect(streamer.status().proxyCells).toEqual([]);
        manifest.farDistance = 500;
        streamer.update([at(320)]);
        await t.settle();
        expect(streamer.status().proxyCells).toEqual(['c_0_0']);
        manifest.farDistance = 0;
        streamer.update([at(320)]);
        await t.settle();
        expect(streamer.status().proxyCells).toEqual([]);
    });

    it('uses the proxy radius around each of two separated sources', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(400, cell(0), cell(15), cell(30)));
        streamer.update([at(500), at(2600)]);
        await t.settle();
        expect(streamer.status().residentCells).toEqual([]);
        expect(streamer.status().proxyCells).toEqual(['c_0_0', 'c_30_0']);
    });

    it('uses the exact distance at a proxy corner while another source stays in range', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(400, cell(0), cell(15), cell(30)));
        const right = at(2600);
        streamer.update([{ ...at(380), z: 380 }, right]);
        await t.settle();
        expect(streamer.status().proxyCells).toEqual(['c_0_0', 'c_30_0']);

        // Both axis distances are 300, but the corner is farther than 400.
        streamer.update([{ ...at(400), z: 400 }, right]);
        await t.settle();
        expect(streamer.status().proxyCells).toEqual(['c_30_0']);

        // A wider near reach can still prepare a cell outside the proxy circle.
        streamer.update([{ ...at(400, 450), z: 400 }, right]);
        await t.settle();
        expect(streamer.status().preparedCells).toEqual(['c_0_0']);
        expect(streamer.status().proxyCells).toEqual(['c_30_0']);
    });

    it('rejects distant cells for both near and proxy residency in one bounds read', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        let reads = 0;
        const distant = Array.from({ length: 1024 }, (_, i) => {
            const entry = cell(i + 100);
            const minX = entry.minX;
            return { ...entry, get minX() { reads++; return minX; } };
        });
        await streamer.loadManifest(world(400, cell(0), ...distant));
        reads = 0; // Only count reconciliation reads after manifest validation.
        streamer.update([at(500)]);
        await t.settle();
        expect(streamer.status().proxyCells).toEqual(['c_0_0']);
        expect(reads).toBe(distant.length);
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

    it('keeps the cell until its proxy can prove render program readiness', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        let ready = false;
        t.h.readyRenderPrograms = async name => name !== near ? { applicable: false } : {
            applicable: true, stamp: ready ? { digestLo: 1, digestHi: 0, programEpoch: 1 } : null,
        };
        const prepare = vi.spyOn(t.h, 'prepare');
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(50)]); await t.settle();
        expect(t.loaded.has('c_0_0')).toBe(true);

        streamer.update([at(500)]); await t.settle();
        streamer.update([at(500)]); await t.settle();
        expect(t.calls).not.toContain(`load:${near}`);
        expect(t.loaded.has('c_0_0')).toBe(true);
        ready = true;
        streamer.update([at(500)]); await t.settle();
        expect(t.loaded.has(near)).toBe(true);
        expect(prepare.mock.calls.filter(([name]) => name === near)).toHaveLength(1);
        streamer.update([at(500)]); await t.settle();
        expect(t.loaded.has('c_0_0')).toBe(false);
    });

    it.each(['assets', 'programs'])('discards a proxy whose %s finish after the source leaves range', async phase => {
        const t = host(), streamer = new WorldStreamer(t.h);
        let finishPreparation!: () => void;
        const pending = () => new Promise<void>(resolve => { finishPreparation = resolve; });
        if (phase === 'assets') t.h.prepare = pending;
        else t.h.readyRenderPrograms = async () => { await pending(); return { applicable: false }; };
        const discard = vi.spyOn(t.h, 'discardPrepared');
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(500)]);
        await flush();
        streamer.update([at(3000)]);
        finishPreparation();
        await t.settle();
        expect(t.calls).not.toContain(`load:${near}`);
        expect(discard).toHaveBeenCalledWith(near);
        expect(streamer.status().proxyCells).toEqual([]);
    });

    it('releases a prepared proxy on clear if it is waiting for programs', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        t.h.readyRenderPrograms = async () => ({ applicable: true, stamp: null });
        const discard = vi.spyOn(t.h, 'discardPrepared');
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(500)]); await t.settle();
        await streamer.clear();
        expect(t.calls).not.toContain(`load:${near}`);
        expect(discard).toHaveBeenCalledTimes(1);
        expect(discard).toHaveBeenCalledWith(near);
    });

    it('keeps a visible proxy until a failed near cell can finish retrying', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(500)]); await t.settle();
        t.failing.add('c_0_0');
        streamer.update([at(50)]); await t.settle();
        expect(t.loaded.has(near)).toBe(true);
        expect(t.loaded.has('c_0_0')).toBe(false);
        t.failing.delete('c_0_0');
        streamer.update([at(50)]); await t.settle();
        streamer.update([at(50)]); await t.settle();
        expect(t.loaded.has('c_0_0')).toBe(true);
        expect(t.loaded.has(near)).toBe(false);
    });

    it('allows one fresh proxy attempt after a failed reach is left and entered again', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        t.failing.add(near);
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(500)]); await t.settle();
        streamer.update([at(500)]); await t.settle();
        expect(t.calls.filter(call => call === `load:${near}`)).toHaveLength(1);
        streamer.update([at(3000)]);
        t.failing.delete(near);
        streamer.update([at(500)]); await t.settle();
        expect(t.loaded.has(near)).toBe(true);
    });

    it('retries a failed proxy when the same manifest is reused after clear', async () => {
        const t = host(), streamer = new WorldStreamer(t.h);
        t.failing.add(near);
        await streamer.loadManifest(world(1000, cell(0)));
        streamer.update([at(500)]); await t.settle();
        expect(t.loaded.has(near)).toBe(false);
        await streamer.clear();
        t.failing.delete(near);
        streamer.update([at(500)]); await t.settle();
        expect(t.loaded.has(near)).toBe(true);
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

    it('matches the loaded world when an absent parent differs from an inactive parent', async () => {
        const scene = {
            version: 4, name: 'cell', entities: [
                { ...entity(1, null, [place(30), { type: 'ExcludeFromFarProxy', data: {} }]), visible: false },
                entity(2, 1, [place(8), renderer()]),
                entity(3, null, [place(20), { type: 'Disabled', data: {} }]),
                entity(4, 3, [place(5), renderer()]),
            ],
        } as unknown as SceneData;
        const { surfaces, skipped } = await farProxySurfaces(scene, async () => null);
        expect(surfaces.map(s => [s.entity, s.world[12]])).toEqual([[2, 8]]);
        expect(skipped).toEqual([{ entity: 4, reason: 'disabled' }]);
        if (!HAS_WASM) return;
        ensureBuiltinComponentsRegistered();
        const module = await loadWasmModule();
        const registry = new module.Registry();
        const world = new World();
        world.connectCpp(registry, module);
        try {
            const ids = loadSceneData(world, scene);
            world.ensureTransformsComposed();
            expect(ids.has(1)).toBe(false);
            expect(world.get(ids.get(2)!, Transform).worldPosition.x).toBe(surfaces[0].world[12]);
            expect(world.isEntityActive(ids.get(4)!)).toBe(false);
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it.each(['RigidBody2D', 'RigidBody', 'CharacterController2D'])(
        'keeps a mesh on a moving %s ancestry out of the far proxy', async type => {
            const scene = {
                version: 4, name: 'cell', entities: [
                    entity(1, null, [place(30), { type, data: {} }]),
                    entity(2, 1, [place(2), renderer()]),
                    entity(3, null, [place(12), renderer(), { type: 'RigidBody2D', data: { bodyType: 0 } }]),
                ],
            } as unknown as SceneData;
            const { surfaces, skipped } = await farProxySurfaces(scene, async () => null);
            expect(surfaces.map(s => s.entity)).toEqual([3]);
            expect(skipped).toEqual([{ entity: 2, reason: 'moves' }]);
        },
    );

    it('composes a deep authored hierarchy without exhausting the call stack', async () => {
        const depth = 12000;
        const entities = Array.from({ length: depth }, (_, index) =>
            entity(index + 1, index || null, index === 0 ? [place(30)] : []));
        entities.push(entity(depth + 1, depth, [place(8), renderer()]));
        const scene = { version: 4, name: 'cell', entities } as unknown as SceneData;
        const { surfaces } = await farProxySurfaces(scene, async () => null);
        expect(surfaces.map(s => [s.entity, s.world[12]])).toEqual([[depth + 1, 38]]);
    });

    it('is asked for only by a world that ticks it', () => {
        const declared = (data: Record<string, unknown>) =>
            ({ version: 4, name: 'w', entities: [entity(1, null, [{ type: 'StreamedWorld', data }])] }) as unknown as SceneData;
        expect(farProxySettings(declared({ cellSize: 100 }))).toBeNull();
        expect(farProxySettings(declared({ cellSize: 100, farProxies: true, farDistance: 500 })))
            .toEqual({ farDistance: 500, ratio: 0.01, maxWorldError: 1 });
    });

    it('builds the same proxy for a requested cell without expanding other cells', async () => {
        const cells = Array.from({ length: 128 }, (_, x) => cell(x, false));
        const documents = new Map(cells.map(({ name }) => [name, { version: 4, name, entities: [
            { id: 1, prefab: `${name}.esprefab`, parent: null, overrides: [], added: [], removed: [] },
        ] } as unknown as SceneData]));
        const cut: CutWorld = { manifest: world(undefined, ...cells), persistent: { version: 4, name: 'main', entities: [] },
            documents, errors: [], warnings: [] };
        const prefab: PrefabData = { version: '1.0', name: 'Prop', rootEntityId: 'r', entities: [{
            prefabEntityId: 'r', name: 'Prop', parent: null, children: [], visible: true, components: [place(10), renderer()],
        }] };
        const host = { loadPrefab: vi.fn(async (_ref: string) => prefab), readMesh: async () => null };
        const settings = { farDistance: 500, ratio: 1, maxWorldError: 0 };
        const name = cells[64]!.name;
        const build = createFarProxyBuilder(cut, settings, host);
        const pending = build(name);
        expect(build(name)).toBe(pending);
        const proxy = await pending;
        expect(proxy?.meshes).toHaveLength(1);
        expect(host.loadPrefab.mock.calls).toEqual([[`${name}.esprefab`]]);
        expect(cut.manifest.cells.every(cell => cell.proxy === undefined)).toBe(true);
        expect(cut.manifest.farDistance).toBeUndefined();
        await expect(build('unknown')).resolves.toBeNull();

        const publish = await deferFarProxies(cut, settings, host);
        expect(await publish(name)).toEqual(proxy);
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
