// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { MaterialResult } from '../src/asset/AssetLoader';
import { ScriptGraphAssetLoader } from '../src/asset/loaders/ScriptGraphAssetLoader';
import type { CompiledScriptGraph } from '../src/logic/ScriptGraphRunner';
import { seedEngineComponents } from '../src/ecs/component';
import '../src/logic';

const gpu = vi.hoisted(() => ({ next: 1, live: new Set<number>(), compiled: [] as Array<{ source: string; features: string[] }>, released: [] as number[] }));
vi.mock('../src/wasm/resourceManager', () => ({ requireResourceManager: () => ({}), getResourceManager: () => null }));
vi.mock('../src/render/material', () => ({ Material: {
    compileShader: vi.fn((source: string, features: string[]) => {
        gpu.compiled.push({ source, features: [...features] });
        if (source === 'invalid') return 0;
        const handle = gpu.next++; gpu.live.add(handle); return handle;
    }),
    noteProgram: vi.fn(),
    releaseShader: vi.fn((handle: number) => { gpu.live.delete(handle); gpu.released.push(handle); }),
    createFromAsset: vi.fn(() => gpu.next++), release: vi.fn(), setUniform: vi.fn(), tex: vi.fn(),
} }));

function realm() {
    const docs: Record<string, string> = { 'fx.esshader': 'original', 'other.esshader': 'other' };
    const material = (shader: string, switches = {}) => JSON.stringify({ type: 'material', shader, properties: {}, switches });
    docs['a.esmaterial'] = material('fx.esshader'); docs['b.esmaterial'] = material('fx.esshader');
    docs['variant.esmaterial'] = material('fx.esshader', { GLOW: true }); docs['other.esmaterial'] = material('other.esshader');
    const fetchText = vi.fn(async (path: string) => { const value = docs[path]; if (value === undefined) throw new Error('missing ' + path); return value; });
    const assets = Assets.create({ module: null, backend: { resolveUrl: p => p, fetchText, fetchBinary: async () => new ArrayBuffer(0) } });
    const acquire = (ref: string) => assets.acquireTyped<MaterialResult>('material', ref);
    return { docs, assets, acquire, fetchText, material };
}

