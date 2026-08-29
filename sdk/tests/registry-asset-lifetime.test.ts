// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registry-asset-lifetime.test.ts
 * @brief   A registry-backed asset through the real Assets door: published while
 *          it is held, given back — with what it baked in — when it is not.
 *
 * @details The anim-clip loader acquired a texture per frame and released none:
 *          `unload()` was a comment saying clips are registered globally. So a
 *          clip and its frames stayed loaded for the life of the app, and the
 *          obvious fix (unregister on unload) would have let an old era delete
 *          the entry a hot update had just published under the same name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { SpriteAnimationAPI } from '../src/animation/SpriteAnimator';
import type { Backend } from '../src/asset/Backend';

function createPoolFake() {
    const byPath = new Map<string, number>();
    let next = 1;
    return {
        budget: 0,
        createTexture: vi.fn((): number => next++),
        registerTextureWithPath: vi.fn((handle: number, path: string) => { byPath.set(path, handle); }),
        acquireTextureByPath: vi.fn((path: string): number => byPath.get(path) ?? 0),
        invalidateTexturePath: vi.fn((path: string): boolean => byPath.delete(path)),
        releaseTexture: vi.fn(),
        getTextureDimensions: vi.fn(() => ({ width: 8, height: 8 })),
        getTextureGLId: vi.fn(() => 1),
        setTextureMetadata: vi.fn(),
    };
}
let pool = createPoolFake();
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => pool,
    getResourceManager: () => pool,
    evictTextureDimensions: vi.fn(),
}));

const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 8, height: 8,
        getContext: () => ({
            clearRect: vi.fn(), drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(8 * 8 * 4) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 8; img.height = 8; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(), platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(), platformFileExists: vi.fn(),
    platformLoadSubpackage: vi.fn(async () => {}),
    platformGetStorageItem: () => null, platformSetStorageItem: vi.fn(),
    platformWriteCacheFile: vi.fn(async () => {}),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

/** A `.esanim` naming two frame textures; `revision` distinguishes eras. */
function clipDocument(revision: number): string {
    // `fps` carries the era: a value the parse keeps, so a lookup can say which
    // one it is looking at.
    return JSON.stringify({
        version: '1.2', name: 'walk', fps: revision, loop: true,
        frames: [
            { texture: 'frames/a.png', duration: 0.1 },
            { texture: 'frames/b.png', duration: 0.1 },
        ],
    });
}

function buildAssets(sprites: SpriteAnimationAPI, doc: () => string) {
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => doc()),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
        getSpriteAnimation: () => sprites,
    } as never);
    return assets;
}

describe('a registry-backed asset lives as long as it is held', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('the last holder takes the clip and its frame textures with it', async () => {
        const sprites = new SpriteAnimationAPI();
        const assets = buildAssets(sprites, () => clipDocument(1));
        const base = assets.sizes().refRows;

        const a = await assets.acquireTyped('anim-clip', 'anim/walk.esanim');
        const b = await assets.acquireTyped('anim-clip', 'anim/walk.esanim');
        expect(sprites.getClip('anim/walk.esanim')?.frames).toHaveLength(2);
        // Two frame textures, acquired by the era that baked them in.
        expect(assets.sizes().refRows, 'the era owns its frames').toBe(base + 2);

        a.release();
        expect(sprites.getClip('anim/walk.esanim'), 'unpublished while B holds it').toBeDefined();
        expect(assets.sizes().refRows).toBe(base + 2);

        b.release();
        expect(sprites.getClip('anim/walk.esanim'), 'the pin this replaces').toBeUndefined();
        expect(assets.sizes().refRows, 'its frame textures were never given back').toBe(base);
        expect(assets.sizes().registrySlots).toBe(0);
    });

    it('a hot update republishes under the same name, and the old era cannot take it back', async () => {
        const sprites = new SpriteAnimationAPI();
        let revision = 1;
        const assets = buildAssets(sprites, () => clipDocument(revision));
        const base = assets.sizes().refRows;

        const first = await assets.acquireTyped('anim-clip', 'anim/walk.esanim');
        const second = await assets.acquireTyped('anim-clip', 'anim/walk.esanim');
        expect(sprites.getClip('anim/walk.esanim')?.fps).toBe(1);

        revision = 2;
        assets.invalidate('anim/walk.esanim');
        await new Promise((r) => setTimeout(r, 0));
        expect(sprites.getClip('anim/walk.esanim')?.fps, 'the swap a ref-bound holder follows').toBe(2);
        // One era at a time: what the replaced one held is back.
        expect(assets.sizes().refRows).toBe(base + 2);

        first.release();
        expect(sprites.getClip('anim/walk.esanim')?.fps, 'a retiring era unpublished its successor').toBe(2);
        second.release();
        expect(sprites.getClip('anim/walk.esanim')).toBeUndefined();
        expect(assets.sizes().refRows).toBe(base);
    });

    it('the ref a component spells and the path it resolved to are one slot', async () => {
        // The realm's resolver turns the serialized ref into a URL; a component
        // still asks for the ref. Both names, one asset, one era.
        const sprites = new SpriteAnimationAPI();
        let revision = 1;
        const assets = buildAssets(sprites, () => clipDocument(revision));
        assets.setAssetRefResolver((ref) => (ref === '@uuid:walk' ? 'anim/walk.esanim' : ref));

        const held = await assets.acquireTyped('anim-clip', '@uuid:walk');
        expect(sprites.getClip('@uuid:walk')).toBe(sprites.getClip('anim/walk.esanim'));
        expect(assets.sizes().registrySlots, 'two names, one slot').toBe(1);

        revision = 2;
        assets.invalidate('@uuid:walk');
        await new Promise((r) => setTimeout(r, 0));
        // The stale-alias split brain: one name answering with the old era.
        expect(sprites.getClip('@uuid:walk')?.fps).toBe(2);
        expect(sprites.getClip('anim/walk.esanim')?.fps).toBe(2);
        expect(sprites.getClip('@uuid:walk')).toBe(sprites.getClip('anim/walk.esanim'));

        held.release();
        expect(sprites.getClip('@uuid:walk')).toBeUndefined();
        expect(sprites.getClip('anim/walk.esanim')).toBeUndefined();
    });

    it('one Assets releasing cannot unpublish what another put there', async () => {
        // Two realms — an editor world beside a play world — share the registries
        // these assets publish into. Whose entry a name holds decides who may
        // take it out.
        const sprites = new SpriteAnimationAPI();
        const editor = buildAssets(sprites, () => clipDocument(1));
        const play = buildAssets(sprites, () => clipDocument(2));

        const held = await editor.acquireTyped('anim-clip', 'anim/walk.esanim');
        const playing = await play.acquireTyped('anim-clip', 'anim/walk.esanim');
        const published = sprites.getClip('anim/walk.esanim');

        held.release();
        expect(sprites.getClip('anim/walk.esanim'), 'the other realm lost its clip').toBe(published);
        playing.release();
        expect(sprites.getClip('anim/walk.esanim')).toBeUndefined();
    });
});
