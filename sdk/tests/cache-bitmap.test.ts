import { describe, it, expect, vi } from 'vitest';
import { CacheBitmap } from '../src/cacheBitmap';

vi.mock('../src/renderer', () => ({
    Renderer: {
        createRenderTarget: vi.fn(() => 1),
        getTargetTexture: vi.fn(() => 42),
        releaseRenderTarget: vi.fn(),
        begin: vi.fn(),
        end: vi.fn(),
        resize: vi.fn(),
        setViewport: vi.fn(),
        setClearColor: vi.fn(),
        clearBuffers: vi.fn(),
        beginFrame: vi.fn(),
    },
}));

vi.mock('../src/renderTexture', () => ({
    RenderTexture: {
        create: vi.fn(() => ({ _handle: 1, textureId: 42, width: 256, height: 256, _depth: false, _filter: 'linear' })),
        release: vi.fn(),
        begin: vi.fn(),
        end: vi.fn(),
    },
}));

describe('CacheBitmap', () => {
    it('should create a cache with correct dimensions', () => {
        const cache = CacheBitmap.create(256, 256);
        expect(cache).toBeDefined();
        expect(cache.textureId).toBe(42);
        expect(cache.width).toBe(256);
        expect(cache.height).toBe(256);
    });

    it('should release cache', () => {
        const cache = CacheBitmap.create(128, 128);
        CacheBitmap.release(cache);
        expect(cache.textureId).toBe(0);
    });

    it('should track valid state', () => {
        const cache = CacheBitmap.create(64, 64);
        expect(cache.valid).toBe(true);
        CacheBitmap.release(cache);
        expect(cache.valid).toBe(false);
    });
});
