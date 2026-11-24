// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import type { Backend } from '../src/asset/Backend';
import { contentHashHex } from '../src/asset/contentHash';
import { platformLoadSubpackage } from '../src/platform';
import { createPackagedAssetSource, indexPackagedManifest } from '../src/runtime/packagedRuntime';

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
        platformRemoveStorageItem: (k: string) => { store.delete(k); },
        platformWriteCacheFile: vi.fn((k: string, b: ArrayBuffer) => { cache.set(k, b); return Promise.resolve('stored'); }),
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
        const spy = vi.spyOn(assets, 'acquireTexture').mockResolvedValue({
            key: 'texture:x', generation: 1,
            value: { handle: 1, width: 1, height: 1 }, release: () => {},
        } as any);

        await assets.loadGroup('cdn');

        expect(spy).toHaveBeenCalledWith('https://cdn.example.com/build/assets/aaaa.png');
    });

    it('trims a trailing slash on the root exactly once', async () => {
        const assets = createAssets(backendServing());
        assets.setManifest(cdnManifest('bbbb', 'rev-1'));
        assets.setRemoteRoot('https://cdn.example.com');
        const spy = vi.spyOn(assets, 'acquireTexture').mockResolvedValue({
            key: 'texture:x', generation: 1,
            value: { handle: 1, width: 1, height: 1 }, release: () => {},
        } as any);

        await assets.loadGroup('cdn');

        expect(spy).toHaveBeenCalledWith('https://cdn.example.com/assets/bbbb.png');
    });
});

describe('a remote group with no CDN root ships inside the package', () => {
    // The cook staged the bytes under `remote/<group>/…` and there is no origin
    // to fetch from, so where they are is the REALM's question — the manifest's
    // address is the authored name, which the package does not carry.
    const PACKAGED: AddressableManifest = {
        version: '2.0',
        revision: 'rev-1',
        groups: {
            cdn: {
                bundleMode: 'remote',
                labels: [],
                assets: {
                    'uuid-1': {
                        path: 'remote/cdn/assets/cdn/art.ktx2.bin',
                        address: 'assets/cdn/art.png',
                        type: 'texture', size: 10, labels: [],
                    },
                },
            },
        },
    } as AddressableManifest;

    /** What every packaged realm installs: any spelling → the staged path. */
    const packagedResolver = (ref: string): string => {
        const key = ref.replace(/^@uuid:/, '');
        return key === 'uuid-1' || key === 'assets/cdn/art.png'
            ? 'remote/cdn/assets/cdn/art.ktx2.bin'
            : ref;
    };

    it('loads the staged path, whichever spelling names it', () => {
        const assets = createAssets(backendServing());
        assets.setManifest(PACKAGED);
        assets.setAssetRefResolver(packagedResolver);
        // No setRemoteRoot: this build ships the bytes and has no CDN.

        // The scene's field is rewritten to the authored path at load, so this is
        // the spelling the texture actually asks for on a device.
        expect(assets.resolveLoadPath('assets/cdn/art.png')).toBe('remote/cdn/assets/cdn/art.ktx2.bin');
        expect(assets.resolveLoadPath('@uuid:uuid-1')).toBe('remote/cdn/assets/cdn/art.ktx2.bin');
    });

    it('still goes to the CDN once a root is set', () => {
        const assets = createAssets(backendServing());
        assets.setManifest(PACKAGED);
        assets.setAssetRefResolver(packagedResolver);
        assets.setRemoteRoot('https://cdn.example.com');

        expect(assets.resolveLoadPath('assets/cdn/art.png'))
            .toBe('https://cdn.example.com/remote/cdn/assets/cdn/art.ktx2.bin');
    });
});

