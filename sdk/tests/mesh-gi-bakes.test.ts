// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { createPackagedAssetSource, indexPackagedManifest } from '../src/runtime/packagedRuntime';
import { MeshGIBakes } from '../src/gi/meshGIBakes';

const backend = { resolveUrl: (path: string) => path } as Backend;
const refs = { sdf: 'art/rock.esmeshsdf', cards: 'art/rock.esmeshcards' };
const use = (bakes: MeshGIBakes, assets: Assets, handle = 1) => {
    bakes.begin(assets);
    const key = bakes.use(handle);
    bakes.end();
    return key!;
};

it('selects GI by logical mesh when two handles share staged bytes', async () => {
    const first = '45d141cb-38d9-4c51-ad93-c06a785471c1', second = '7727ca31-4df7-4d64-800c-7090ad6f5a94';
    const sdf = 'de32147a-36f4-416c-b51e-21ad33afaa8f', cards = 'bfd3205e-f84c-4a10-a7c6-d18a5b867574';
    const asset = (type: string, path: string, address: string) => ({ type, path, address, size: 4, labels: [] });
    const shared = 'blobs/abc.esmesh';
    const index = indexPackagedManifest({ version: '2.0', groups: { main: { labels: [], bundleMode: 'local', assets: {
        [first]: { ...asset('mesh', shared, 'art/a.esmesh'), meshGI: false },
        [second]: { ...asset('mesh', shared, 'art/b.esmesh'), meshGI: { sdf, cards } },
        [sdf]: asset('meshSdf', 'blobs/s.bin', refs.sdf), [cards]: asset('meshCards', 'blobs/c.bin', refs.cards),
    } } } });
    const assets = Assets.create({ backend, module: null, manifest: index.model });
    assets.setAssetRefResolver(createPackagedAssetSource(index).resolveRef!);
    let serial = 0;
    assets.register({ type: 'mesh', extensions: ['.esmesh'], load: async () => ({ handle: ++serial }), unload: () => {} });
    const a = await assets.acquireTyped<{ handle: number }>('mesh', 'art/a.esmesh');
    const b = await assets.acquireTyped<{ handle: number }>('mesh', '@uuid:' + second);
    try {
        expect(assets.pathForHandle('mesh', a.value.handle)).toBe(shared);
        expect(assets.pathForHandle('mesh', b.value.handle)).toBe(shared);
        expect(assets.meshGIForHandle(a.value.handle)).toBeNull();
        expect(assets.meshGIForHandle(b.value.handle)).toEqual({ sdf: '@uuid:' + sdf, cards: '@uuid:' + cards });
    } finally { a.release(); b.release(); assets.releaseAll(); }
});

it('releases a partial pair, retries an invalidated miss and releases the live pair when the last instance leaves', async () => {
    const assets = Assets.create({ backend, module: null }), bakes = new MeshGIBakes();
    vi.spyOn(assets, 'meshGIForHandle').mockReturnValue(refs);
    let missing = true;
    const sdf = {}, cards = {}, unloadSdf = vi.fn(), unloadCards = vi.fn();
    const loadSdf = vi.fn(async () => { if (missing) throw new Error('missing'); return sdf; });
    assets.register({ type: 'meshSdf', extensions: [], load: loadSdf, unload: unloadSdf });
    assets.register({ type: 'meshCards', extensions: [], load: async () => cards, unload: unloadCards });
    try {
        const key = use(bakes, assets);
        await vi.waitFor(() => expect(unloadCards).toHaveBeenCalledTimes(1));
        expect(bakes.get(key)).toBeNull();
        use(bakes, assets);
        expect(loadSdf).toHaveBeenCalledTimes(1);
        missing = false;
        assets.invalidate(refs.sdf);
        use(bakes, assets);
        await vi.waitFor(() => expect(bakes.get(key)).toEqual({ sdf, cards }));
        bakes.begin(assets); bakes.use(1); bakes.use(2); bakes.end();
        use(bakes, assets, 2);
        expect(unloadSdf).not.toHaveBeenCalled();
        const revision = bakes.revision;
        assets.invalidate(refs.cards);
        use(bakes, assets);
        await vi.waitFor(() => expect(bakes.get(key)).toEqual({ sdf, cards }));
        expect(bakes.revision).toBeGreaterThan(revision);
        bakes.begin(assets); bakes.end();
        expect(bakes.get(key)).toBeNull();
        expect(unloadSdf).toHaveBeenCalledTimes(2);
    } finally { bakes.clear(); assets.releaseAll(); }
});

it('discards a pair that completes after the edit world has switched projects', async () => {
    const assets = Assets.create({ backend, module: null }), next = Assets.create({ backend, module: null });
    const bakes = new MeshGIBakes();
    vi.spyOn(assets, 'meshGIForHandle').mockReturnValue(refs);
    let finish!: () => void;
    const sdf = new Promise<object>(resolve => { finish = () => resolve({}); });
    const unload = vi.fn();
    assets.register({ type: 'meshSdf', extensions: [], load: () => sdf, unload });
    assets.register({ type: 'meshCards', extensions: [], load: async () => ({}), unload });
    const key = use(bakes, assets);
    bakes.begin(next); bakes.end();
    await vi.waitFor(() => expect(unload).toHaveBeenCalledTimes(1));
    finish();
    await vi.waitFor(() => expect(unload).toHaveBeenCalledTimes(2));
    expect(bakes.get(key)).toBeNull();
    bakes.clear(); assets.releaseAll(); next.releaseAll();
});
