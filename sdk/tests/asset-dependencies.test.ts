// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    asset-dependencies.test.ts
 * @brief   What an asset's preparation took, as the acquisitions themselves say.
 *
 * @details An edge is a projection of what happened, not a description kept
 *          beside the work: a loader has no door for declaring one, and the
 *          doors it does have record what they hand over. Two kinds, and the
 *          difference is the whole point — `owned` is a runtime resource the era
 *          holds, `source` is content that decided what the era became.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { LoadContext } from '../src/asset/AssetLoader';

function createPoolFake() {
    const live = new Set<number>();
    const byPath = new Map<string, number>();
    let next = 1;
    return {
        budget: 0,
        createTexture: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        createTextureFromBytes: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        registerTextureWithPath: vi.fn((handle: number, path: string) => { byPath.set(path, handle); }),
        acquireTextureByPath: vi.fn((path: string): number => byPath.get(path) ?? 0),
        invalidateTexturePath: vi.fn((path: string): boolean => byPath.delete(path)),
        releaseTexture: vi.fn((handle: number) => { live.delete(handle); }),
        getTextureDimensions: vi.fn(() => ({ width: 4, height: 4 })),
        getTextureGLId: vi.fn(() => 1),
        setTextureMetadata: vi.fn(),
        liveTextures: () => live.size,
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
        width: 4, height: 4,
        getContext: () => ({
            clearRect: vi.fn(), drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 4; img.height = 4; img.onload?.(); }, 0);
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

const materialFake = vi.hoisted(() => {
    const live = new Set<number>();
    let next = 100;
    return {
        live,
        reset: () => { live.clear(); next = 100; },
        Material: {
            createFromAsset: vi.fn((): number => { const h = next++; live.add(h); return h; }),
            setUniform: vi.fn(),
            tex: vi.fn((handle: number) => ({ kind: 'tex', handle })),
            compileShader: vi.fn(() => 7),
            release: vi.fn((h: number) => { live.delete(h); }),
        },
    };
});
vi.mock('../src/render/material', () => ({ Material: materialFake.Material }));

/** A `.tmj` whose one tileset lives in an external `.tsj`. */
const MAP_WITH_EXTERNAL = JSON.stringify({
    width: 1, height: 1, tilewidth: 4, tileheight: 4,
    tilesets: [{ firstgid: 1, source: 'terrain.tsj' }],
    layers: [{ type: 'tilelayer', name: 'g', width: 1, height: 1, data: [1] }],
});
const EXTERNAL_TILESET = JSON.stringify({
    name: 'terrain', image: 'terrain.png', columns: 2, tilecount: 4,
    tilewidth: 4, tileheight: 4,
});
const MAP_WITH_COLLECTION = JSON.stringify({
    width: 1, height: 1, tilewidth: 4, tileheight: 4,
    tilesets: [{
        firstgid: 1, name: 'props', columns: 0, tilecount: 1,
        tiles: [{ id: 0, image: 'rock.png', imagewidth: 4, imageheight: 4 }],
    }],
    layers: [{ type: 'tilelayer', name: 'g', width: 1, height: 1, data: [1] }],
});

/** A material binding one texture, on a built-in shader (no shader file). */
const MATERIAL = JSON.stringify({
    type: 'material', shader: 'builtin:sprite-unlit', properties: { mainTex: 'wall.png' },
});
/** An instance of it: no shader of its own, only diffs against its parent. */
const CHILD_MATERIAL = JSON.stringify({
    type: 'material', shader: '', instanceOf: 'parent.esmaterial', properties: {},
});

function realm(docs: Record<string, string>): Assets {
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async (url: string) => {
                const key = Object.keys(docs).find((k) => url.endsWith(k));
                return key ? docs[key] : '{}';
            }),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        catalog: Catalog.empty(),
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
    });
    assets.getTextureLoader().setPixelDecoder(async () => ({
        width: 4, height: 4, pixels: new Uint8Array(64),
    }));
    return assets;
}

