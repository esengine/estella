// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog, type CatalogData } from '../src/asset/Catalog';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import type { Backend } from '../src/asset/Backend';
import * as platform from '../src/platform';
import { log } from '../src/util/logger';

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
        registerExternalTexture: vi.fn(() => 42),
        releaseTexture: vi.fn(),
        releaseBitmapFont: vi.fn(),
        getTextureGLId: vi.fn(() => 1),
        registerTextureWithPath: vi.fn(),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
        setTextureMetadata: vi.fn(),
    }),
    evictTextureDimensions: vi.fn(),
}));

vi.mock('../src/platform', () => ({
    platformCreateCanvas: () => ({
        width: 64, height: 64,
        getContext: () => ({
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64 * 64 * 4) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: any = {};
        setTimeout(() => { img.width = 64; img.height = 64; img.onload?.(); }, 0);
        return img;
    },
    platformNow: () => 0,
    platformDevicePixelRatio: () => 1,
    platformLoadSubpackage: vi.fn(() => Promise.resolve()),
}));

function createMockBackend(): Backend {
    return {
        fetch: vi.fn(async () => new ArrayBuffer(8)),
        fetchText: vi.fn(async () => '{}'),
        resolvePath: vi.fn((p: string) => p),
        resolveUrl: vi.fn((p: string) => p),
    } as any;
}

function createCatalogWithLabels(): Catalog {
    const data: CatalogData = {
        version: 1,
        entries: {
            'tex1.png': { type: 'texture', buildPath: 'tex1.png' },
            'tex2.png': { type: 'texture', buildPath: 'tex2.png' },
            'tex3.png': { type: 'texture', buildPath: 'tex3.png' },
        },
        labels: {
            'ui': ['tex1.png', 'tex2.png'],
            'gameplay': ['tex3.png'],
        },
    };
    return Catalog.fromJson(data);
}

function createAssets() {
    return Assets.create({
        backend: createMockBackend(),
        catalog: createCatalogWithLabels(),
        module: mockModule,
    });
}

describe('Assets.loadByLabel with progress', () => {
    it('should call onProgress with loaded/total counts', async () => {
        const assets = createAssets();

        const progressCalls: [number, number][] = [];
        await assets.loadByLabel('ui', (loaded, total) => {
            progressCalls.push([loaded, total]);
        });

        expect(progressCalls.length).toBeGreaterThan(0);
        expect(progressCalls[0]).toEqual([0, 2]);
        const lastCall = progressCalls[progressCalls.length - 1];
        expect(lastCall[0]).toBe(lastCall[1]);
    });

    it('should work without onProgress', async () => {
        const assets = createAssets();
        const bundle = await assets.loadByLabel('ui');
        expect(bundle).toBeDefined();
    });

    it('should report 0/0 for empty label', async () => {
        const assets = createAssets();
        const progressCalls: [number, number][] = [];
        await assets.loadByLabel('nonexistent', (loaded, total) => {
            progressCalls.push([loaded, total]);
        });
        expect(progressCalls).toContainEqual([0, 0]);
    });
});

function createManifest(): AddressableManifest {
    return {
        version: '2.0',
        groups: {
            main: {
                bundleMode: 'local',
                labels: [],
                assets: {
                    'tex1.png': { path: 'tex1.png', type: 'texture', size: 0, labels: ['ui'] },
                    'tex2.png': { path: 'tex2.png', type: 'texture', size: 0, labels: ['ui'] },
                },
            },
            extra: {
                bundleMode: 'lazy',
                labels: [],
                assets: {
                    'tex3.png': { path: 'tex3.png', type: 'texture', size: 0, labels: ['gameplay'] },
                },
            },
        },
    };
}

describe('Assets.loadGroup', () => {
    it('loads labeled 2D and 3D manifest records after mounting their groups', async () => {
        const assets = Assets.create({ backend: createMockBackend(), module: mockModule });
        const manifest = createManifest();
        const tagged = { path: 'ca/shared.esmesh', type: 'mesh', size: 8, labels: ['encounter'] };
        manifest.groups.extra.assets = {
            rock: { ...tagged, address: 'assets/rock.esmesh' },
            gate: { ...tagged, address: 'assets/gate.esmesh' },
        };
        manifest.groups.main.assets['tex1.png'].labels.push('encounter');
        assets.setManifest(manifest);
        const order: string[] = [];
        const releases: string[] = [];
        const sub = vi.mocked(platform.platformLoadSubpackage);
        sub.mockImplementationOnce(async (name) => { order.push(name); });
        vi.spyOn(assets, 'acquireTyped').mockImplementation(async (_type, ref) => {
            order.push(ref);
            return { key: ref, generation: 1, value: { handle: 7 }, release: () => releases.push(ref) } as any;
        });
        vi.spyOn(assets, 'acquireTexture').mockImplementation(async (ref) => {
            order.push(ref);
            return { key: ref, generation: 1, value: { handle: 2 }, release: () => releases.push(ref) } as any;
        });
        const progress: [number, number][] = [];
        const bundle = await assets.loadByLabel('encounter', (done, total) => progress.push([done, total]));
        expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
        expect(order[0]).toBe('extra');
        expect([...bundle.textures.keys()]).toEqual(['tex1.png']);
        expect([...bundle.meshes.keys()].sort()).toEqual(['gate', 'rock']);
        bundle.release();
        bundle.release();
        expect(releases.sort()).toEqual(['gate', 'rock', 'tex1.png']);
    });

    it('dispatches every asset in a group through the typed loader, into the bundle', async () => {
        const assets = createAssets();
        assets.setManifest(createManifest());
        // Spy the texture channel's acquire door so the assertion is about
        // loadGroup's dispatch, not the mock's image-decode pipeline.
        const spy = vi.spyOn(assets, 'acquireTexture').mockResolvedValue({
            key: 'texture:x', generation: 1,
            value: { handle: 42, width: 64, height: 64 }, release: () => {},
        } as any);

        const progressCalls: [number, number][] = [];
        const bundle = await assets.loadGroup('main', (loaded, total) => {
            progressCalls.push([loaded, total]);
        });

        expect(spy.mock.calls.map(c => c[0]).sort()).toEqual(['tex1.png', 'tex2.png']);
        expect(bundle.textures.size).toBe(2);
        expect(progressCalls[0]).toEqual([0, 2]);
        const last = progressCalls[progressCalls.length - 1];
        expect(last[0]).toBe(last[1]);
    });

    it('loads a different group independently', async () => {
        const assets = createAssets();
        assets.setManifest(createManifest());
        const spy = vi.spyOn(assets, 'acquireTexture').mockResolvedValue({
            key: 'texture:x', generation: 1,
            value: { handle: 7, width: 1, height: 1 }, release: () => {},
        } as any);
        const bundle = await assets.loadGroup('extra');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('tex3.png');
        expect(bundle.textures.size).toBe(1);
    });

    it('reports 0/0 and an empty bundle for an unknown group', async () => {
        const assets = createAssets();
        assets.setManifest(createManifest());
        const progressCalls: [number, number][] = [];
        const bundle = await assets.loadGroup('missing', (loaded, total) => {
            progressCalls.push([loaded, total]);
        });
        expect(bundle.textures.size).toBe(0);
        expect(progressCalls).toContainEqual([0, 0]);
    });

    it('shares a lazy mount across refs, labels and groups, and retries a failed mount', async () => {
        const assets = createAssets();
        assets.setManifest(createManifest());
        const mount = vi.mocked(platform.platformLoadSubpackage);
        mount.mockClear().mockRejectedValueOnce(new Error('offline'));
        const load = vi.spyOn(assets, 'acquireTexture').mockResolvedValue({
            key: 'texture:3', generation: 1, value: { handle: 3 }, release: () => {},
        } as any);
        vi.spyOn(assets, 'loadTexture').mockResolvedValue({ handle: 3 } as any);
        const failed = await assets.preload(['tex3.png', 'tex3.png'], undefined, { maxConcurrent: 1 });
        expect(failed.failed).toHaveLength(2);
        expect(failed.failed[0]).toMatchObject({ ref: 'tex3.png', reason: 'load-failed' });
        const [label, group, refs] = await Promise.all([
            assets.loadByLabel('gameplay'), assets.loadGroup('extra'), assets.preload(['tex3.png']),
        ]);
        expect(mount.mock.calls).toEqual([['extra'], ['extra']]);
        expect(load.mock.calls).toEqual([['tex3.png'], ['tex3.png']]);
        expect(refs.failed).toEqual([]);
        expect(label.scope.size).toBe(1);
        label.release();
        expect(group.scope.size).toBe(1);
        group.release();
    });

    it('releases every successful receipt when a progress listener throws', async () => {
        const assets = createAssets();
        const release = vi.fn();
        vi.spyOn(assets, 'acquireTexture').mockResolvedValue({ key: 'x', generation: 1, value: {}, release } as any);
        await expect(assets.loadByLabel('ui', count => { if (count) throw new Error('cancel'); })).rejects.toThrow('cancel');
        expect(release).toHaveBeenCalledTimes(2);
    });

    it('preloads a labeled data document by UUID without a host-supplied path resolver', async () => {
        const backend = createMockBackend();
        const assets = Assets.create({ backend, module: mockModule });
        const key = 'b0000000-0000-4000-8000-000000000001';
        const path = 'subpackages/extra/data.json';
        assets.setManifest({ version: '2.0', groups: { extra: { bundleMode: 'lazy', labels: [], assets: {
            [key]: { type: 'json', path, address: 'assets/data.json', labels: ['data'], size: 2 },
        } } } });
        const ref = '@uuid:' + key;
        expect((await assets.preload([ref])).failed).toEqual([]);
        const labeled = await assets.loadByLabel('data');
        expect(labeled.failed).toEqual([]);
        expect(labeled.scope.size).toBe(1);
        expect(backend.fetchText).toHaveBeenCalledTimes(1);
        expect(backend.fetchText).toHaveBeenCalledWith(path);
        labeled.release();
        assets.releaseTyped('json', ref);
        expect(assets.sizes().refRows).toBe(0);
    });

    it('is a no-op when no manifest is set', async () => {
        const assets = createAssets();
        const progressCalls: [number, number][] = [];
        const bundle = await assets.loadGroup('main', (loaded, total) => {
            progressCalls.push([loaded, total]);
        });
        expect(bundle.textures.size).toBe(0);
        expect(progressCalls).toContainEqual([0, 0]);
    });

    it('downloads a lazy group as a subpackage before loading its assets', async () => {
        const sub = vi.mocked(platform.platformLoadSubpackage);
        sub.mockClear();
        const assets = createAssets();
        assets.setManifest(createManifest());
        vi.spyOn(assets, 'acquireTexture').mockResolvedValue({ key: 'texture:x', generation: 1, value: { handle: 1, width: 1, height: 1 }, release: () => {} } as any);
        await assets.loadGroup('extra'); // createManifest: 'extra' is bundleMode 'lazy'
        expect(sub).toHaveBeenCalledWith('extra');
    });

    /**
     * A 分包 that downloads but stages nothing, a CDN that 404s every file: the
     * group loads, the bundle is empty, and a caller cannot tell that from a
     * group that was always empty. It has to say so.
     */
    it('says which assets failed instead of handing back a silently empty bundle', async () => {
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
        const assets = createAssets();
        assets.setManifest(createManifest());
        vi.spyOn(assets, 'acquireTexture').mockRejectedValue(new Error('404'));

        const bundle = await assets.loadGroup('main');
        expect(bundle.textures.size).toBe(0);
        expect(bundle.failed.map(missing => missing.ref).sort()).toEqual(['tex1.png', 'tex2.png']);

        const said = warn.mock.calls.find((c) => String(c[1]).includes('failed to load'));
        expect(said, 'loadGroup returned an empty bundle without saying why').toBeDefined();
        // Named, not counted: "2 assets failed" sends nobody anywhere.
        expect(String(said![1])).toContain("loadGroup('main')");
        expect((said![2] as Array<{ ref: string }>).map((f) => f.ref).sort())
            .toEqual(['tex1.png', 'tex2.png']);
        warn.mockRestore();
    });

    it('stays quiet when every asset in the group loaded', async () => {
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
        const assets = createAssets();
        assets.setManifest(createManifest());
        vi.spyOn(assets, 'acquireTexture').mockResolvedValue({
            key: 'texture:x', generation: 1, value: { handle: 1, width: 1, height: 1 }, release: () => {},
        } as any);
        await assets.loadGroup('main');
        expect(warn.mock.calls.filter((c) => String(c[1]).includes('failed to load'))).toEqual([]);
        warn.mockRestore();
    });

    it('does not download a subpackage for a local (main-package) group', async () => {
        const sub = vi.mocked(platform.platformLoadSubpackage);
        sub.mockClear();
        const assets = createAssets();
        assets.setManifest(createManifest());
        vi.spyOn(assets, 'acquireTexture').mockResolvedValue({ key: 'texture:x', generation: 1, value: { handle: 1, width: 1, height: 1 }, release: () => {} } as any);
        await assets.loadGroup('main'); // bundleMode 'local'
        expect(sub).not.toHaveBeenCalled();
    });
});
