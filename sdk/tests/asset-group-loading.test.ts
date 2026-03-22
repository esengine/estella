import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog, type CatalogData } from '../src/asset/Catalog';
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
