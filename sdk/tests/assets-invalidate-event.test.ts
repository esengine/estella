/**
 * @file    assets-invalidate-event.test.ts
 * @brief   Assets.onInvalidate subscription contract: listeners fire on
 *          successful invalidations, unsubscribe works, and a throwing
 *          listener doesn't starve others.
 */
import { describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import type { ESEngineModule } from '../src/wasm';

function buildAssets(): Assets {
    const backend: Backend = {
        resolveUrl: (p: string) => p,
        fetchText: async () => '',
        fetchBinary: async () => new ArrayBuffer(0),
    } as unknown as Backend;
    return new Assets({
        backend,
        module: { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule,
    });
}

describe('Assets.onInvalidate', () => {
    it('does NOT fire when invalidate() finds no matching cache entry', () => {
        const assets = buildAssets();
        const listener = vi.fn();
        assets.onInvalidate(listener);

        // No cache populated → invalidate returns false → no listener fires.
        const hit = assets.invalidate('tex/never.png');
        expect(hit).toBe(false);
        expect(listener).not.toHaveBeenCalled();
    });

    it('fires with the original ref when invalidate hits a cache', async () => {
        const assets = buildAssets();
        // Seed the texture cache manually via internal map to avoid
        // wiring up a real WASM texture loader.
        const internal = assets as unknown as {
            textureCache_: { cache_: Map<string, unknown> };
            textureCacheKey_: (path: string, flip: boolean) => string;
            textureRefCounts_: Map<string, number>;
        };
        const key = internal.textureCacheKey_('tex/hot.png', false);
        internal.textureCache_.cache_.set(key, { handle: 42 });
        internal.textureRefCounts_.set(key, 1);

        const listener = vi.fn();
        assets.onInvalidate(listener);

        const hit = assets.invalidate('tex/hot.png');
        expect(hit).toBe(true);
        expect(listener).toHaveBeenCalledWith('tex/hot.png');
    });

    it('unsubscribe function prevents further notifications', () => {
        const assets = buildAssets();
        const internal = assets as unknown as {
            textureCache_: { cache_: Map<string, unknown> };
            textureCacheKey_: (path: string, flip: boolean) => string;
            textureRefCounts_: Map<string, number>;
        };
        const key = internal.textureCacheKey_('tex/hot.png', false);
        internal.textureCache_.cache_.set(key, { handle: 42 });
        internal.textureRefCounts_.set(key, 1);

        const listener = vi.fn();
        const unsubscribe = assets.onInvalidate(listener);

        assets.invalidate('tex/hot.png');
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();

        // Re-populate cache and invalidate again — listener should NOT fire.
        internal.textureCache_.cache_.set(key, { handle: 43 });
        internal.textureRefCounts_.set(key, 1);
        assets.invalidate('tex/hot.png');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('isolates listeners from each other — a throwing one does not starve others', () => {
        const assets = buildAssets();
        const internal = assets as unknown as {
            textureCache_: { cache_: Map<string, unknown> };
            textureCacheKey_: (path: string, flip: boolean) => string;
            textureRefCounts_: Map<string, number>;
        };
        const key = internal.textureCacheKey_('tex/hot.png', false);
        internal.textureCache_.cache_.set(key, { handle: 42 });
        internal.textureRefCounts_.set(key, 1);

        const bad = vi.fn(() => { throw new Error('listener failed'); });
        const good = vi.fn();
        assets.onInvalidate(bad);
        assets.onInvalidate(good);

        expect(() => assets.invalidate('tex/hot.png')).not.toThrow();
        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);
    });

    it('supports multiple listeners observing the same invalidation', () => {
        const assets = buildAssets();
        const internal = assets as unknown as {
            textureCache_: { cache_: Map<string, unknown> };
            textureCacheKey_: (path: string, flip: boolean) => string;
            textureRefCounts_: Map<string, number>;
        };
        const key = internal.textureCacheKey_('tex/a.png', false);
        internal.textureCache_.cache_.set(key, { handle: 1 });
        internal.textureRefCounts_.set(key, 1);

        const a = vi.fn();
        const b = vi.fn();
        const c = vi.fn();
        assets.onInvalidate(a);
        assets.onInvalidate(b);
        assets.onInvalidate(c);

        assets.invalidate('tex/a.png');
        expect(a).toHaveBeenCalledWith('tex/a.png');
        expect(b).toHaveBeenCalledWith('tex/a.png');
        expect(c).toHaveBeenCalledWith('tex/a.png');
    });
});
