// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog, type CatalogData } from '../src/asset/Catalog';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import type { Backend } from '../src/asset/Backend';
import * as platform from '../src/platform';

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
    it('dispatches every asset in a group through the typed loader, into the bundle', async () => {
        const assets = createAssets();
        assets.setManifest(createManifest());
        // Spy the single texture channel so the assertion is about loadGroup's
        // dispatch, not the mock's image-decode pipeline.
        const spy = vi.spyOn(assets, 'loadTexture')
            .mockResolvedValue({ handle: 42, width: 64, height: 64 } as any);

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
        const spy = vi.spyOn(assets, 'loadTexture')
            .mockResolvedValue({ handle: 7, width: 1, height: 1 } as any);
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
        vi.spyOn(assets, 'loadTexture').mockResolvedValue({ handle: 1, width: 1, height: 1 } as any);
        await assets.loadGroup('extra'); // createManifest: 'extra' is bundleMode 'lazy'
        expect(sub).toHaveBeenCalledWith('extra');
    });

    it('does not download a subpackage for a local (main-package) group', async () => {
        const sub = vi.mocked(platform.platformLoadSubpackage);
        sub.mockClear();
        const assets = createAssets();
        assets.setManifest(createManifest());
        vi.spyOn(assets, 'loadTexture').mockResolvedValue({ handle: 1, width: 1, height: 1 } as any);
        await assets.loadGroup('main'); // bundleMode 'local'
        expect(sub).not.toHaveBeenCalled();
    });
});
