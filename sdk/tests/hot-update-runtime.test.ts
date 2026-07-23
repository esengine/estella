// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import type { Backend } from '../src/asset/Backend';

const mockModule = {
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HEAPU8: new Uint8Array(1024),
    GL: null,
    FS: null,
} as any;

vi.mock('../src/resourceManager', () => ({
    requireResourceManager: () => ({
        createTexture: vi.fn(() => 42),
        releaseTexture: vi.fn(),
        invalidateTexturePath: vi.fn(() => false),
    }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

// In-memory platform storage so persistence round-trips in the test.
vi.mock('../src/platform', () => {
    const store = new Map<string, string>();
    return {
        platformLoadSubpackage: vi.fn(() => Promise.resolve()),
        platformGetStorageItem: (k: string) => store.get(k) ?? null,
        platformSetStorageItem: (k: string, v: string) => { store.set(k, v); },
        __store: store,
    };
});

/** A cdn (`remote`) manifest keyed by uuid — the shape a cooked build emits.
 *  `hash` overrides the single asset's contentHash + content-addressed path. */
function cdnManifest(hash: string, revision: string): AddressableManifest {
    return {
        version: '2.0',
        revision,
        groups: {
            cdn: {
                bundleMode: 'remote',
                labels: [],
                assets: {
                    'uuid-1': {
                        path: `assets/${hash}.png`, address: 'assets/hero.png',
                        type: 'texture', size: 10, labels: [], contentHash: hash,
                    },
                },
            },
        },
    };
}

function createAssets(backend: Backend): Assets {
    return Assets.create({ backend, catalog: Catalog.empty(), module: mockModule });
}

function backendServing(manifestJson?: AddressableManifest): Backend {
    return {
        fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
        fetchText: vi.fn(async () => (manifestJson ? JSON.stringify(manifestJson) : '{}')),
        resolveUrl: vi.fn((p: string) => p),
    } as any;
}

describe('Assets.loadGroup — remote group', () => {
    it('resolves remote assets against the CDN root (absolute url passthrough)', async () => {
        const assets = createAssets(backendServing());
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn.example.com/build/');
        const spy = vi.spyOn(assets, 'loadTexture')
            .mockResolvedValue({ handle: 1, width: 1, height: 1 } as any);

        await assets.loadGroup('cdn');

        expect(spy).toHaveBeenCalledWith('https://cdn.example.com/build/assets/aaaa.png');
    });

    it('trims a trailing slash on the root exactly once', async () => {
        const assets = createAssets(backendServing());
        assets.setManifest(cdnManifest('bbbb', 'rev-1'));
        assets.setRemoteRoot('https://cdn.example.com');
        const spy = vi.spyOn(assets, 'loadTexture')
            .mockResolvedValue({ handle: 1, width: 1, height: 1 } as any);

        await assets.loadGroup('cdn');

        expect(spy).toHaveBeenCalledWith('https://cdn.example.com/assets/bbbb.png');
    });
});

describe('Assets.checkForUpdate / applyUpdate', () => {
    it('checkForUpdate diffs the fetched manifest against the active one without applying', async () => {
        const assets = createAssets(backendServing(cdnManifest('zzzz', 'rev-2')));
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn/v1');

        const plan = await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });

        expect(plan.hasUpdate).toBe(true);
        expect(plan.changedAssets.map((c) => c.key)).toEqual(['uuid-1']);
        expect(plan.totalBytes).toBe(10);
        expect(plan.fromRevision).toBe('rev-1');
        expect(plan.toRevision).toBe('rev-2');
        // Not applied yet: the active manifest and root are unchanged.
        expect(assets.getManifest()?.revision()).toBe('rev-1');
        expect(assets.remoteRoot).toBe('https://cdn/v1');
    });

    it('applyUpdate swaps the manifest+root, downloads changed assets, and notifies listeners', async () => {
        const assets = createAssets(backendServing(cdnManifest('zzzz', 'rev-2')));
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn/v1');
        const spy = vi.spyOn(assets, 'loadTexture')
            .mockResolvedValue({ handle: 2, width: 1, height: 1 } as any);
        const rebinds: string[] = [];
        assets.onInvalidate((ref) => rebinds.push(ref));

        await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
        const progress: [number, number][] = [];
        await assets.applyUpdate((loaded, total) => progress.push([loaded, total]));

        // Manifest + root are now the update's.
        expect(assets.getManifest()?.revision()).toBe('rev-2');
        expect(assets.remoteRoot).toBe('https://cdn/v2');
        // The changed asset was fetched from the NEW cdn root.
        expect(spy).toHaveBeenCalledWith('https://cdn/v2/assets/zzzz.png');
        // A renderer bound to the changed asset's stable key is told to rebind.
        expect(rebinds).toEqual(['uuid-1']);
        expect(progress[0]).toEqual([0, 1]);
        expect(progress[progress.length - 1]).toEqual([1, 1]);
    });

    it('applyUpdate is a no-op without a prior checkForUpdate', async () => {
        const assets = createAssets(backendServing());
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        const progress: [number, number][] = [];
        await assets.applyUpdate((l, t) => progress.push([l, t]));
        expect(assets.getManifest()?.revision()).toBe('rev-1');
        expect(progress).toContainEqual([0, 0]);
    });
});

describe('Assets.restorePersistedUpdate', () => {
    it('persists an applied update and restores it into a fresh Assets', async () => {
        const backend = backendServing(cdnManifest('zzzz', 'rev-2'));
        const first = createAssets(backend);
        first.setManifest(cdnManifest('aaaa', 'rev-1'));
        first.setRemoteRoot('https://cdn/v1');
        vi.spyOn(first, 'loadTexture').mockResolvedValue({ handle: 1, width: 1, height: 1 } as any);

        // Arm persistence (nothing stored yet → false), then update.
        expect(first.restorePersistedUpdate('hotupdate:demo')).toBe(false);
        await first.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
        await first.applyUpdate();

        // A returning player boots a fresh Assets straight onto the updated manifest.
        const second = createAssets(backendServing());
        const restored = second.restorePersistedUpdate('hotupdate:demo');
        expect(restored).toBe(true);
        expect(second.getManifest()?.revision()).toBe('rev-2');
        expect(second.remoteRoot).toBe('https://cdn/v2');
    });

    it('returns false when nothing is persisted under the key', () => {
        const assets = createAssets(backendServing());
        expect(assets.restorePersistedUpdate('hotupdate:absent')).toBe(false);
    });
});