describe('material shaders use the asset ownership and source graph', () => {
    beforeEach(() => { gpu.next = 1; gpu.live.clear(); gpu.compiled.length = 0; gpu.released.length = 0; vi.clearAllMocks(); });

    it('shared materials retain one compiled program until their final receipt retires', async () => {
        const { assets, acquire } = realm(); const a = await acquire('a.esmaterial'), b = await acquire('b.esmaterial');
        expect(a.value.shaderHandle).toBe(b.value.shaderHandle); expect(gpu.compiled).toHaveLength(1);
        a.release(); expect(gpu.live.size).toBe(1); b.release(); expect(gpu.live.size).toBe(0);
        expect(gpu.released).toHaveLength(1); expect(assets.sizes().refRows).toBe(0);
    });

    it('the shared shader remains owned by every material, including a cache-hit preparation', async () => {
        const { assets, acquire } = realm(); const a = await acquire('a.esmaterial'), b = await acquire('b.esmaterial');
        for (const ref of ['a.esmaterial', 'b.esmaterial']) expect(assets.dependenciesOf('material', ref))
            .toContainEqual({ kind: 'owned', type: 'material-shader', path: 'fx.esshader' });
        a.release(); b.release();
    });

    it('shader edits compile a new era while held old materials keep their exact program', async () => {
        const { assets, docs, acquire } = realm(); const old = await acquire('a.esmaterial');
        docs['fx.esshader'] = 'changed'; assets.invalidate('fx.esshader'); await assets.assetGraphSettled();
        const fresh = await acquire('a.esmaterial'); expect(fresh.value.shaderHandle).not.toBe(old.value.shaderHandle);
        expect(gpu.compiled.at(-1)?.source).toBe('changed'); expect(gpu.live.size).toBe(2);
        old.release(); expect(gpu.live.has(fresh.value.shaderHandle)).toBe(true); expect(gpu.live.size).toBe(1);
        fresh.release(); expect(gpu.live.size).toBe(0);
    });

    it('one source read feeds distinct switch permutations and retires all programs with that source era', async () => {
        const { acquire, fetchText } = realm(); const a = await acquire('a.esmaterial'), b = await acquire('variant.esmaterial');
        expect(a.value.shaderHandle).not.toBe(b.value.shaderHandle); expect(gpu.compiled.map(c => c.features)).toEqual([[], ['GLOW']]);
        expect(fetchText.mock.calls.filter(([path]) => path === 'fx.esshader')).toHaveLength(1);
        a.release(); expect(gpu.live.size).toBe(2); b.release(); expect(gpu.live.size).toBe(0);
    });

    it('restoring missing shader source clears the material failure cooldown immediately', async () => {
        const { assets, docs, acquire } = realm(); delete docs['fx.esshader'];
        await expect(acquire('a.esmaterial')).rejects.toThrow(/missing/);
        docs['fx.esshader'] = 'restored'; assets.invalidate('fx.esshader');
        const owner = await acquire('a.esmaterial'); expect(gpu.compiled.at(-1)?.source).toBe('restored'); owner.release();
        expect(gpu.live.size).toBe(0);
    });

    it('restoring a failed compilation clears the material failure cooldown immediately', async () => {
        const { assets, docs, acquire } = realm(); docs['fx.esshader'] = 'invalid';
        await expect(acquire('a.esmaterial')).rejects.toThrow(/compile/);
        docs['fx.esshader'] = 'fixed'; assets.invalidate('fx.esshader');
        const owner = await acquire('a.esmaterial'); expect(gpu.compiled.at(-1)?.source).toBe('fixed'); owner.release();
        expect(gpu.live.size).toBe(0);
    });

    it('shader invalidation leaves another source and its compiled program untouched', async () => {
        const { assets, docs, acquire } = realm(); const a = await acquire('a.esmaterial'), b = await acquire('other.esmaterial');
        docs['fx.esshader'] = 'changed'; assets.invalidate('fx.esshader'); await assets.assetGraphSettled();
        const fresh = await acquire('a.esmaterial'); expect(gpu.compiled.filter(c => c.source === 'other')).toHaveLength(1);
        expect(fresh.value.shaderHandle).not.toBe(a.value.shaderHandle); expect(gpu.live.has(b.value.shaderHandle)).toBe(true);
        a.release(); b.release(); fresh.release(); expect(gpu.live.size).toBe(0);
    });

    it('builtin shader code has the same lease lifecycle and bypasses file ref resolvers', async () => {
        const { assets, docs, acquire, material, fetchText } = realm();
        docs['a.esmaterial'] = material('builtin:sprite-unlit');
        assets.setAssetRefResolver(ref => ref.startsWith('builtin:') ? 'wrong/' + ref : ref);
        const owner = await acquire('a.esmaterial'); expect(fetchText.mock.calls.map(([path]) => path)).toEqual(['a.esmaterial']);
        expect(gpu.compiled[0].source).toContain('#pragma shader "Sprite Unlit"'); owner.release(); expect(gpu.live.size).toBe(0);
    });

    it('wholesale release returns every shader generation and old receipts cannot free them twice', async () => {
        const { assets, acquire } = realm(); const a = await acquire('a.esmaterial'), b = await acquire('variant.esmaterial');
        assets.releaseAll(); expect(gpu.live.size).toBe(0); expect(gpu.released).toHaveLength(2);
        a.release(); b.release(); expect(gpu.released).toHaveLength(2); expect(assets.sizes().refRows).toBe(0);
    });

    it('failed shader refresh preserves a held spawn graph, and a source repair replaces it', async () => {
        seedEngineComponents();
        const { assets, docs } = realm(); assets.register(new ScriptGraphAssetLoader());
        docs['root.esprefab'] = JSON.stringify({ version: '2', name: 'shader sprite', rootEntityId: 'root',
            entities: [{ prefabEntityId: 'root', name: 'root', parent: null, children: [], visible: true,
                components: [{ type: 'Transform', data: {} }, { type: 'Sprite', data: { material: 'a.esmaterial' } }] }] });
        docs['spawn.esgraph'] = JSON.stringify({ version: '1.0', name: 'held graph',
            nodes: [{ id: 'spawn', kind: 'entity.spawn', literals: { prefab: 'root.esprefab' } }], edges: [] });
        const owner = await assets.acquireTyped('scriptgraph', 'spawn.esgraph');
        const graph = () => assets.resolveRegistryAsset<CompiledScriptGraph>('scriptgraph', 'spawn.esgraph')!;
        const old = graph(), oldShader = [...gpu.live][0];
        docs['fx.esshader'] = 'invalid'; assets.invalidate('fx.esshader'); await assets.assetGraphSettled();
        expect(graph()).toBe(old); expect(gpu.live.has(oldShader)).toBe(true);
        docs['fx.esshader'] = 'fixed'; assets.invalidate('fx.esshader'); await assets.assetGraphSettled();
        expect(graph()).not.toBe(old); expect(gpu.compiled.at(-1)?.source).toBe('fixed');
        expect(gpu.live.has(oldShader)).toBe(false); expect(gpu.live.size).toBe(1);
        owner.release(); expect(gpu.live.size).toBe(0); expect(assets.sizes().refRows).toBe(0);
    });
});
