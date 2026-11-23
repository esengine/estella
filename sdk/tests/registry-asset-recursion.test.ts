// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { AssetLease } from '../src/asset/AssetLease';
import { Catalog } from '../src/asset/Catalog';
import { ScriptGraphAssetLoader } from '../src/asset/loaders/ScriptGraphAssetLoader';
import { TimelineAssetLoader } from '../src/asset/loaders/TimelineAssetLoader';
import { RuntimeConfig } from '../src/defaults';
import { SCRIPT_GRAPH_VERSION } from '../src/logic/types';
import type { PublishedTimeline } from '../src/timeline/TimelineTypes';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({}), getResourceManager: () => null, evictTextureDimensions: vi.fn(),
}));

const realms: Assets[] = [];
const timelineLoader = new TimelineAssetLoader();
function realm(fetchText: (path: string) => Promise<string>, catalog?: Catalog) {
    const assets = Assets.create({
        backend: { fetchText, fetchBinary: async () => new ArrayBuffer(0), resolveUrl: path => path },
        catalog, module: null,
    });
    assets.register(timelineLoader);
    realms.push(assets);
    return assets;
}
afterEach(() => { for (const assets of realms.splice(0)) assets.releaseAll(); });

function timeline(...children: string[]) {
    return JSON.stringify({ version: 1, duration: 1, tracks: [{
        type: 'sequence', name: 'Children', clips: children.map(ref => ({ timeline: ref, start: 0, duration: 1 })),
    }] });
}
function barrier() {
    let open!: () => void;
    const wait = new Promise<void>(resolve => { open = resolve; });
    return { wait, open };
}

describe('nested registry assets', () => {
    it('joins a timeline requested synchronously by a loader observer and releases its child once', async () => {
        let observed!: Promise<AssetLease>;
        let preparations = 0;
        const assets = realm(async path => path === 'parent' ? timeline('child') : timeline());
        assets.register({ type: 'timeline', extensions: timelineLoader.extensions, registry: {
            prepare(path, ctx) {
                if (path === 'parent' && ++preparations === 1) observed = assets.acquireTyped('timeline', path);
                return timelineLoader.registry.prepare(path, ctx);
            },
        } });
        const first = await assets.acquireTyped('timeline', 'parent');
        const second = await observed;
        expect(preparations).toBe(1);
        first.release();
        expect(assets.resolveRegistryAsset('timeline', 'child')).toBeDefined();
        second.release();
        expect(assets.sizes().registrySlots).toBe(0);
    });

    it('loads a child in the second realm while the first is preparing its own copy', async () => {
        const entered = barrier(), proceed = barrier();
        const first = realm(async path => {
            if (path === 'leaf') { entered.open(); await proceed.wait; }
            return path === 'shared' ? timeline('leaf') : timeline();
        });
        const second = realm(async path => path === 'intro' ? timeline('shared') : timeline());
        const loading = first.acquireTyped('timeline', 'shared');
        try {
            await entered.wait;
            const intro = await second.acquireTyped('timeline', 'intro');
            expect(second.resolveRegistryAsset('timeline', 'shared')).toBeDefined();
            expect(second.dependenciesOf('timeline', 'intro')).toContainEqual({ type: 'timeline', kind: 'owned', path: 'shared' });
            intro.release();
            expect(second.resolveRegistryAsset('timeline', 'shared')).toBeUndefined();
        } finally {
            proceed.open();
            (await loading).release();
        }
    });

    it('joins a shared in-flight sequence and holds it until both parents retire', async () => {
        const entered = barrier(), proceed = barrier();
        const fetchText = vi.fn(async (path: string) => {
            if (path === 'leaf') { entered.open(); await proceed.wait; }
            return path === 'shared' ? timeline('leaf') : path === 'leaf' ? timeline() : timeline('shared');
        });
        const assets = realm(fetchText);
        const left = assets.acquireTyped('timeline', 'left');
        await entered.wait;
        const right = assets.acquireTyped('timeline', 'right');
        await new Promise(resolve => setTimeout(resolve, 0));
        proceed.open();
        const [first, second] = await Promise.all([left, right]);
        first.release();
        expect(assets.resolveRegistryAsset('timeline', 'shared')).toBeDefined();
        expect(assets.dependenciesOf('timeline', 'right')).toContainEqual({ type: 'timeline', kind: 'owned', path: 'shared' });
        expect(fetchText.mock.calls.filter(([path]) => path === 'shared')).toHaveLength(1);
        second.release();
        expect(assets.publishedRegistryAssets('timeline')).toEqual([]);
    });

    it('cuts a recursive graph call through an alias and keeps the original spelling in its diagnostic', async () => {
        const catalog = Catalog.fromJson({ version: 1, entries: {}, addresses: { introAlias: 'intro.esgraph' } });
        const calls = new Map([['intro.esgraph', 'child.esgraph'], ['child.esgraph', 'leaf.esgraph'], ['leaf.esgraph', 'introAlias']]);
        const assets = realm(async path => JSON.stringify({
            version: SCRIPT_GRAPH_VERSION, edges: [], nodes: [
                { id: 'call', kind: 'graph.call', literals: { graph: calls.get(path) } },
            ],
        }), catalog);
        assets.register(new ScriptGraphAssetLoader());
        const parent = await assets.acquireTyped('scriptgraph', 'intro.esgraph');
        expect(parent.failedDependencies).toContain('introAlias');
        expect(assets.dependenciesOf('scriptgraph', 'leaf.esgraph')).toContainEqual({ kind: 'source', path: 'introAlias' });
        parent.release();
        expect(assets.publishedRegistryAssets('scriptgraph')).toEqual([]);
    });

    it('keeps the last good child when a hot update would make two published slots own one another', async () => {
        let child = timeline();
        const assets = realm(async path => path === 'parent.estimeline' ? timeline('child.estimeline') : child);
        const root = await assets.acquireTyped('timeline', 'parent.estimeline');
        assets.invalidate('parent.estimeline');
        await assets.assetGraphSettled();
        const previous = assets.resolveRegistryAsset<PublishedTimeline>('timeline', 'child.estimeline');
        child = timeline('parent.estimeline');
        assets.invalidate('child.estimeline');
        await assets.assetGraphSettled();
        expect(assets.resolveRegistryAsset('timeline', 'child.estimeline')).toBe(previous);
        child = timeline();
        assets.invalidate('child.estimeline');
        await assets.assetGraphSettled();
        expect(assets.resolveRegistryAsset('timeline', 'child.estimeline')).toBeDefined();
        expect(assets.resolveRegistryAsset('timeline', 'child.estimeline')).not.toBe(previous);
        root.release();
        expect(assets.publishedRegistryAssets('timeline')).toEqual([]);
    });

    it('allows the same logical names to acquire one another in the opposite order after teardown', async () => {
        const entered = barrier(), proceed = barrier();
        let restarted = false;
        const assets = realm(async path => {
            if (restarted) return path === 'b' ? timeline('a') : timeline();
            if (path === 'leaf') { entered.open(); await proceed.wait; }
            return path === 'a' ? timeline('b') : path === 'b' ? timeline('leaf') : timeline();
        });
        const obsolete = expect(assets.acquireTyped('timeline', 'a')).rejects.toThrow(/released/);
        await entered.wait;
        assets.releaseAll();
        restarted = true;
        try {
            const fresh = await assets.acquireTyped('timeline', 'b');
            expect(assets.dependenciesOf('timeline', 'b')).toContainEqual({ type: 'timeline', kind: 'owned', path: 'a' });
            proceed.open();
            await obsolete;
            expect(assets.resolveRegistryAsset('timeline', 'a')).toBeDefined();
            fresh.release();
            expect(assets.publishedRegistryAssets('timeline')).toEqual([]);
        } finally { proceed.open(); }
    });
});

