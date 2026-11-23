// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import { seedEngineComponents, defineComponent } from '../src/ecs/component';
import { ScriptGraphAssetLoader } from '../src/asset/loaders/ScriptGraphAssetLoader';
import { RuntimeConfig } from '../src/defaults';
import type { CompiledScriptGraph } from '../src/logic/ScriptGraphRunner';
import type { Backend } from '../src/asset/Backend';
import type { PrefabData } from '../src/prefab';
import '../src/logic';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({}), getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

const REF = 'root.esprefab';
const leaf = (name: string): PrefabData => ({ version: '2', name, rootEntityId: 'root', entities: [
    { prefabEntityId: 'root', name, parent: null, children: [], visible: true,
      components: [{ type: 'Transform', data: {} }] },
] });
function realm(root: PrefabData = leaf('before')) {
    seedEngineComponents();
    const docs = new Map<string, string>([[REF, JSON.stringify(root)], ['child.esprefab', JSON.stringify(leaf('child-before'))]]);
    const assets = Assets.create({ catalog: Catalog.empty(), module: null as never, backend: {
        resolveUrl: (p: string) => p,
        fetchText: async (p: string) => {
            if (p.endsWith('.esgraph') && !docs.has(p)) return JSON.stringify({ version: '1.0', name: p,
                nodes: [{ id: 'spawn', kind: 'entity.spawn', literals: { prefab: REF } }], edges: [] });
            const text = docs.get(p); if (!text) throw new Error(`Missing ${p}`); return text;
        }, fetchBinary: async () => new ArrayBuffer(0),
    } as Backend });
    assets.register(new ScriptGraphAssetLoader());
    const graph = (ref: string) => assets.resolveRegistryAsset<CompiledScriptGraph>('scriptgraph', ref)!;
    return { assets, docs, graph };
}

