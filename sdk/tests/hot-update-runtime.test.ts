// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import type { Backend } from '../src/asset/Backend';
import { contentHashHex } from '../src/asset/contentHash';

// The bytes backendServing.fetchBinary returns (8 zero bytes) → the content hash a
// candidate manifest must claim for the integrity check to pass.
const REMOTE_HASH = contentHashHex(new Uint8Array(8));

const mockModule = {
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HEAPU8: new Uint8Array(1024),
    GL: null,
    FS: null,
} as any;

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({
        createTexture: vi.fn(() => 42),
        releaseTexture: vi.fn(),
        invalidateTexturePath: vi.fn(() => false),
    }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

// In-memory platform storage + content cache so persistence and the offline
// disk-cache write round-trip in the test.
vi.mock('../src/platform', () => {
    const store = new Map<string, string>();
    const cache = new Map<string, ArrayBuffer>();
    return {
        platformLoadSubpackage: vi.fn(() => Promise.resolve()),
        platformGetStorageItem: (k: string) => store.get(k) ?? null,
        platformSetStorageItem: (k: string, v: string) => { store.set(k, v); },
        platformWriteCacheFile: vi.fn((k: string, b: ArrayBuffer) => { cache.set(k, b); return Promise.resolve(); }),
        __store: store,
        __cache: cache,
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

    it('applyUpdate downloads+verifies, then atomically swaps manifest+root and notifies', async () => {
        const backend = backendServing(cdnManifest(REMOTE_HASH, 'rev-2'));
        const assets = createAssets(backend);
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn/v1');
        const rebinds: string[] = [];
        assets.onInvalidate((ref) => rebinds.push(ref));

        await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
        const progress: [number, number][] = [];
        const result = await assets.applyUpdate((loaded, total) => progress.push([loaded, total]));

        expect(result).toEqual({ ok: true, updated: 1, failed: [] });
        // Manifest + root are now the update's.
        expect(assets.getManifest()?.revision()).toBe('rev-2');
        expect(assets.remoteRoot).toBe('https://cdn/v2');
        // The changed asset was downloaded + verified from the NEW cdn root.
        expect(backend.fetchBinary).toHaveBeenCalledWith(`https://cdn/v2/assets/${REMOTE_HASH}.png`);
        // …and its verified bytes were written to the offline disk cache, keyed by
        // the immutable cdn url — so a later boot loads them without the CDN.
        const platform = await import('../src/platform');
        expect((platform as unknown as { __cache: Map<string, ArrayBuffer> })
            .__cache.get(`https://cdn/v2/assets/${REMOTE_HASH}.png`)?.byteLength).toBe(8);
        // A renderer bound to the changed asset's stable key is told to rebind.
        expect(rebinds).toEqual(['uuid-1']);
        expect(progress[0]).toEqual([0, 1]);
        expect(progress[progress.length - 1]).toEqual([1, 1]);
    });

    it('applyUpdate rolls back (manifest unchanged, no rebind) on an integrity mismatch', async () => {
        // The candidate manifest claims a hash the served bytes do not match.
        const assets = createAssets(backendServing(cdnManifest('deadbeefdeadbeef', 'rev-2')));
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn/v1');
        const rebinds: string[] = [];
        assets.onInvalidate((ref) => rebinds.push(ref));

        await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
        const result = await assets.applyUpdate();

        expect(result.ok).toBe(false);
        expect(result.failed).toEqual([{ path: 'assets/deadbeefdeadbeef.png', reason: 'integrity' }]);
        // Rolled back: the old manifest + root stay active and nobody rebound.
        expect(assets.getManifest()?.revision()).toBe('rev-1');
        expect(assets.remoteRoot).toBe('https://cdn/v1');
        expect(rebinds).toEqual([]);
    });

    it('applyUpdate rolls back when a download fails', async () => {
        const backend = backendServing(cdnManifest(REMOTE_HASH, 'rev-2'));
        (backend.fetchBinary as any).mockRejectedValue(new Error('network'));
        const assets = createAssets(backend);
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));

        await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
        const result = await assets.applyUpdate();

        expect(result.ok).toBe(false);
        expect(result.failed[0].reason).toBe('fetch');
        expect(assets.getManifest()?.revision()).toBe('rev-1'); // unchanged
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

describe('Assets.resolveLoadPath — @uuid refs to remote assets (model-2)', () => {
    it('resolves a remote-group asset (by @uuid / uuid / address) to the CDN url when a root is set', () => {
        const assets = createAssets(backendServing());
        assets.setManifest(cdnManifest('aaaa', 'rev-1')); // cdn remote; uuid-1 → assets/aaaa.png, address assets/hero.png
        assets.setRemoteRoot('https://cdn.example.com/v1');
        expect(assets.resolveLoadPath('@uuid:uuid-1')).toBe('https://cdn.example.com/v1/assets/aaaa.png');
        expect(assets.resolveLoadPath('uuid-1')).toBe('https://cdn.example.com/v1/assets/aaaa.png');
        expect(assets.resolveLoadPath('assets/hero.png')).toBe('https://cdn.example.com/v1/assets/aaaa.png');
    });

    it('falls through to the normal resolver with no remote root (same-origin realms)', () => {
        const assets = createAssets(backendServing());
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setAssetRefResolver((r) => (r === '@uuid:uuid-1' ? 'estella://project/assets/hero.png' : r));
        // No remoteRoot → the addressable manifest does not hijack resolution.
        expect(assets.resolveLoadPath('@uuid:uuid-1')).toBe('estella://project/assets/hero.png');
    });

    it('leaves local / lazy assets to the normal resolver (only remote groups are routed)', () => {
        const assets = createAssets(backendServing());
        assets.setManifest({
            version: '2.0',
            groups: { main: { bundleMode: 'local', labels: [], assets: { 'uuid-x': { path: 'a.png', type: 'texture', size: 1, labels: [] } } } },
        } as any);
        assets.setRemoteRoot('https://cdn');
        assets.setAssetRefResolver((r) => (r === '@uuid:uuid-x' ? 'a.png' : r));
        expect(assets.resolveLoadPath('@uuid:uuid-x')).toBe('a.png');
    });

    it('after applyUpdate, an @uuid ref resolves to the NEW remote path (scene assets hot-update)', async () => {
        const assets = createAssets(backendServing(cdnManifest(REMOTE_HASH, 'rev-2')));
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn/v1');
        expect(assets.resolveLoadPath('@uuid:uuid-1')).toBe('https://cdn/v1/assets/aaaa.png');

        await assets.checkForUpdate({ manifestUrl: 'm.json', remoteRoot: 'https://cdn/v2' });
        expect((await assets.applyUpdate()).ok).toBe(true);

        expect(assets.resolveLoadPath('@uuid:uuid-1')).toBe(`https://cdn/v2/assets/${REMOTE_HASH}.png`);
    });
});

describe('Assets.restorePersistedUpdate', () => {
    it('persists an applied update and restores it into a fresh Assets', async () => {
        const backend = backendServing(cdnManifest(REMOTE_HASH, 'rev-2'));
        const first = createAssets(backend);
        first.setManifest(cdnManifest('aaaa', 'rev-1'));
        first.setRemoteRoot('https://cdn/v1');

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
