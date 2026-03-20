import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { SceneData } from '../src/scene';

vi.mock('../src/resourceManager', () => ({
    requireResourceManager: () => ({
        createTexture: vi.fn(() => 1),
        registerExternalTexture: vi.fn(() => 1),
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
        getContext: () => ({
            drawImage: vi.fn(),
            getImageData: () => ({ data: new Uint8Array(64 * 64 * 4) }),
        }),
        width: 64,
        height: 64,
    }),
    platformCreateImage: () => {
        const img = { onload: null as any, onerror: null as any, src: '', width: 64, height: 64, crossOrigin: '' };
        setTimeout(() => img.onload?.(), 0);
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
    };
}

function createSceneWithTextures(count: number): SceneData {
    const entities = [];
    for (let i = 0; i < count; i++) {
        entities.push({
            id: i,
            name: `entity_${i}`,
            parent: null,
            children: [],
            components: [{
                type: 'Sprite',
                data: { texture: `tex_${i}.png` },
            }],
        });
    }
    return { name: 'test', entities };
}

describe('Scene loading progress', () => {
    it('should call onProgress with loaded/total counts', async () => {
        const backend = createMockBackend();
        const catalog = new Catalog({ assets: {}, atlasPages: [], atlasFrames: {} });
        const assets = new Assets(backend, catalog, null as any);

        const scene = createSceneWithTextures(3);
        const progressCalls: [number, number][] = [];

        await assets.preloadSceneAssets(scene, (loaded, total) => {
            progressCalls.push([loaded, total]);
        });

        expect(progressCalls.length).toBeGreaterThan(0);

        const [firstLoaded, firstTotal] = progressCalls[0];
        expect(firstLoaded).toBe(0);
        expect(firstTotal).toBe(3);

        const lastCall = progressCalls[progressCalls.length - 1];
        expect(lastCall[0]).toBe(lastCall[1]);
    });

    it('should not fail when onProgress is undefined', async () => {
        const backend = createMockBackend();
        const catalog = new Catalog({ assets: {}, atlasPages: [], atlasFrames: {} });
        const assets = new Assets(backend, catalog, null as any);

        const scene = createSceneWithTextures(1);
        const result = await assets.preloadSceneAssets(scene);
        expect(result.textureHandles).toBeDefined();
    });

    it('should report 0/0 for empty scene', async () => {
        const backend = createMockBackend();
        const catalog = new Catalog({ assets: {}, atlasPages: [], atlasFrames: {} });
        const assets = new Assets(backend, catalog, null as any);

        const scene: SceneData = { name: 'empty', entities: [] };
        const progressCalls: [number, number][] = [];

        await assets.preloadSceneAssets(scene, (loaded, total) => {
            progressCalls.push([loaded, total]);
        });

        expect(progressCalls).toContainEqual([0, 0]);
    });
});
