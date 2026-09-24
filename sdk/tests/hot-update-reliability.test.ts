// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A hot update reports each stage it reached, not one ok, and the next
 *        launch starts on a complete version — faults injected where a device
 *        meets them: a store that refuses, a cache that refuses, a download that
 *        is still running when another update is found or applied.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import type { Backend } from '../src/asset/Backend';
import { contentHashHex } from '../src/asset/contentHash';

const mockModule = { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1024), GL: null, FS: null } as any;

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ createTexture: vi.fn(() => 42), releaseTexture: vi.fn(), invalidateTexturePath: vi.fn(() => false) }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

const faults = { storeRefuses: false, storeDrops: false, cacheRefuses: false, noCache: false };
const store = new Map<string, string>();
const cache = new Map<string, ArrayBuffer>();

vi.mock('../src/platform', () => ({
    platformLoadSubpackage: vi.fn(() => Promise.resolve()),
    platformGetStorageItem: (k: string) => store.get(k) ?? null,
    platformRemoveStorageItem: (k: string) => { store.delete(k); },
    platformSetStorageItem: (k: string, v: string) => {
        if (faults.storeRefuses) throw new Error('QuotaExceededError');
        if (!faults.storeDrops) store.set(k, v);
    },
    platformWriteCacheFile: vi.fn(async (k: string, b: ArrayBuffer) => {
        if (faults.noCache) return 'unsupported';
        if (faults.cacheRefuses) return 'failed';
        cache.set(k, b);
        return 'stored';
    }),
}));

beforeEach(() => {
    Object.assign(faults, { storeRefuses: false, storeDrops: false, cacheRefuses: false, noCache: false });
    store.clear();
    cache.clear();
});

/** One remote asset whose bytes are @p fill repeated 8 times. */
function manifest(fill: number, revision: string): AddressableManifest {
    const hash = contentHashHex(new Uint8Array(8).fill(fill));
    return {
        version: '2.0', revision,
        groups: { cdn: { bundleMode: 'remote', labels: [], assets: {
            'uuid-1': { path: `assets/${hash}.png`, type: 'texture', size: 8, labels: [], contentHash: hash },
        } } },
    };
}

/** A CDN that serves the manifests by url and the bytes for whichever hash is asked;
 *  `hold` makes downloads wait until released. */
function cdn(manifests: Record<string, AddressableManifest>) {
    let release: () => void = () => {};
    let gate: Promise<void> | null = null;
    const fills = new Map<string, number>();
    for (let fill = 0; fill < 16; fill++) fills.set(contentHashHex(new Uint8Array(8).fill(fill)), fill);
    const backend = {
        fetchBinary: vi.fn(async (url: string) => {
            if (gate) await gate;
            const hash = /assets\/(\w+)\.png/.exec(url)![1];
            return new Uint8Array(8).fill(fills.get(hash) ?? 0).buffer;
        }),
        fetchText: vi.fn(async (url: string) => JSON.stringify(manifests[url])),
        resolveUrl: vi.fn((p: string) => p),
    } as any as Backend;
    return {
        backend,
        hold() { gate = new Promise((r) => { release = () => { gate = null; r(); }; }); },
        release: () => release(),
    };
}

const KEY = 'hotupdate:test';

function boot(backend: Backend): Assets {
    const assets = Assets.create({ backend, catalog: Catalog.empty(), module: mockModule });
    assets.setManifest(manifest(1, 'rev-1'));
    assets.setRemoteRoot('https://cdn/v1');
    assets.restorePersistedUpdate(KEY);
    return assets;
}

/** What the next launch starts on, from a package that shipped @p shipped. */
function relaunch(shipped = manifest(1, 'rev-1')): string | null {
    const assets = Assets.create({ backend: cdn({}).backend, catalog: Catalog.empty(), module: mockModule });
    assets.setManifest(shipped);
    assets.restorePersistedUpdate(KEY);
    return assets.getManifest()?.revision() ?? null;
}