describe('generation-bound asset dependencies', () => {
    it('hands a nested reader a live generation if the last external holder releases during its acquire', async () => {
        const assets = realm(async () => '');
        const live = new Set<number>();
        let id = 0;
        assets.register<{ handle: number }>({
            type: 'child', extensions: [],
            async load() { const handle = ++id; live.add(handle); return { handle }; },
            unload(value) { live.delete(value.handle); },
        });
        const first = await assets.acquireTyped('child', 'same');
        assets.register<{ handle: number }>({ type: 'parent', extensions: [], async load(_path, ctx) {
            const acquiring = ctx.acquireAsset<{ handle: number }>('child', 'same');
            // Let the typed lookup select the cached generation before its waiter resumes.
            await Promise.resolve();
            first.release();
            return (await acquiring).value;
        } });
        const parent = await assets.acquireTyped<{ handle: number }>('parent', 'same');
        expect(live.has(parent.value.handle)).toBe(true);
        parent.release();
        expect(live.size).toBe(0);
        expect(assets.sizes()).toMatchObject({ pendingLoads: 0, refRows: 0, genericCached: 0 });
    });

    it('reports a material inheritance cycle to both concurrent readers', async () => {
        vi.useFakeTimers();
        try {
            const catalog = Catalog.fromJson({ version: 1, entries: {}, addresses: { first: 'a.esmaterial' } });
            const assets = realm(async path => JSON.stringify({
                type: 'material', properties: {}, instanceOf: path === 'a.esmaterial' ? 'b.esmaterial' : 'first',
            }), catalog);
            const errors = Promise.allSettled(['a.esmaterial', 'b.esmaterial'].map(ref => assets.acquireTyped('material', ref)));
            await vi.advanceTimersByTimeAsync(RuntimeConfig.assetLoadTimeout + 1);
            for (const result of await errors) {
                expect(result.status).toBe('rejected');
                if (result.status === 'rejected') {
                    expect(String(result.reason)).toMatch(/Circular asset dependency: material/);
                    expect(String(result.reason)).toContain('a.esmaterial');
                    expect(String(result.reason)).toContain('b.esmaterial');
                }
            }
            expect(assets.sizes()).toMatchObject({ pendingLoads: 0, refRows: 0, genericCached: 0 });
        } finally { vi.useRealTimers(); }
    });

    it('lets a superseded preparation acquire a new generation at its own path', async () => {
        const assets = realm(async () => '');
        const entered = barrier(), proceed = barrier();
        let generation = 0;
        const unload = vi.fn();
        assets.register<{ revision: number }>({ type: 'revision', extensions: [], async load(path, ctx) {
            const revision = ++generation;
            if (revision === 1) {
                entered.open();
                await proceed.wait;
                const child = await ctx.acquireAsset<{ revision: number }>('revision', path);
                expect(child.value.revision).toBe(2);
            }
            return { revision };
        }, unload });
        const older = assets.acquireTyped<{ revision: number }>('revision', 'asset');
        await entered.wait;
        assets.invalidate('asset');
        try {
            const current = await assets.acquireTyped<{ revision: number }>('revision', 'asset');
            proceed.open();
            const previous = await older;
            current.release();
            expect(unload).not.toHaveBeenCalled();
            previous.release();
            expect(unload.mock.calls.map(([value]) => value.revision)).toEqual([1, 2]);
            expect(assets.sizes().refRows).toBe(0);
        } finally { proceed.open(); }
    });
});
