// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    texture-residency.test.ts
 * @brief   Assets ↔ C++ pool residency contract: a released texture stays
 *          revivable by its residency key (no re-decode), hot-reload
 *          invalidation severs that identity, and the SDK holds exactly one
 *          pool reference regardless of how many callers loaded the texture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { loadDragonBonesAssets } from '../src/dragonbones/loadDragonBonesScene';
import { releaseUnusedAtlases } from '../src/dragonbones/atlasOwnership';

interface PoolEntry {
    refCount: number;
    path: string | null;
    evictable: boolean;
}

/**
 * Stateful stand-in for the C++ ResourcePool texture surface, modelling the
 * held → evictable → evicted lifecycle the SDK glue is written against.
 */
function createPoolFake() {
    const entries = new Map<number, PoolEntry>();
    const byPath = new Map<string, number>();
    let nextHandle = 1;

    const free = (handle: number): void => {
        const e = entries.get(handle);
        if (!e) return;
        if (e.path !== null && byPath.get(e.path) === handle) byPath.delete(e.path);
        entries.delete(handle);
    };

    const rm = {
        budget: 1024 * 1024,
        createTexture: vi.fn((): number => {
            const handle = nextHandle++;
            entries.set(handle, { refCount: 1, path: null, evictable: false });
            return handle;
        }),
        registerExternalTexture: vi.fn((): number => rm.createTexture()),
        registerTextureWithPath: vi.fn((handle: number, path: string): void => {
            const e = entries.get(handle);
            if (!e || e.refCount === 0 || e.path === path) return;
            if (e.path !== null) byPath.delete(e.path);
            const previous = byPath.get(path);
            if (previous !== undefined) {
                const displaced = entries.get(previous)!;
                displaced.path = null;
                if (displaced.evictable) free(previous);
            }
            e.path = path;
            byPath.set(path, handle);
        }),
        acquireTextureByPath: vi.fn((path: string): number => {
            const handle = byPath.get(path);
            if (handle === undefined) return 0;
            const e = entries.get(handle)!;
            if (e.evictable) {
                e.evictable = false;
                e.refCount = 1;
            } else {
                e.refCount++;
            }
            return handle;
        }),
        invalidateTexturePath: vi.fn((path: string): boolean => {
            const handle = byPath.get(path);
            if (handle === undefined) return false;
            byPath.delete(path);
            const e = entries.get(handle)!;
            e.path = null;
            if (e.evictable) free(handle);
            return true;
        }),
        releaseTexture: vi.fn((handle: number): void => {
            const e = entries.get(handle);
            if (!e || e.refCount === 0) return;
            if (--e.refCount === 0) {
                if (rm.budget > 0 && e.path !== null) {
                    e.evictable = true;
                } else {
                    free(handle);
                }
            }
        }),
        getTextureDimensions: vi.fn((handle: number) => {
            const e = entries.get(handle);
            if (!e || e.refCount === 0) return null;
            return { width: 64, height: 64 };
        }),
        getTextureGLId: vi.fn((handle: number) => handle + 1000),
        adoptTextureContent: vi.fn((target: number, source: number) =>
            !!entries.get(target)?.refCount && !!entries.get(source)?.refCount),
        // Test-only inspection helpers.
        entryOf: (handle: number) => entries.get(handle) ?? null,
        isResident: (handle: number) => entries.has(handle),
    };
    return rm;
}

let pool = createPoolFake();

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => pool,
    getResourceManager: () => pool,
    evictTextureDimensions: vi.fn(),
}));

