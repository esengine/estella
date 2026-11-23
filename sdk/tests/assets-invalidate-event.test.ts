// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    assets-invalidate-event.test.ts
 * @brief   Assets.onInvalidate subscription contract: listeners fire on
 *          successful invalidations carrying WHICH KIND of asset ended,
 *          unsubscribe works, and a throwing listener doesn't starve others.
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

function seedTexture(assets: Assets, path: string, handle: number, flip = false): void {
    const internal = assets as unknown as {
        textureCache_: { set(key: string, load: unknown): void };
        textureCacheKey_: (path: string, flip: boolean) => string;
        textureRefs_: { acquire(key: string, handle: number): { generation: number } };
    };
    const key = internal.textureCacheKey_(path, flip);
    const { generation } = internal.textureRefs_.acquire(key, handle);
    internal.textureCache_.set(key, { value: { handle, width: 1, height: 1 }, generation });
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
        seedTexture(assets, 'tex/hot.png', 42, true);

        const listener = vi.fn();
        assets.onInvalidate(listener);

        const hit = assets.invalidate('tex/hot.png');
        expect(hit).toBe(true);
        expect(listener).toHaveBeenCalledWith({
            ref: 'tex/hot.png', type: 'texture', oldValue: 42,
        });
    });

    it('unsubscribe function prevents further notifications', () => {
        const assets = buildAssets();
        seedTexture(assets, 'tex/hot.png', 42);

        const listener = vi.fn();
        const unsubscribe = assets.onInvalidate(listener);

        assets.invalidate('tex/hot.png');
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();

        // Re-populate cache and invalidate again — listener should NOT fire.
        seedTexture(assets, 'tex/hot.png', 43);
        assets.invalidate('tex/hot.png');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('isolates listeners from each other — a throwing one does not starve others', () => {
        const assets = buildAssets();
        seedTexture(assets, 'tex/hot.png', 42);

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
        seedTexture(assets, 'tex/a.png', 1);

        const a = vi.fn();
        const b = vi.fn();
        const c = vi.fn();
        assets.onInvalidate(a);
        assets.onInvalidate(b);
        assets.onInvalidate(c);

        assets.invalidate('tex/a.png');
        const event = { ref: 'tex/a.png', type: 'texture', oldValue: expect.any(Number) };
        expect(a).toHaveBeenCalledWith(event);
        expect(b).toHaveBeenCalledWith(event);
        expect(c).toHaveBeenCalledWith(event);
    });
});
