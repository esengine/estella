// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import { ScriptGraphAssetLoader } from '../src/asset/loaders/ScriptGraphAssetLoader';
import { TimelineAssetLoader } from '../src/asset/loaders/TimelineAssetLoader';
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