describe('an edge comes from the acquisition that made it', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('an external .tsj is a SOURCE dependency of the map that folded it in', async () => {
        // Nothing is held for it — there is no runtime object — but what the map
        // IS was decided by it. Read through the plain text door it would leave
        // no trace, and a change to it could never reach the map.
        const assets = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        await assets.acquireTyped('tilemap', 'maps/level.tmj');

        const edges = assets.dependenciesOf('tilemap', 'maps/level.tmj');
        expect(edges).toContainEqual({ kind: 'source', path: 'maps/terrain.tsj' });
    });

    it('a texture the map loaded is an OWNED dependency, named as a texture', async () => {
        const assets = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        await assets.acquireTyped('tilemap', 'maps/level.tmj');

        expect(assets.dependenciesOf('tilemap', 'maps/level.tmj'))
            .toContainEqual({ kind: 'owned', type: 'texture', path: 'maps/terrain.png' });
    });

    it('a composed atlas is owned, and is not pretending to be a path', async () => {
        // It has no asset identity at all: naming it one would put a lookup key
        // in the graph that no invalidation could ever match.
        const assets = realm({ 'level.tmj': MAP_WITH_COLLECTION });
        await assets.acquireTyped('tilemap', 'maps/level.tmj');

        const edges = assets.dependenciesOf('tilemap', 'maps/level.tmj');
        const composed = edges.filter((e) => e.path.startsWith('composed:'));
        expect(composed).toHaveLength(1);
        expect(composed[0].kind).toBe('owned');
        expect(composed[0].type, 'a composed resource has no asset type').toBeUndefined();
    });

    it('releasing the parent gives the OWNED children back and destroys nothing else', async () => {
        const assets = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        const base = assets.sizes().refRows;
        const held = await assets.acquireTyped('tilemap', 'maps/level.tmj');
        expect(pool.liveTextures()).toBe(1);

        held.release();
        expect(assets.sizes().refRows).toBe(base);
        expect(pool.liveTextures(), 'the owned texture stayed').toBe(0);
        // The source edge held nothing, so there was nothing of its to destroy —
        // and the graph is gone with the era that recorded it.
        expect(assets.dependenciesOf('tilemap', 'maps/level.tmj')).toEqual([]);
    });

    it('two realms record their own edges', async () => {
        const a = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        const b = realm({ 'level.tmj': MAP_WITH_COLLECTION });
        await a.acquireTyped('tilemap', 'maps/level.tmj');
        await b.acquireTyped('tilemap', 'maps/level.tmj');

        expect(a.dependenciesOf('tilemap', 'maps/level.tmj'))
            .toContainEqual({ kind: 'source', path: 'maps/terrain.tsj' });
        expect(b.dependenciesOf('tilemap', 'maps/level.tmj').some((e) => e.kind === 'source'),
               'one realm\'s edges showed up in the other').toBe(false);
    });
});

describe('a preparation is a transaction', () => {
    beforeEach(() => { pool = createPoolFake(); });

    /** A registry-backed loader that takes two textures and then fails. */
    function brittle(assets: Assets): void {
        assets.register({
            type: 'brittle',
            extensions: ['.brittle'],
            registry: {
                prepare: async (_path, ctx) => {
                    await ctx.acquireTexture('a.png');
                    await ctx.acquireTexture('b.png');
                    throw new Error('prepare failed');
                },
            },
        });
    }

    it('a preparation that throws keeps nothing it acquired', async () => {
        // Nothing took over the receipts: there is no era to hold them, and the
        // slot the acquire was for is gone. Only the attempt itself knows what
        // it took, so only the attempt can give it back.
        const assets = realm({});
        brittle(assets);
        const base = assets.sizes().refRows;

        await expect(assets.acquireTyped('brittle', 'x.brittle')).rejects.toThrow('prepare failed');

        expect(pool.liveTextures(), 'the textures the failed attempt took').toBe(0);
        expect(assets.sizes().refRows, 'the ledger rows it opened').toBe(base);
    });

    it('a failed preparation publishes nothing and leaves no edges', async () => {
        const assets = realm({});
        brittle(assets);

        await expect(assets.acquireTyped('brittle', 'x.brittle')).rejects.toThrow();

        expect(assets.dependenciesOf('brittle', 'x.brittle')).toEqual([]);
        expect(assets.resolveRegistryAsset('brittle', 'x.brittle')).toBeUndefined();
    });
});