describe('prepared prefab ownership through the real Assets and graph loaders', () => {
    it('prepares the rest of a prefab when its agent points back to the spawning graph', async () => {
        const root = leaf('recursive spawn');
        root.entities[0].components.push({ type: 'ScriptGraphAgent', data: { graph: 'a.esgraph' } });
        const { assets, docs, graph } = realm(root);
        vi.useFakeTimers();
        try {
            const loading = assets.acquireTyped('scriptgraph', 'a.esgraph');
            await vi.advanceTimersByTimeAsync(RuntimeConfig.assetLoadTimeout + 1);
            const lease = await loading;
            expect(graph('a.esgraph').prefabs.get(REF)?.missing).toEqual(['a.esgraph']);
            expect(lease.failedDependencies).toContain('a.esgraph');
            docs.set(REF, JSON.stringify(leaf('repaired')));
            assets.invalidate(REF);
            await assets.assetGraphSettled();
            expect(graph('a.esgraph').prefabs.get(REF)?.missing).toEqual([]);
            expect(lease.failedDependencies).toEqual([]);
            lease.release();
            expect(assets.sizes()).toMatchObject({ registrySlots: 0, refRows: 0, genericCached: 0, pendingLoads: 0 });
        } finally { assets.releaseAll(); vi.useRealTimers(); }
    });

    it('keeps a published graph when a refresh would make it hold its own live recipe', async () => {
        const root = leaf('live agent');
        root.entities[0].components.push({ type: 'ScriptGraphAgent', data: { graph: 'a.esgraph' } });
        const { assets, docs, graph } = realm(root);
        docs.set('a.esgraph', JSON.stringify({ version: '1.0', nodes: [], edges: [] }));
        try {
            const recipe = await assets.acquireTyped('prepared-prefab', REF);
            const original = graph('a.esgraph');
            expect(original).toBeDefined();
            docs.delete('a.esgraph');
            assets.invalidate('a.esgraph');
            await assets.assetGraphSettled();
            expect(graph('a.esgraph')).toBe(original);
            recipe.release();
            expect(assets.sizes()).toMatchObject({ registrySlots: 0, refRows: 0, genericCached: 0 });
        } finally { assets.releaseAll(); }
    });

    it.each(['nested', 'base', 'deep-nested'] as const)('recovers an initially missing %s source without reloading its held graph', async (kind) => {
        const nested = (name: string, path: string) => {
            const root = leaf(name); root.entities[0].children = ['slot'];
            root.entities.push({ prefabEntityId: 'slot', name: 'slot', parent: 'root', children: [], visible: true,
                components: [], nestedPrefab: { prefabPath: path, overrides: [] } });
            return root;
        };
        const root = kind === 'base' ? { ...leaf('variant'), entities: [], basePrefab: 'child.esprefab' }
            : nested('parent', 'child.esprefab');
        const { assets, docs, graph } = realm(root);
        const missing = kind === 'deep-nested' ? 'grandchild.esprefab' : 'child.esprefab';
        if (kind === 'deep-nested') docs.set('child.esprefab', JSON.stringify(nested('middle', missing)));
        docs.delete(missing);
        try {
            const lease = await assets.acquireTyped('scriptgraph', 'a.esgraph');
            expect(graph('a.esgraph').prefabs.size).toBe(0);
            docs.set(missing, JSON.stringify(leaf('restored')));
            assets.invalidate(missing); await assets.assetGraphSettled();
            expect(graph('a.esgraph').prefabs.get(REF)?.scene.entities.some(e => e.name === 'restored')).toBe(true);
            expect(assets.dependenciesOf('scriptgraph', 'a.esgraph').some(e => e.kind === 'owned' && e.type === 'prepared-prefab')).toBe(true);
            lease.release();
            expect(assets.sizes()).toMatchObject({ refRows: 0, registrySlots: 0, genericCached: 0 });
        } finally { assets.releaseAll(); }
    });

    it('coalesces concurrent preparations shared by independent graphs', async () => {
        const { assets, graph } = realm();
        try {
            const leases = await Promise.all(['a.esgraph', 'b.esgraph'].map(p => assets.acquireTyped('scriptgraph', p)));
            expect(graph('a.esgraph').prefabs.get(REF)).toBe(graph('b.esgraph').prefabs.get(REF));
            leases[0].release();
            const third = await assets.acquireTyped('scriptgraph', 'c.esgraph');
            expect(graph('c.esgraph').prefabs.get(REF)).toBe(graph('b.esgraph').prefabs.get(REF));
            third.release(); leases[1].release();
        } finally { assets.releaseAll(); }
    });

    it.each([new Error('shared failure'), 'primitive failure'])('preserves rejection identity and separates concurrent failed preparations (%s)', async (reason) => {
        const nested = (path: string) => {
            const root = leaf(path); root.entities[0].children = ['slot'];
            root.entities.push({ prefabEntityId: 'slot', name: 'slot', parent: 'root', children: [], visible: true,
                components: [], nestedPrefab: { prefabPath: path, overrides: [] } });
            return root;
        };
        const { assets, docs, graph } = realm(nested('one.esprefab'));
        docs.set('other.esprefab', JSON.stringify(nested('two.esprefab')));
        const original = assets.backend.fetchText;
        assets.backend.fetchText = async (path) => {
            if (path.endsWith('.esgraph')) return JSON.stringify({ version: '1.0', name: path,
                nodes: [{ id: 'spawn', kind: 'entity.spawn', literals: { prefab: path === 'a.esgraph' ? REF : 'other.esprefab' } }], edges: [] });
            if ((path === 'one.esprefab' || path === 'two.esprefab') && !docs.has(path)) throw reason;
            return original(path);
        };
        try {
            const leases = await Promise.all(['a.esgraph', 'b.esgraph'].map(path => assets.acquireTyped('scriptgraph', path)));
            expect(assets.dependenciesOf('scriptgraph', 'a.esgraph').some(e => e.path === 'two.esprefab')).toBe(false);
            expect(assets.dependenciesOf('scriptgraph', 'b.esgraph').some(e => e.path === 'one.esprefab')).toBe(false);
            await expect(assets.acquireTyped('prepared-prefab', REF)).rejects.toBe(reason);
            await expect(assets.loadPrefab('one.esprefab')).rejects.toBe(reason);
            docs.set('one.esprefab', JSON.stringify(leaf('one-restored')));
            assets.invalidate('one.esprefab'); await assets.assetGraphSettled();
            expect(graph('a.esgraph').prefabs.get(REF)?.scene.entities.some(e => e.name === 'one-restored')).toBe(true);
            expect(graph('b.esgraph').prefabs.size).toBe(0);
            docs.set('two.esprefab', JSON.stringify(leaf('two-restored')));
            assets.invalidate('two.esprefab'); await assets.assetGraphSettled();
            expect(graph('b.esgraph').prefabs.get('other.esprefab')?.scene.entities.some(e => e.name === 'two-restored')).toBe(true);
            for (const lease of leases) lease.release();
            expect(assets.sizes()).toMatchObject({ refRows: 0, registrySlots: 0, genericCached: 0 });
        } finally { assets.releaseAll(); }
    });

    it('rebuilds a held graph from new top-level source without mutating the retired recipe', async () => {
        const { assets, docs, graph } = realm();
        try {
            const lease = await assets.acquireTyped('scriptgraph', 'a.esgraph');
            const before = graph('a.esgraph').prefabs.get(REF)!;
            docs.set(REF, JSON.stringify(leaf('after')));
            assets.invalidate(REF); await assets.assetGraphSettled();
            const after = graph('a.esgraph').prefabs.get(REF)!;
            expect(after.scene.entities[0].name).toBe('after');
            expect(after).not.toBe(before);
            expect(before.scene.entities[0].name).toBe('before');
            lease.release();
        } finally { assets.releaseAll(); }
    });

    it('propagates a nested source update through the prepared recipe to its held graph', async () => {
        const root = leaf('parent'); root.entities[0].children = ['slot'];
        root.entities.push({ prefabEntityId: 'slot', name: 'slot', parent: 'root', children: [], visible: true,
            components: [], nestedPrefab: { prefabPath: 'child.esprefab', overrides: [] } });
        const { assets, docs, graph } = realm(root);
        try {
            const lease = await assets.acquireTyped('scriptgraph', 'a.esgraph');
            expect(graph('a.esgraph').prefabs.get(REF)!.scene.entities.some(e => e.name === 'child-before')).toBe(true);
            docs.set('child.esprefab', JSON.stringify(leaf('child-after')));
            assets.invalidate('child.esprefab'); await assets.assetGraphSettled();
            expect(graph('a.esgraph').prefabs.get(REF)!.scene.entities.some(e => e.name === 'child-after')).toBe(true);
            const usable = graph('a.esgraph');
            docs.set('child.esprefab', '{broken');
            assets.invalidate('child.esprefab'); await assets.assetGraphSettled();
            expect(graph('a.esgraph')).toBe(usable);
            docs.set('child.esprefab', JSON.stringify(leaf('child-recovered')));
            assets.invalidate('child.esprefab'); await assets.assetGraphSettled();
            expect(graph('a.esgraph').prefabs.get(REF)!.scene.entities.some(e => e.name === 'child-recovered')).toBe(true);
            lease.release();
        } finally { assets.releaseAll(); }
    });

    it('holds resolved resource generations until their last recipe owner retires', async () => {
        defineComponent('PrefabMeshProbe', { mesh: 0 }, { assetFields: [{ field: 'mesh', type: 'mesh' }] });
        const root = leaf('with-resource');
        root.entities[0].components.push({ type: 'PrefabMeshProbe', data: { mesh: 'shape.esmesh' } });
        const { assets, graph } = realm(root);
        let next = 1;
        const live = new Set<number>();
        const unload = vi.fn(({ handle }: { handle: number }) => { expect(live.delete(handle)).toBe(true); });
        assets.register({ type: 'mesh', extensions: ['.esmesh'], load: async () => {
            const handle = next++; live.add(handle); return { handle };
        }, unload });
        try {
            const leases = await Promise.all(['a.esgraph', 'b.esgraph'].map(p => assets.acquireTyped('scriptgraph', p)));
            const before = graph('a.esgraph').prefabs.get(REF)!;
            expect(live.size).toBe(1);
            const beforeHandle = before.scene.entities[0].components.find(c => c.type === 'PrefabMeshProbe')!.data.mesh;
            assets.invalidate('shape.esmesh'); await assets.assetGraphSettled();
            const after = graph('a.esgraph').prefabs.get(REF)!;
            expect(after.scene.entities[0].components.find(c => c.type === 'PrefabMeshProbe')!.data.mesh).not.toBe(beforeHandle);
            expect(graph('b.esgraph').prefabs.get(REF)).toBe(after);
            expect(live.size).toBe(1);
            expect(unload).toHaveBeenCalledTimes(1);
            leases[0].release(); expect(live.size).toBe(1);
            leases[1].release(); expect(live.size).toBe(0);
            expect(unload).toHaveBeenCalledTimes(2);
            expect(assets.sizes()).toMatchObject({ refRows: 0, registrySlots: 0, genericCached: 0 });
        } finally { assets.releaseAll(); }
    });

    it('keeps an old held graph usable when changed source fails to prepare', async () => {
        const { assets, docs, graph } = realm();
        try {
            const lease = await assets.acquireTyped('scriptgraph', 'a.esgraph');
            const before = graph('a.esgraph').prefabs.get(REF)!;
            docs.set(REF, '{broken'); assets.invalidate(REF); await assets.assetGraphSettled();
            expect(graph('a.esgraph').prefabs.get(REF)).toBe(before);
            docs.set(REF, JSON.stringify(leaf('recovered')));
            assets.invalidate(REF); await assets.assetGraphSettled();
            expect(graph('a.esgraph').prefabs.get(REF)!.scene.entities[0].name).toBe('recovered');
            lease.release();
        } finally { assets.releaseAll(); }
    });

    it('retries an initially missing prefab after its source becomes available', async () => {
        const { assets, docs, graph } = realm(); docs.delete(REF);
        try {
            const lease = await assets.acquireTyped('scriptgraph', 'a.esgraph');
            expect(graph('a.esgraph').prefabs.size).toBe(0);
            docs.set(REF, JSON.stringify(leaf('now-present')));
            assets.invalidate(REF); await assets.assetGraphSettled();
            expect(graph('a.esgraph').prefabs.get(REF)!.scene.entities[0].name).toBe('now-present');
            lease.release();
        } finally { assets.releaseAll(); }
    });
});