// TextureLoader/imageDecode import the concrete base module (cycle-free); the
// rest go through the barrel — mock both ids with one factory.
const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 256, height: 256,
        getContext: () => ({
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(256 * 256 * 4) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 64; img.height = 64; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

const mockModule = {
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HEAPU8: new Uint8Array(1024 * 1024),
    GL: null,
    FS: null,
} as never;

function buildAssets(text: Backend['fetchText'] = async () => '{}'): Assets {
    const backend: Backend = {
        fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
        fetchText: vi.fn(text),
        resolveUrl: (path: string) => `http://test/${path}`,
    } as unknown as Backend;
    return Assets.create({ backend, module: mockModule });
}

describe('texture residency (Assets ↔ pool contract)', () => {
    beforeEach(() => {
        pool = createPoolFake();
    });

    it('registers the residency key at load time', async () => {
        const assets = buildAssets();
        const result = await assets.loadTexture('tex/a.png');
        expect(pool.registerTextureWithPath).toHaveBeenCalledWith(result.handle, 'tex/a.png:f');
    });

    it('release keeps the texture evictable; the next load revives it without re-decoding', async () => {
        const assets = buildAssets();
        const first = await assets.loadTexture('tex/a.png');
        expect(pool.createTexture).toHaveBeenCalledTimes(1);

        assets.releaseTexture('tex/a.png');
        expect(pool.entryOf(first.handle)).toMatchObject({ refCount: 0, evictable: true });
        expect(assets.getTexture('tex/a.png')).toBeUndefined();

        const second = await assets.loadTexture('tex/a.png');
        expect(second.handle).toBe(first.handle);
        expect(second.width).toBe(64);
        expect(pool.createTexture).toHaveBeenCalledTimes(1);  // no second decode+upload
        expect(pool.entryOf(second.handle)).toMatchObject({ refCount: 1, evictable: false });
    });

    it('revives each loader\'s copy of the same path and isolates a file edit to its owner', async () => {
        const a = buildAssets(), b = buildAssets();
        const file = 'tex/shared.png';
        const first = await a.acquireTexture(file), second = await b.acquireTexture(file);
        expect(first.value.handle).not.toBe(second.value.handle);
        first.release();
        second.release();
        const warmA = await a.acquireTexture(file), warmB = await b.acquireTexture(file);
        expect([warmA.value.handle, warmB.value.handle]).toEqual([first.value.handle, second.value.handle]);
        expect(pool.createTexture).toHaveBeenCalledTimes(2);
        warmA.release();
        warmB.release();
        a.invalidate(file);
        expect(pool.isResident(first.value.handle)).toBe(false);
        const stillWarm = await b.acquireTexture(file);
        expect(stillWarm.value.handle).toBe(second.value.handle);
        expect(pool.createTexture).toHaveBeenCalledTimes(2);
        stillWarm.release();
    });

    it('restores a warm mesh preview in place for a tileset and never exposes a late smaller upload', async () => {
        const assets = buildAssets(), file = 'tex/shared.png';
        const scene = (type: string, field: string) => ({
            version: '1.0', name: 'Use', entities: [{ id: 1, name: 'Draw', parent: null, children: [],
                components: [{ type, data: { [field]: file } }] }],
        });
        assets.setTextureStreamingStart(64);
        const decode = vi.fn(async (_path: string, _flip: boolean, edge?: number) => {
            const width = edge || 512;
            return { width, height: 1, sourceWidth: 512, sourceHeight: 1, pixels: new Uint8Array(width * 4) };
        });
        assets.getTextureLoader().setPixelDecoder(decode);
        try {
            const room = await assets.preloadSceneAssets(scene('MeshRenderer', 'texture'));
            const handle = room.textureHandles.get(file)!;
            room.scope.releaseAll();
            expect(pool.entryOf(handle)?.evictable).toBe(true);
            const tile = await assets.preloadSceneAssets(scene('TilemapLayer', 'tileset'));
            expect(tile.missing).toEqual([]);
            expect(tile.textureHandles.get(file)).toBe(handle);
            expect(assets.getTexture(file)).toMatchObject({ handle, width: 512 });
            let resume!: () => void, enter!: () => void;
            const waiting = new Promise<void>(resolve => { enter = resolve; });
            const gate = new Promise<void>(resolve => { resume = resolve; });
            decode.mockImplementationOnce(async () => {
                enter(); await gate;
                return { width: 32, height: 1, sourceWidth: 512, sourceHeight: 1, pixels: new Uint8Array(32 * 4) };
            });
            const shrink = assets.resizeTexture(handle, 32);
            await waiting;
            const sprite = await assets.preloadSceneAssets(scene('Sprite', 'texture'));
            resume();
            expect(await shrink).toBeNull();
            expect(sprite.textureHandles.get(file)).toBe(handle);
            expect(assets.getTexture(file)).toMatchObject({ handle, width: 512 });
            await assets.resizeTexture(handle, 64);
            const restoring = new Promise<void>(resolve => { enter = resolve; });
            const restored = new Promise<void>(resolve => { resume = resolve; });
            decode.mockImplementationOnce(async () => {
                enter(); await restored;
                return { width: 512, height: 1, sourceWidth: 512, sourceHeight: 1, pixels: new Uint8Array(512 * 4) };
            });
            const preparing = assets.preloadSceneAssets(scene('TilemapLayer', 'tileset'));
            await restoring;
            const competing = assets.resizeTexture(handle, 32);
            resume();
            const shared = await preparing;
            expect(shared.missing).toEqual([]);
            expect(shared.textureHandles.get(file)).toBe(handle);
            expect(await competing).toBeNull();
            expect(assets.getTexture(file)).toMatchObject({ handle, width: 512 });
            tile.scope.releaseAll(); sprite.scope.releaseAll(); shared.scope.releaseAll();
            expect(pool.entryOf(handle)?.refCount).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('the SDK holds one pool reference no matter how many callers loaded', async () => {
        const assets = buildAssets();
        const result = await assets.loadTexture('tex/a.png');
        await assets.loadTexture('tex/a.png');
        expect(pool.entryOf(result.handle)?.refCount).toBe(1);

        assets.releaseTexture('tex/a.png');
        expect(pool.releaseTexture).not.toHaveBeenCalled();  // still one SDK ref outstanding
        expect(pool.entryOf(result.handle)?.refCount).toBe(1);

        assets.releaseTexture('tex/a.png');
        expect(pool.releaseTexture).toHaveBeenCalledTimes(1);
        expect(pool.entryOf(result.handle)?.evictable).toBe(true);
    });

    it.each(['typed', 'texture'] as const)('keeps streaming until the last native reference when %s releases first', async first => {
        const assets = buildAssets();
        const file = 'tex/shared.png';
        const typed = await assets.acquireTyped<{ handle: number }>('texture', file);
        const texture = await assets.acquireTexture(file);
        const handle = texture.value.handle;
        expect(typed.value.handle).toBe(handle);
        const holders = { typed, texture };
        holders[first].release();
        expect(assets.textureResizable(handle)).toBe(true);
        holders[first === 'typed' ? 'texture' : 'typed'].release();
        expect([...assets.getTextureLoader().resizableHandles()]).toEqual([]);
        const revived = await assets.acquireTexture(file);
        expect(revived.value.handle).toBe(handle);
        expect(assets.textureFullSize(handle)).toEqual({ width: 64, height: 64 });
        assets.releaseAll();
        expect(assets.textureResizable(handle)).toBe(false);
        expect(pool.entryOf(handle)?.refCount).toBe(0);
    });

    it.each(['release and revive', 'teardown and revive', 'file edit', 'newer resize'] as const)(
        'discards a late streaming upload after %s', async change => {
            const assets = buildAssets();
            const file = 'tex/racing.png';
            const held = await assets.acquireTexture(file);
            const handle = held.value.handle;
            let enter!: () => void, resume!: () => void;
            const entered = new Promise<void>(resolve => { enter = resolve; });
            const gate = new Promise<void>(resolve => { resume = resolve; });
            assets.getTextureLoader().setPixelDecoder(async (_path, _flip, edge) => {
                if (edge === 4) { enter(); await gate; }
                const width = edge || 64;
                return { width, height: 1, pixels: new Uint8Array(width * 4) };
            });
            const resizing = assets.resizeTexture(handle, 4);
            try {
                await entered;
                if (change === 'file edit') {
                    assets.invalidate(file);
                    expect(assets.textureResizable(handle)).toBe(false);
                } else if (change === 'newer resize') {
                    expect(await assets.resizeTexture(handle, 8)).toEqual({ width: 8, height: 1 });
                } else {
                    if (change === 'release and revive') held.release();
                    else assets.releaseAll();
                    expect((await assets.acquireTexture(file)).value.handle).toBe(handle);
                }
                resume();
                expect(await resizing).toBeNull();
                expect(pool.adoptTextureContent).toHaveBeenCalledTimes(change === 'newer resize' ? 1 : 0);
                const temporary = pool.createTexture.mock.results.at(-1)!.value;
                expect(pool.isResident(temporary)).toBe(false);
            } finally { resume(); await resizing; assets.releaseAll(); }
        });

    it('gives back the temporary upload when a host refuses a resize by throwing', async () => {
        const assets = buildAssets();
        const held = await assets.acquireTexture('tex/refused.png');
        pool.adoptTextureContent.mockImplementationOnce(() => { throw new Error('lost device'); });
        await expect(assets.resizeTexture(held.value.handle, 4)).rejects.toThrow('lost device');
        const temporary = pool.createTexture.mock.results.at(-1)!.value;
        expect(pool.isResident(temporary)).toBe(false);
        expect(assets.textureResizable(held.value.handle)).toBe(true);
        held.release();
    });

    it('invalidate severs the residency identity — an evicted entry is never revived', async () => {
        const assets = buildAssets();
        const first = await assets.loadTexture('tex/a.png');
        assets.releaseTexture('tex/a.png');
        expect(pool.entryOf(first.handle)?.evictable).toBe(true);

        assets.invalidate('tex/a.png');
        expect(pool.isResident(first.handle)).toBe(false);  // evictable + invalidated → freed

        const second = await assets.loadTexture('tex/a.png');
        expect(second.handle).not.toBe(first.handle);
        expect(pool.createTexture).toHaveBeenCalledTimes(2);  // fresh bytes, no stale revive
    });

    it('invalidate on a held texture keeps it alive for current holders but blocks future revival', async () => {
        const assets = buildAssets();
        const first = await assets.loadTexture('tex/a.png');

        assets.invalidate('tex/a.png');
        expect(pool.isResident(first.handle)).toBe(true);  // old handle keeps rendering

        const second = await assets.loadTexture('tex/a.png');
        expect(second.handle).not.toBe(first.handle);
        expect(pool.createTexture).toHaveBeenCalledTimes(2);
    });

    it.each(['before', 'after'] as const)('keeps the new residency when an invalidated decode finishes %s its replacement', async order => {
        const assets = buildAssets();
        const ref = 'tex/edited.png';
        let entered!: () => void, resume!: () => void;
        const decoding = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { resume = resolve; });
        let reads = 0;
        assets.getTextureLoader().setPixelDecoder(async () => {
            const width = ++reads;
            if (width === 1) { entered(); await gate; }
            return { width, height: 1, pixels: new Uint8Array(width * 4) };
        });
        const pending = assets.acquireTexture(ref);
        try {
            await decoding;
            assets.invalidate(ref);
            if (order === 'before') { resume(); await pending; }
            const fresh = await assets.acquireTexture(ref);
            resume();
            const previous = await pending;
            expect([previous.value.width, fresh.value.width]).toEqual([1, 2]);
            previous.release();
            expect(pool.entryOf(previous.value.handle)).toBeNull();
            expect(pool.entryOf(fresh.value.handle)?.refCount).toBe(1);
            fresh.release();
            const revived = await assets.acquireTexture(ref);
            expect(revived.value.handle).toBe(fresh.value.handle);
            expect(assets.getTextureLoader().fullSize(revived.value.handle)?.width).toBe(2);
            expect(reads).toBe(2);
            revived.release();
            expect(pool.entryOf(fresh.value.handle)?.refCount).toBe(0);
        } finally { resume(); assets.releaseAll(); }
    });

    it('flip variants are distinct residency entries', async () => {
        const assets = buildAssets();
        const flipped = await assets.loadTexture('tex/a.png');
        const raw = await assets.loadTextureRaw('tex/a.png');
        expect(raw.handle).not.toBe(flipped.handle);
        expect(pool.registerTextureWithPath).toHaveBeenCalledWith(flipped.handle, 'tex/a.png:f');
        expect(pool.registerTextureWithPath).toHaveBeenCalledWith(raw.handle, 'tex/a.png:n');
    });

    it('shares raw pages with both skeleton formats and revives only the owning App’s version', async () => {
        const file = 'rig/page.png', skel = 'rig/hero.skel', atlas = 'rig/hero.atlas';
        const text = async (p: string) => p.endsWith(atlas) ? 'page.png\nsize: 64,64\n' : '{"imagePath":"page.png"}';
        const a = buildAssets(text), b = buildAssets(text);
        const pairs = [{ skeleton: 'rig/dragon.json', atlas: 'rig/dragon.atlas' }];
        const dragon = (assets: Assets) => loadDragonBonesAssets(null,
            { backend: assets.backend, decodePixels: async () => { throw Error('unexpected standalone upload'); } },
            pairs, undefined, assets);
        try {
            const spine = await a.acquireSpine(skel, atlas);
            const aRaw = await a.acquireTexture(file, false), bRaw = await b.acquireTexture(file, false);
            const aDragon = await dragon(a), bDragon = await dragon(b);
            const renderId = (h: number) => pool.getTextureGLId(h);
            expect(spine.value.textures.get('page.png')?.glId).toBe(renderId(aRaw.value.handle));
            expect([...aDragon.values()][0]!.textureId).toBe(renderId(aRaw.value.handle));
            expect([...bDragon.values()][0]!.textureId).toBe(renderId(bRaw.value.handle));
            expect(aRaw.value.handle).not.toBe(bRaw.value.handle);
            expect(pool.createTexture).toHaveBeenCalledTimes(2);

            releaseUnusedAtlases(aDragon.values()); releaseUnusedAtlases(bDragon.values());
            spine.release(); aRaw.release(); bRaw.release();
            const warmA = await a.acquireTexture(file, false);
            expect(warmA.value.handle).toBe(aRaw.value.handle);
            a.invalidate(file);
            const updated = await a.acquireTexture(file, false), warmB = await b.acquireTexture(file, false);
            expect(updated.value.handle).not.toBe(warmA.value.handle);
            expect(warmB.value.handle).toBe(bRaw.value.handle);
            expect(pool.createTexture).toHaveBeenCalledTimes(3);
            warmA.release(); updated.release(); warmB.release();
        } finally { a.releaseAll(); b.releaseAll(); }
    });

    it('allows the primary loader to invalidate a native host’s plain path', () => {
        const assets = buildAssets();
        const other = buildAssets();
        assets.invalidate('establish-primary');
        const atlas = pool.createTexture();
        pool.registerTextureWithPath(atlas, 'tex/atlas.png');
        pool.releaseTexture(atlas);

        expect(other.invalidate('tex/atlas.png')).toBe(false);
        expect(pool.isResident(atlas)).toBe(true);
        expect(assets.invalidate('tex/atlas.png')).toBe(true);
        expect(pool.isResident(atlas)).toBe(false);
        expect(pool.acquireTextureByPath('tex/atlas.png')).toBe(0);
        expect(assets.invalidate('tex/atlas.png')).toBe(false);
    });

    it('keeps held atlas pages alive while severing their stale residency identity', () => {
        const assets = buildAssets();
        const atlas = pool.createTexture();
        pool.registerTextureWithPath(atlas, 'tex/atlas.png');

        expect(assets.invalidate('tex/atlas.png')).toBe(true);
        expect(pool.entryOf(atlas)).toMatchObject({ refCount: 1, path: null });
        expect(pool.acquireTextureByPath('tex/atlas.png')).toBe(0);
        pool.releaseTexture(atlas);
        expect(pool.isResident(atlas)).toBe(false);
    });

    it('with the budget off, release frees outright and the next load re-decodes', async () => {
        pool.budget = 0;
        const assets = buildAssets();
        const first = await assets.loadTexture('tex/a.png');
        assets.releaseTexture('tex/a.png');
        expect(pool.isResident(first.handle)).toBe(false);

        await assets.loadTexture('tex/a.png');
        expect(pool.createTexture).toHaveBeenCalledTimes(2);
    });
});