describe('a handle-bound load is a preparation too', () => {
    beforeEach(() => { pool = createPoolFake(); });

    /** A loader whose asset a component holds BY HANDLE, binding one texture. */
    function gadget(assets: Assets, opts: { fail?: boolean } = {}): void {
        assets.register<{ handle: number }>({
            type: 'gadget',
            extensions: ['.gadget'],
            load: async (_path, ctx) => {
                const tex = await ctx.acquireTexture('g.png');
                if (opts.fail) throw new Error('load failed');
                return { handle: tex.value.handle };
            },
            unload: () => {},
        });
    }

    it('the texture it bound is an owned dependency of it', async () => {
        // Nothing about a dependency is registry-shaped: what makes the edge is
        // the acquisition, and a handle-bound asset acquires the same way.
        const assets = realm({});
        gadget(assets);
        await assets.acquireTyped('gadget', 'x.gadget');

        expect(assets.dependenciesOf('gadget', 'x.gadget'))
            .toContainEqual({ kind: 'owned', type: 'texture', path: 'g.png' });
    });

    it('the last holder giving it back gives back what its preparation took', async () => {
        const assets = realm({});
        gadget(assets);
        const held = await assets.acquireTyped('gadget', 'x.gadget');
        expect(pool.liveTextures()).toBe(1);

        held.release();
        expect(pool.liveTextures(), 'the texture the load took').toBe(0);
        expect(assets.dependenciesOf('gadget', 'x.gadget')).toEqual([]);
    });

    it('a load that lands after the realm let go has no owner to hand to', async () => {
        // Handing it over would open a ledger row in a realm that already
        // drained its own, and nothing would ever unload it.
        const assets = realm({});
        let finish = (): void => {};
        assets.register<{ handle: number }>({
            type: 'slow', extensions: ['.slow'],
            load: async (_path, ctx) => {
                const tex = await ctx.acquireTexture('g.png');
                await new Promise<void>((resolve) => { finish = resolve; });
                return { handle: tex.value.handle };
            },
            unload: () => {},
        });

        const loading = assets.acquireTyped('slow', 'x.slow');
        await new Promise((resolve) => setTimeout(resolve, 0));
        assets.releaseAll();
        finish();

        await expect(loading).rejects.toThrow(/released while/);
        expect(pool.liveTextures(), 'the texture the ownerless load took').toBe(0);
    });

    it('a load that throws keeps nothing it acquired', async () => {
        const assets = realm({});
        gadget(assets, { fail: true });
        const base = assets.sizes().refRows;

        await expect(assets.acquireTyped('gadget', 'x.gadget')).rejects.toThrow('load failed');

        expect(pool.liveTextures(), 'the texture the failed load took').toBe(0);
        expect(assets.sizes().refRows).toBe(base);
    });
});

describe('a handle-bound loader owns nothing of its own', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('a material\'s bound texture is its era\'s, and goes back with it', async () => {
        // The receipts are the era's, not a field the loader keeps beside its
        // result and remembers to hand back.
        const assets = realm({ 'hero.esmaterial': MATERIAL });
        const held = await assets.acquireTyped('material', 'materials/hero.esmaterial');
        expect(pool.liveTextures()).toBe(1);

        expect(assets.dependenciesOf('material', 'materials/hero.esmaterial'))
            .toContainEqual({ kind: 'owned', type: 'texture', path: 'materials/wall.png' });

        held.release();
        expect(pool.liveTextures(), 'the texture the material bound').toBe(0);
    });

    it('two holders keep it, and the last one lets it go', async () => {
        const assets = realm({ 'hero.esmaterial': MATERIAL });
        const first = await assets.acquireTyped('material', 'materials/hero.esmaterial');
        const second = await assets.acquireTyped('material', 'materials/hero.esmaterial');

        first.release();
        expect(pool.liveTextures(), 'released while a holder was still using it').toBe(1);
        second.release();
        expect(pool.liveTextures()).toBe(0);
    });
});

