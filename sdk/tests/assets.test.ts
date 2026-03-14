import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog, type CatalogData } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { AssetLoader, LoadContext } from '../src/asset/AssetLoader';

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
    }),
    evictTextureDimensions: vi.fn(),
}));

vi.mock('../src/platform', () => ({
    platformCreateCanvas: () => {
        const canvas = {
            width: 256, height: 256,
            getContext: () => ({
                clearRect: vi.fn(),
                drawImage: vi.fn(),
                getImageData: () => ({
                    data: { buffer: new ArrayBuffer(256 * 256 * 4) },
                }),
            }),
        };
        return canvas;
    },
    platformCreateImage: () => {
        const img: any = {};
        setTimeout(() => { img.width = 64; img.height = 64; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
}));

function createMockBackend(): Backend {
    return {
        fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
        fetchText: vi.fn(async () => '{}'),
        resolveUrl: vi.fn((path: string) => `http://test/${path}`),
    };
}

const catalogData: CatalogData = {
    version: 1,
    entries: {
        'sprites/hero.png': {
            type: 'texture',
            atlas: 'atlas_0.png',
            frame: { x: 0, y: 0, w: 64, h: 64 },
            uv: { offset: [0, 0], scale: [0.5, 0.5] },
        },
        'sprites/bg.png': { type: 'texture' },
    },
    addresses: {
        'hero': 'sprites/hero.png',
    },
    labels: {
        'icons': ['sprites/hero.png', 'sprites/bg.png'],
    },
};

describe('Assets', () => {
    let assets: Assets;
    let backend: Backend;

    beforeEach(() => {
        backend = createMockBackend();
        assets = Assets.create({
            backend,
            catalog: Catalog.fromJson(catalogData),
            module: mockModule,
        });
    });

    it('creates instance with catalog', () => {
        expect(assets.catalog).toBeDefined();
        expect(assets.backend).toBe(backend);
    });

    it('creates instance with empty catalog', () => {
        const a = Assets.create({ backend, module: mockModule });
        expect(a.catalog.isEmpty).toBe(true);
    });

    it('resolves address in getAtlasFrame', () => {
        const frame = assets.getAtlasFrame('hero');
        expect(frame).not.toBeNull();
        expect(frame!.atlas).toBe('atlas_0.png');
        expect(frame!.uvOffset).toEqual([0, 0]);
    });

    it('returns null atlas frame for non-atlas texture', () => {
        expect(assets.getAtlasFrame('sprites/bg.png')).toBeNull();
    });

    describe('custom loader', () => {
        interface CustomData { value: string }

        const customLoader: AssetLoader<CustomData> = {
            type: 'custom',
            extensions: ['.custom'],
            load: vi.fn(async (_path: string, ctx: LoadContext) => {
                const text = await ctx.loadText(_path);
                return { value: text };
            }),
            unload: vi.fn(),
        };

        it('registers and loads custom type', async () => {
            (backend.fetchText as any).mockResolvedValue('hello custom');
            assets.register(customLoader);
            const result = await assets.load<CustomData>('custom', 'data/test.custom');
            expect(result.value).toBe('hello custom');
        });

        it('throws for unregistered type', async () => {
            await expect(assets.load('unknown', 'foo')).rejects.toThrow('No loader registered');
        });
    });

    describe('fetchJson', () => {
        it('fetches and parses JSON', async () => {
            (backend.fetchText as any).mockResolvedValue('{"key": "value"}');
            const result = await assets.fetchJson<{ key: string }>('config.json');
            expect(result.key).toBe('value');
        });
    });
});