/** A cdn manifest whose one asset is REF-BOUND — a slot, not a handle. */
function cdnSlotManifest(hash: string, revision: string): AddressableManifest {
    return {
        version: '2.0',
        revision,
        groups: {
            cdn: {
                bundleMode: 'remote',
                labels: [],
                assets: {
                    'uuid-w': {
                        path: `assets/${hash}.widget`, address: 'assets/hero.widget',
                        type: 'json', size: 10, labels: [], contentHash: hash,
                    },
                },
            },
        },
    };
}

describe('a slot is keyed by what the asset IS, not by where this revision serves it', () => {
    it('the same slot re-prepares from the new revision\'s url', async () => {
        // Keyed by the resolved url, a slot is revision-specific: the update
        // publishes nothing into it, and every holder — components look their
        // ref up on each frame — reads the old era for the life of the app.
        const backend = backendServing(cdnSlotManifest(REMOTE_HASH, 'rev-2'));
        const assets = createAssets(backend);
        assets.setManifest(cdnSlotManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn/v1');
        const loadedFrom: string[] = [];
        assets.register({
            type: 'widget', extensions: ['.widget'],
            registry: {
                prepare: async (path) => {
                    loadedFrom.push(path);
                    return { published: { from: path }, value: { id: 'assets/hero.widget' } };
                },
            },
        });

        const held = await assets.acquireTyped('widget', 'assets/hero.widget');
        expect(loadedFrom).toEqual(['https://cdn/v1/assets/aaaa.widget']);

        await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
        await assets.applyUpdate();

        expect(loadedFrom[1], 'the update published nothing into the slot')
            .toBe(`https://cdn/v2/assets/${REMOTE_HASH}.widget`);
        expect(assets.sizes().registrySlots, 'the update opened a second slot for one asset').toBe(1);
        expect(assets.resolveRegistryAsset('widget', 'assets/hero.widget'))
            .toEqual({ from: `https://cdn/v2/assets/${REMOTE_HASH}.widget` });
        held.release();
    });
});

function twoFileManifest(hash: string, revision: string): AddressableManifest {
    const result = cdnManifest(hash, revision);
    const files = result.groups.cdn.assets;
    files['uuid-2'] = { ...files['uuid-1'], address: 'assets/mask.png', path: `assets/mask-${hash}.png` };
    return result;
}

describe('a hot update reaches what was built from what it changed', () => {
    it('refreshes overlapping consumers once, after their dependencies, when two files change together', async () => {
        const assets = createAssets(backendServing(twoFileManifest(REMOTE_HASH, 'new')));
        assets.setManifest(twoFileManifest('aaaa', 'old'));
        assets.setRemoteRoot('https://cdn/v1');
        const builds: string[] = [];
        assets.register({ type: 'surface', extensions: ['.surface'], registry: {
            prepare: async (_path, ctx) => {
                await ctx.readSource!('assets/hero.png');
                await ctx.readSource!('assets/mask.png');
                const value = { revision: assets.getManifest()!.revision() };
                builds.push('surface');
                return { published: value, value };
            },
        } });
        assets.register({ type: 'level', extensions: ['.level'], registry: {
            prepare: async (_path, ctx) => {
                const surface = await ctx.acquireAsset<{ revision: string }>('surface', 'ground.surface');
                await ctx.readSource!('@uuid:uuid-2');
                builds.push('level');
                return { published: surface.value, value: surface.value };
            },
        } });
        const held = await assets.acquireTyped('level', 'demo.level');
        try {
            builds.length = 0;
            await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
            const result = await assets.applyUpdate();
            expect(result).toMatchObject({ ok: true, updated: 2 });
            expect(builds).toEqual(['surface', 'level']);
            expect(assets.resolveRegistryAsset('level', 'demo.level')).toEqual({ revision: 'new' });
        } finally {
            held.release();
        }
    });

    it('schedules a changed slot that also owns a changed dependency after that dependency', async () => {
        const assets = createAssets(backendServing(twoFileManifest(REMOTE_HASH, 'new')));
        assets.setManifest(twoFileManifest('aaaa', 'old'));
        assets.setRemoteRoot('https://cdn/v1');
        const versions: string[] = [];
        let start!: () => void, resume!: () => void;
        const started = new Promise<void>(resolve => { start = resolve; });
        const released = new Promise<void>(resolve => { resume = resolve; });
        assets.register({ type: 'mask', extensions: [], registry: {
            prepare: async () => {
                const revision = assets.getManifest()!.revision();
                if (revision === 'new') { start(); await released; }
                return { published: revision, value: revision };
            },
        } });
        assets.register({ type: 'surface', extensions: [], registry: {
            prepare: async (_path, ctx) => {
                const mask = await ctx.acquireAsset<string>('mask', '@uuid:uuid-2');
                versions.push(mask.value);
                return { published: mask.value, value: mask.value };
            },
        } });
        const held = await assets.acquireTyped('surface', 'assets/hero.png');
        try {
            expect(assets.resolveRegistryAsset('mask', 'assets/mask.png')).toBe('old');
            await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
            const updating = assets.applyUpdate();
            await Promise.race([started, updating.then(() => { throw Error('Update finished before the mask was prepared'); })]);
            resume();
            expect(await updating).toMatchObject({ ok: true, updated: 2 });
            expect(versions).toEqual(['old', 'new']);
            expect(assets.resolveRegistryAsset('surface', 'assets/hero.png')).toBe('new');
        } finally {
            resume();
            held.release();
        }
    });

    it('re-prepares the asset that read a changed one, against the new content', async () => {
        // The changed asset itself is content-addressed, so the next load of it
        // finds the update on its own. What CANNOT is an era already built from
        // it: it holds what it read at the revision it was prepared in.
        const backend = backendServing(cdnManifest(REMOTE_HASH, 'rev-2'));
        const assets = createAssets(backend);
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn/v1');
        const builtFrom: string[] = [];
        assets.register({
            type: 'widget', extensions: ['.widget'],
            registry: {
                prepare: async (path, ctx) => {
                    await ctx.readSource!('assets/hero.png');
                    builtFrom.push(assets.resolveLoadPath('assets/hero.png'));
                    return { published: { path }, value: { id: path } };
                },
            },
        });
        await assets.acquireTyped('widget', 'w.widget');
        expect(builtFrom).toEqual(['https://cdn/v1/assets/aaaa.png']);

        await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
        await assets.applyUpdate();

        // No flushing: applyUpdate resolving MEANS the asset graph agrees with
        // the manifest. What reads the graph converges on a frame, which is the
        // other barrier and not this one.
        expect(builtFrom[1], 'the widget kept the revision it was built in')
            .toBe(`https://cdn/v2/assets/${REMOTE_HASH}.png`);
    });
});

describe('Assets.checkForUpdate / applyUpdate', () => {
    it('verifies both files at a replacement CDN even when the manifest itself is identical', async () => {
        const m = cdnManifest(REMOTE_HASH, 'same');
        m.groups.cdn.assets['uuid-1'].streamTail = {
            path: 'preview.png', size: 8, width: 1, height: 1, fullWidth: 2, fullHeight: 2, contentHash: REMOTE_HASH,
        };
        const backend = backendServing(m);
        const assets = createAssets(backend);
        assets.setManifest(m);
        assets.setRemoteRoot('https://cdn/v1');
        const plan = await assets.checkForUpdate({ manifestUrl: 'same.json', remoteRoot: 'https://cdn/v2' });
        expect(plan.hasUpdate).toBe(true);
        expect(plan.downloadFiles).toHaveLength(2);
        expect(await assets.applyUpdate()).toMatchObject({ ok: true, updated: 1 });
        expect(vi.mocked(backend.fetchBinary).mock.calls.map(([path]) => path).sort())
            .toEqual([`https://cdn/v2/assets/${REMOTE_HASH}.png`, 'https://cdn/v2/preview.png']);
    });

    it('refuses a changed packed member before requesting a virtual file', async () => {
        const shipped = cdnManifest('same', 'old');
        const next = cdnManifest('same', 'new');
        next.groups.cdn.assets['uuid-1'].pack = { file: 'shared.pack', offset: 4, size: 10 };
        const backend = backendServing(next);
        const assets = createAssets(backend);
        assets.setManifest(shipped);
        const plan = await assets.checkForUpdate({ manifestUrl: 'update.json' });
        expect(plan.downloadFiles).toMatchObject([{ kind: 'pack', path: 'shared.pack' }]);
        expect(await assets.applyUpdate()).toMatchObject({ ok: false, revision: 'old', failed: [{ reason: 'packed' }] });
        expect(backend.fetchBinary).not.toHaveBeenCalled();
    });

    it('verifies just the replacement preview, keeps the old revision on corruption and retries the staged update', async () => {
        const shipped = cdnManifest('unchanged', 'old');
        const tail = { path: 'assets/preview.png', size: 8, width: 1, height: 1, fullWidth: 4, fullHeight: 4 };
        shipped.groups.cdn.assets['uuid-1'].streamTail = { ...tail, contentHash: 'old-preview' };
        const next = cdnManifest('unchanged', 'new');
        next.groups.cdn.assets['uuid-1'].streamTail = { ...tail, contentHash: REMOTE_HASH };
        const backend = backendServing(next);
        vi.mocked(backend.fetchBinary).mockResolvedValueOnce(new Uint8Array(8).fill(42).buffer);
        const assets = createAssets(backend);
        assets.setManifest(shipped);
        assets.setRemoteRoot('https://cdn');
        const plan = await assets.checkForUpdate({ manifestUrl: 'update.json' });
        expect(plan.downloadFiles).toMatchObject([{ kind: 'streamTail', path: tail.path, size: 8 }]);
        expect(assets.updateStatus().staged).toEqual({ revision: 'new', assets: 1, bytes: 8 });
        expect(await assets.applyUpdate()).toMatchObject({
            ok: false, revision: 'old', updated: 0, failed: [{ path: tail.path, reason: 'integrity' }],
        });
        const progress = vi.fn();
        expect(await assets.applyUpdate(progress)).toMatchObject({ ok: true, revision: 'new', updated: 1, stages: { cached: true } });
        expect(progress.mock.calls).toEqual([[0, 1], [1, 1]]);
        expect(vi.mocked(backend.fetchBinary).mock.calls).toEqual([['https://cdn/assets/preview.png'], ['https://cdn/assets/preview.png']]);
    });

    it('verifies a move from CDN to package at the candidate location', async () => {
        const next = cdnManifest(REMOTE_HASH, 'local');
        next.groups.cdn.bundleMode = 'local';
        const backend = backendServing(next);
        const assets = createAssets(backend);
        assets.setManifest(cdnManifest(REMOTE_HASH, 'remote'));
        assets.setRemoteRoot('https://cdn/v1');
        const plan = await assets.checkForUpdate({ manifestUrl: 'update.json' });
        expect(plan.changedAssets.map(asset => asset.path)).toEqual([`assets/${REMOTE_HASH}.png`]);
        expect((await assets.applyUpdate()).ok).toBe(true);
        expect(backend.fetchBinary).toHaveBeenCalledWith(`assets/${REMOTE_HASH}.png`);
    });

    it('verifies a same-path move in the candidate subpackage and shares its successful mount with later reads', async () => {
        const shipped = cdnManifest(REMOTE_HASH, 'shipped');
        shipped.groups.cdn.bundleMode = 'lazy';
        const next: AddressableManifest = { ...shipped, revision: 'moved', groups: { expansion: shipped.groups.cdn } };
        const backend = backendServing(next);
        const assets = createAssets(backend);
        assets.setManifest(shipped);
        const mount = vi.mocked(platformLoadSubpackage);
        mount.mockClear().mockRejectedValueOnce(new Error('unavailable'));
        const plan = await assets.checkForUpdate({ manifestUrl: 'update.json' });
        expect(plan.downloadFiles.map(file => file.group)).toEqual(['expansion']);
        expect(await assets.applyUpdate()).toMatchObject({ ok: false, revision: 'shipped', failed: [{ reason: 'fetch' }] });
        expect(backend.fetchBinary).not.toHaveBeenCalled();
        expect(await assets.applyUpdate()).toMatchObject({ ok: true, revision: 'moved' });
        await assets.fetchBinary('uuid-1');
        expect(backend.fetchBinary).toHaveBeenCalledTimes(2);
        expect(mount.mock.calls).toEqual([['expansion'], ['expansion']]);
    });

    it('keeps the shipped settings active when another file in the candidate fails verification', async () => {
        const shipped = cdnManifest(REMOTE_HASH, 'shipped');
        shipped.groups.cdn.assets['uuid-1'].textureImport = { filter: 'nearest' };
        const next = twoFileManifest(REMOTE_HASH, 'candidate');
        next.groups.cdn.assets['uuid-1'].textureImport = { filter: 'linear' };
        next.groups.cdn.assets['uuid-2'].contentHash = 'corrupt';
        const index = indexPackagedManifest(shipped);
        const backend = backendServing(next);
        const source = createPackagedAssetSource(index, { backend });
        const assets = Assets.create({ backend, module: mockModule, manifest: index.model, activateManifest: source.activateManifest });
        assets.setRemoteRoot('https://cdn/v1');
        const notify = vi.fn();
        assets.onInvalidate(notify);

        const plan = await assets.checkForUpdate({ manifestUrl: 'update.json' });
        expect(plan.changedAssets.map(asset => asset.key)).toEqual(['uuid-2']);
        expect(plan.reconfiguredAssets.map(asset => asset.key)).toEqual(['uuid-1']);
        expect(await assets.applyUpdate()).toMatchObject({ ok: false, updated: 0, failed: [{ reason: 'integrity' }] });
        expect(backend.fetchBinary).toHaveBeenCalledTimes(1);
        expect(source.textureImportSettings!('assets/hero.png')).toEqual({ filter: 'nearest' });
        expect(assets.getManifest()!.revision()).toBe('shipped');
        expect(assets.remoteRoot).toBe('https://cdn/v1');
        expect(notify).not.toHaveBeenCalled();
    });

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
        const rebinds: Array<{ ref: string; type: string }> = [];
        assets.onInvalidate((e) => rebinds.push({ ref: e.ref, type: e.type }));

        await assets.checkForUpdate({ manifestUrl: 'asset-manifest.json', remoteRoot: 'https://cdn/v2' });
        const progress: [number, number][] = [];
        const result = await assets.applyUpdate((loaded, total) => progress.push([loaded, total]));

        expect(result).toMatchObject({ ok: true, updated: 1, failed: [], revision: 'rev-2' });
        expect(result.stages).toEqual({ verified: true, applied: true, persisted: null, cached: true });
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
        // The manifest knew the kind; the notification carries it.
        expect(rebinds).toEqual([{ ref: 'uuid-1', type: 'texture' }]);
        expect(progress[0]).toEqual([0, 1]);
        expect(progress[progress.length - 1]).toEqual([1, 1]);
    });

    it('applyUpdate rolls back (manifest unchanged, no rebind) on an integrity mismatch', async () => {
        // The candidate manifest claims a hash the served bytes do not match.
        const assets = createAssets(backendServing(cdnManifest('deadbeefdeadbeef', 'rev-2')));
        assets.setManifest(cdnManifest('aaaa', 'rev-1'));
        assets.setRemoteRoot('https://cdn/v1');
        const rebinds: Array<{ ref: string; type: string }> = [];
        assets.onInvalidate((e) => rebinds.push({ ref: e.ref, type: e.type }));

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
        second.setManifest(cdnManifest('aaaa', 'rev-1'));
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