describe('a material instance acquires its parent', () => {
    beforeEach(() => { pool = createPoolFake(); materialFake.reset(); });

    function instanced(): Assets {
        return realm({ 'parent.esmaterial': MATERIAL, 'child.esmaterial': CHILD_MATERIAL });
    }

    it('the parent is an owned dependency of the instance, named as a material', async () => {
        const assets = instanced();
        await assets.acquireTyped('material', 'materials/child.esmaterial');

        expect(assets.dependenciesOf('material', 'materials/child.esmaterial'))
            .toContainEqual({ kind: 'owned', type: 'material', path: 'materials/parent.esmaterial' });
    });

    it('the parent is an asset of this realm, with an era of its own', async () => {
        // Loaded by recursion it was invisible: no cache entry, no receipt, and
        // the graph stopped at the instance.
        const assets = instanced();
        await assets.acquireTyped('material', 'materials/child.esmaterial');

        expect(assets.dependenciesOf('material', 'materials/parent.esmaterial'))
            .toContainEqual({ kind: 'owned', type: 'texture', path: 'materials/wall.png' });
    });

    it('two instances of one parent share it', async () => {
        const assets = realm({
            'parent.esmaterial': MATERIAL,
            'a.esmaterial': CHILD_MATERIAL,
            'b.esmaterial': CHILD_MATERIAL,
        });
        await assets.acquireTyped('material', 'materials/a.esmaterial');
        await assets.acquireTyped('material', 'materials/b.esmaterial');

        expect(materialFake.live.size, 'the parent was built once per instance').toBe(3);
    });

    it('the last instance letting go gives the whole chain back', async () => {
        const assets = instanced();
        const first = await assets.acquireTyped('material', 'materials/child.esmaterial');
        const second = await assets.acquireTyped('material', 'materials/child.esmaterial');

        first.release();
        expect(materialFake.live.size, 'released while a holder was still using it').toBe(2);

        second.release();
        expect(materialFake.live.size).toBe(0);
        expect(pool.liveTextures(), 'the texture the PARENT bound').toBe(0);
    });
});