describe('a hot update says which stages it reached', () => {
    it('all four, when nothing refuses', async () => {
        const assets = boot(cdn({ m2: manifest(2, 'rev-2') }).backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        const r = await assets.applyUpdate();
        expect(r.stages).toEqual({ verified: true, applied: true, persisted: true, cached: true });
        expect(r.revision).toBe('rev-2');
        expect(relaunch()).toBe('rev-2');
    });

    it('not persisted when the store throws — and the next launch is on the old version, as it says', async () => {
        const assets = boot(cdn({ m2: manifest(2, 'rev-2') }).backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        faults.storeRefuses = true;
        const r = await assets.applyUpdate();
        expect(r.ok).toBe(true);
        expect(r.stages.applied).toBe(true);
        expect(r.stages.persisted).toBe(false);
        expect(relaunch()).toBe('rev-1');
    });

    it('not persisted when the store drops the write without throwing', async () => {
        const assets = boot(cdn({ m2: manifest(2, 'rev-2') }).backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        faults.storeDrops = true;
        expect((await assets.applyUpdate()).stages.persisted).toBe(false);
        expect(relaunch()).toBe('rev-1');
    });

    it('not cached when the cache refuses, naming what the next launch will fetch again', async () => {
        const assets = boot(cdn({ m2: manifest(2, 'rev-2') }).backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        faults.cacheRefuses = true;
        const r = await assets.applyUpdate();
        expect(r.stages.cached).toBe(false);
        expect(r.uncached).toEqual([expect.stringMatching(/^https:\/\/cdn\/v2\/assets\/\w+\.png$/)]);
    });

    it('cached is unknown, not true, where the platform keeps no cache', async () => {
        const assets = boot(cdn({ m2: manifest(2, 'rev-2') }).backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        faults.noCache = true;
        expect((await assets.applyUpdate()).stages.cached).toBeNull();
    });

    it('nothing but verified=false when a download fails, and the next launch is untouched', async () => {
        const c = cdn({ m2: manifest(2, 'rev-2') });
        const assets = boot(c.backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        (c.backend.fetchBinary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
        const r = await assets.applyUpdate();
        expect(r.stages).toEqual({ verified: false, applied: false, persisted: false, cached: false });
        expect(assets.getManifest()?.revision()).toBe('rev-1');
        expect(relaunch()).toBe('rev-1');
    });
});

describe('updates that overlap', () => {
    it('an update found while another downloads is still there to apply afterwards', async () => {
        const c = cdn({ m2: manifest(2, 'rev-2'), m3: manifest(3, 'rev-3') });
        const assets = boot(c.backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        c.hold();
        const first = assets.applyUpdate();
        await assets.checkForUpdate({ manifestUrl: 'm3', remoteRoot: 'https://cdn/v3' });
        c.release();
        expect((await first).revision).toBe('rev-2');
        const second = await assets.applyUpdate();
        expect(second.ok).toBe(true);
        expect(second.revision).toBe('rev-3');
        expect(relaunch()).toBe('rev-3');
    });

    it('the later update is diffed against the version the earlier one committed', async () => {
        const c = cdn({ m2: manifest(2, 'rev-2'), m3: manifest(2, 'rev-3') });
        const assets = boot(c.backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        c.hold();
        const first = assets.applyUpdate();
        await assets.checkForUpdate({ manifestUrl: 'm3', remoteRoot: 'https://cdn/v2' });
        c.release();
        await first;
        const calls = (c.backend.fetchBinary as ReturnType<typeof vi.fn>).mock.calls.length;
        const second = await assets.applyUpdate();
        expect(second.updated).toBe(0);
        expect((c.backend.fetchBinary as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    });

    it('applying twice at once downloads once and commits once', async () => {
        const c = cdn({ m2: manifest(2, 'rev-2') });
        const assets = boot(c.backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        const commits: string[] = [];
        assets.onInvalidate((e) => commits.push(e.ref));
        const [a, b] = await Promise.all([assets.applyUpdate(), assets.applyUpdate()]);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(false);
        expect(b.reason).toBe('nothing-staged');
        expect(commits).toEqual(['uuid-1']);
        expect(c.backend.fetchBinary).toHaveBeenCalledTimes(1);
    });
});

describe('what an update is doing right now', () => {
    it('names the running, stored and staged revisions and what the staged one costs', async () => {
        const assets = boot(cdn({ m2: manifest(2, 'rev-2') }).backend);
        expect(assets.updateStatus()).toMatchObject({ revision: 'rev-1', persistedRevision: null, staged: null, applying: false });
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        expect(assets.updateStatus().staged).toEqual({ revision: 'rev-2', assets: 1, bytes: 8 });
        const applying = assets.applyUpdate();
        expect(assets.updateStatus().applying).toBe(true);
        await applying;
        expect(assets.updateStatus()).toMatchObject({ revision: 'rev-2', persistedRevision: 'rev-2', staged: null, applying: false });
    });
});

describe('a stored update belongs to the package it was applied to', () => {
    it('is dropped when the package itself changed, rather than covering the newer content', async () => {
        const assets = boot(cdn({ m2: manifest(2, 'rev-2') }).backend);
        await assets.checkForUpdate({ manifestUrl: 'm2', remoteRoot: 'https://cdn/v2' });
        await assets.applyUpdate();
        expect(relaunch()).toBe('rev-2');
        expect(relaunch(manifest(5, 'rev-5'))).toBe('rev-5');
        expect(store.has(KEY)).toBe(false);
    });

    it('from before this rule is dropped too: which package it belonged to is unknown', () => {
        store.set(KEY, JSON.stringify({ manifest: manifest(2, 'rev-2'), remoteRoot: 'https://cdn/v2' }));
        expect(relaunch()).toBe('rev-1');
    });
});