describe('what must be rebuilt when this changes', () => {
    beforeEach(() => { pool = createPoolFake(); materialFake.reset(); });

    it('the map that folded a .tsj in is named by the file it read', async () => {
        const assets = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        await assets.acquireTyped('tilemap', 'maps/level.tmj');

        expect(assets.dependentsOfSource('maps/terrain.tsj'))
            .toEqual([{ type: 'tilemap', path: 'maps/level.tmj' }]);
    });

    it('a texture names every era that took it, of any kind', async () => {
        const assets = realm({ 'hero.esmaterial': MATERIAL });
        await assets.acquireTyped('material', 'materials/hero.esmaterial');

        expect(assets.dependentsOfSource('materials/wall.png'))
            .toEqual([{ type: 'material', path: 'materials/hero.esmaterial' }]);
    });

    it('a composed resource names nobody', async () => {
        // Its `composed:<handle>` identity is a debug name, not a lookup key —
        // in an invalidation namespace it would collide with whatever handle
        // number a file happened to be given.
        const assets = realm({ 'level.tmj': MAP_WITH_COLLECTION });
        await assets.acquireTyped('tilemap', 'maps/level.tmj');
        const composed = assets.dependenciesOf('tilemap', 'maps/level.tmj')
            .find((e) => e.path.startsWith('composed:'))!;

        expect(assets.dependentsOfSource(composed.path)).toEqual([]);
    });

    it('a receipt spelled as a uuid answers to the file it resolves to', async () => {
        // A receipt says what the acquisition ASKED for; a change names a file.
        // Comparing the two spellings directly is how a graph misses every edge
        // a scene serialized.
        const assets = realm({});
        assets.setAssetRefResolver((ref) => (ref === '@uuid:skin' ? 'art/skin.png' : ref));
        assets.register({
            type: 'widget', extensions: ['.widget'],
            registry: {
                prepare: async (path, ctx) => {
                    await ctx.acquireTexture('@uuid:skin');
                    return { published: { path }, value: { id: path } };
                },
            },
        });
        await assets.acquireTyped('widget', 'x.widget');

        expect(assets.dependentsOfSource('art/skin.png')).toEqual([{ type: 'widget', path: 'x.widget' }]);
        expect(assets.dependentsOfSource('@uuid:skin'), 'the same asset, spelled the other way')
            .toEqual([{ type: 'widget', path: 'x.widget' }]);
    });

    it('an era that retired takes its edges with it', async () => {
        const assets = realm({ 'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET });
        const held = await assets.acquireTyped('tilemap', 'maps/level.tmj');

        held.release();
        expect(assets.dependentsOfSource('maps/terrain.tsj')).toEqual([]);
    });
});

/** Let every pending load, republish and image decode settle. */
async function settled(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('a change reaches what was built from it', () => {
    beforeEach(() => { pool = createPoolFake(); materialFake.reset(); });

    it('a map rebuilds when the tileset it folded in changes', async () => {
        // Nothing of the .tsj is held — it is not an asset, it is content the map
        // READ. Without the source edge a change to it could never reach anyone.
        const docs: Record<string, string> = {
            'level.tmj': MAP_WITH_EXTERNAL, 'terrain.tsj': EXTERNAL_TILESET,
        };
        const assets = realm(docs);
        await assets.acquireTyped('tilemap', 'maps/level.tmj');
        expect(assets.dependenciesOf('tilemap', 'maps/level.tmj'))
            .toContainEqual({ kind: 'owned', type: 'texture', path: 'maps/terrain.png' });

        docs['terrain.tsj'] = JSON.stringify({
            name: 'terrain', image: 'winter.png', columns: 2, tilecount: 4,
            tilewidth: 4, tileheight: 4,
        });
        assets.invalidate('maps/terrain.tsj');
        await settled();

        expect(assets.dependenciesOf('tilemap', 'maps/level.tmj'))
            .toContainEqual({ kind: 'owned', type: 'texture', path: 'maps/winter.png' });
        expect(pool.liveTextures(), 'the era it replaced gave its texture back').toBe(1);
    });

    /** A chain: a texture, the asset that takes it, and the asset that takes that. */
    function chain(assets: Assets, events: string[]): void {
        assets.register({
            type: 'child', extensions: ['.child'],
            registry: {
                prepare: async (path, ctx) => {
                    events.push('child:start');
                    await ctx.acquireTexture('skin.png');
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    events.push('child:end');
                    return { published: { path }, value: { id: path } };
                },
            },
        });
        assets.register({
            type: 'parent', extensions: ['.parent'],
            registry: {
                prepare: async (path, ctx) => {
                    events.push('parent:start');
                    await ctx.acquireAsset('child', 'c.child');
                    events.push('parent:end');
                    return { published: { path }, value: { id: path } };
                },
            },
        });
    }

    it('the child rebuilds before the parent that took it', async () => {
        // A parent re-prepared first would acquire the era it already had. The
        // order is the plan's, and the plan is the graph read backwards.
        const events: string[] = [];
        const assets = realm({});
        chain(assets, events);
        await assets.acquireTyped('parent', 'p.parent');
        events.length = 0;

        assets.invalidate('skin.png');
        await settled();

        expect(events).toEqual(['child:start', 'child:end', 'parent:start', 'parent:end']);
    });

    it('a cycle is a plan, not a hang', async () => {
        // `A takes B` while B READ A is a real shape. Entered at the file A lives
        // at: A rebuilds, B because it read that file, then A again because the B
        // it holds is a new era. Each vertex is planned once, so it terminates.
        const prepared: string[] = [];
        const assets = realm({ 'a.aa': '{}', 'b.bb': '{}' });
        assets.register({
            type: 'aa', extensions: ['.aa'],
            registry: {
                prepare: async (path, ctx) => {
                    prepared.push('aa');
                    await ctx.acquireAsset('bb', 'b.bb');
                    return { published: { path }, value: { id: path } };
                },
            },
        });
        assets.register({
            type: 'bb', extensions: ['.bb'],
            registry: {
                prepare: async (path, ctx) => {
                    prepared.push('bb');
                    await ctx.readSource!('a.aa');
                    return { published: { path }, value: { id: path } };
                },
            },
        });
        await assets.acquireTyped('aa', 'a.aa');
        prepared.length = 0;

        assets.invalidate('a.aa');
        await settled();

        expect(prepared).toEqual(['aa', 'bb', 'aa']);
    });
});

describe('propagation keeps the type all the way to the effect', () => {
    beforeEach(() => { pool = createPoolFake(); materialFake.reset(); });

    /** Three assets, two of them under ONE path: (aa,p) reads the file x,
     *  (bb,q) takes aa, (cc,p) takes bb. */
    function chainOverOnePath(assets: Assets, prepared: string[]): void {
        const link = (type: string, take: (ctx: LoadContext) => Promise<unknown>): void => {
            assets.register({
                type, extensions: [`.${type}`],
                registry: {
                    prepare: async (path, ctx) => {
                        prepared.push(type);
                        await take(ctx);
                        return { published: { path }, value: { id: type } };
                    },
                },
            });
        };
        link('aa', (ctx) => ctx.readSource!('x'));
        link('bb', (ctx) => ctx.acquireAsset('aa', 'p'));
        link('cc', (ctx) => ctx.acquireAsset('bb', 'q'));
    }

    it('a path that names two assets rebuilds them in the order the plan says', async () => {
        // The plan already knows (aa,p) and (cc,p) are two vertices. Ending an
        // era by PATH ends both of them at once, so cc is rebuilt against the bb
        // it already had — before bb itself has been touched.
        const assets = realm({});
        const prepared: string[] = [];
        chainOverOnePath(assets, prepared);
        await assets.acquireTyped('cc', 'p');
        expect(prepared).toEqual(['cc', 'bb', 'aa']);

        prepared.length = 0;
        assets.invalidate('x');
        await settled();

        expect(prepared).toEqual(['aa', 'bb', 'cc']);
    });

    it('an asset at the changed path is still rebuilt in its turn', async () => {
        // It was filtered out of every group for sharing the changed path, which
        // is the same type-erasure one level up: (cc,p) is not the thing that
        // changed, it is what the chain reaches last.
        const assets = realm({});
        const prepared: string[] = [];
        chainOverOnePath(assets, prepared);
        await assets.acquireTyped('cc', 'p');

        prepared.length = 0;
        assets.invalidate('p');
        await settled();

        expect(prepared.lastIndexOf('cc'), 'cc last rebuilt before bb, so from the old bb')
            .toBeGreaterThan(prepared.indexOf('bb'));
    });

    /** An asset AT p, and an asset that READ the file at p. */
    function overOnePath(assets: Assets, prepared: string[]): void {
        assets.register({
            type: 'skin', extensions: ['.skin'],
            registry: {
                prepare: async (path, ctx) => {
                    prepared.push('skin');
                    await ctx.acquireTexture('t.png');
                    return { published: { path }, value: { id: 'skin' } };
                },
            },
        });
        assets.register({
            type: 'reader', extensions: ['.reader'],
            registry: {
                prepare: async (path, ctx) => {
                    prepared.push('reader');
                    await ctx.readSource!('p');
                    return { published: { path }, value: { id: 'reader' } };
                },
            },
        });
    }

    it('an asset whose dependency changed is not a change to the FILE it lives at', async () => {
        // The reader read the bytes at p. What changed is the texture (skin,p)
        // acquired, so those bytes are exactly as it read them.
        const assets = realm({});
        const prepared: string[] = [];
        overOnePath(assets, prepared);
        await assets.acquireTyped('skin', 'p');
        await assets.acquireTyped('reader', 'q');

        prepared.length = 0;
        assets.invalidate('t.png');
        await settled();

        expect(prepared).toEqual(['skin']);
    });

    it('a change to the file itself reaches both meanings of it', async () => {
        const assets = realm({});
        const prepared: string[] = [];
        overOnePath(assets, prepared);
        await assets.acquireTyped('skin', 'p');
        await assets.acquireTyped('reader', 'q');

        prepared.length = 0;
        assets.invalidate('p');
        await settled();

        expect(prepared, 'the asset at p').toContain('skin');
        expect(prepared, 'the asset that read p').toContain('reader');
    });
});
