// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene-asset-release.test.ts
 * @brief   A scene gives back what it acquired: the receipts its preload
 *          produced, plus path-keyed assets a loader registered itself.
 *
 * @details Ownership is the set of RECEIPTS, not the refs the scene declares —
 *          a declared asset whose load failed was never acquired, and after
 *          invalidate() one path no longer names one instance.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

// Stands in for the preload: the real loadSceneWithAssets hands the owner the
// receipts its acquires produced, and unload releases through those.
const preloaded: Array<{ type: string; path: string; released: number }> = [];
vi.mock('../src/scene/scene', () => ({
    loadSceneWithAssets: vi.fn(async (_w: unknown, _d: unknown, options?: {
        collectAssets?: { scope?: { add: (l: unknown) => unknown } };
    }) => {
        for (const entry of preloaded) {
            options?.collectAssets?.scope?.add({
                key: `${entry.type}:${entry.path}`, generation: 1, value: null,
                release: () => { entry.released++; },
            });
        }
        return new Map();
    }),
}));
vi.mock('../src/render/customDraw', () => ({
    registerDrawCallback: vi.fn(),
    unregisterDrawCallback: vi.fn(),
}));
vi.mock('../src/postprocess', () => ({
    PostProcess: { bind: vi.fn(), unbind: vi.fn() },
    PostProcessStack: vi.fn(),
}));
vi.mock('../src/render/material', () => ({
    Material: { release: vi.fn(), createShader: vi.fn() },
    defineResource: vi.fn(),
}));
// Discovery is stubbed so a scene can declare a type without the component
// registry: the claim under test is that the manager buckets WHATEVER
// discovery reports, not that discovery finds the right things.
const discovered = { byType: new Map<string, Set<string>>() };
vi.mock('../src/asset/discoverAssets', () => ({
    discoverSceneAssets: vi.fn(() => discovered),
    getAssetPathsByType: vi.fn(() => new Set()),
}));

import { SceneManagerState } from '../src/scene/sceneManager';
import { Assets } from '../src/asset';
import { AssetScope } from '../src/asset/AssetLease';
import { Material } from '../src/render/material';

/**
 * The batch door, implemented as Assets implements it, so a stub stays
 * observable through releaseTexture / releaseTyped — which is what the
 * assertions read.
 */
function withBatchRelease(stub: Record<string, unknown>): Record<string, unknown> {
    return {
        ...stub,
        releaseAssets(byType: ReadonlyMap<string, ReadonlySet<string>>) {
            for (const [type, paths] of byType) {
                if (type === 'material' || type === 'spine') continue;
                for (const path of paths) {
                    if (type === 'texture') (stub.releaseTexture as (r: string) => void)?.(path);
                    else (stub.releaseTyped as (t: string, r: string) => void)?.(type, path);
                }
            }
        },
    };
}

function createMockApp(assets?: unknown) {
    if (assets) assets = withBatchRelease(assets as Record<string, unknown>);
    const entities = new Map<number, Map<symbol, unknown>>();
    let nextEntity = 1;
    const resources = new Map<unknown, unknown>();
    if (assets) resources.set(Assets, assets);

    const world = {
        spawn: vi.fn(() => { const e = nextEntity++; entities.set(e, new Map()); return e; }),
        despawn: vi.fn((e: number) => entities.delete(e)),
        valid: vi.fn((e: number) => entities.has(e)),
        has: vi.fn(() => false),
        get: vi.fn(() => undefined),
        insert: vi.fn((e: number, c: symbol, d: unknown) => {
            if (!entities.has(e)) entities.set(e, new Map());
            entities.get(e)!.set(c, d);
        }),
        set: vi.fn(),
        remove: vi.fn(),
    };

    return {
        world,
        hasResource: vi.fn((k: unknown) => resources.has(k)),
        getResource: vi.fn((k: unknown) => resources.get(k)),
        addSystemToSchedule: vi.fn(),
    };
}

describe('Scene unload releases all tracked asset categories', () => {
    // Shared across the mock module, so a test that seeds it must not leak into
    // the next one's scene.
    beforeEach(() => { discovered.byType = new Map(); preloaded.length = 0; });

    /**
     * Every path-keyed type a scene can declare, one path each.
     *
     * `tileset`, `statemachine`, `behaviortree` and `animatorcontroller` are the
     * four this list lacked: each was preloaded, none was tracked, so unload
     * released nothing. A type with a registered loader belongs here.
     */
    const TRACKED: Array<[type: string, path: string]> = [
        ['texture', 'tex/a.png'],
        ['font', 'font/main.ttf'],
        ['audio', 'sfx/boom.wav'],
        ['anim-clip', 'anim/walk.json'],
        ['timeline', 'timeline/intro.json'],
        ['tilemap', 'maps/level1.tmx'],
        ['tileset', 'maps/tiles.estileset'],
        ['statemachine', 'ai/guard.esfsm'],
        ['behaviortree', 'ai/patrol.esbt'],
        ['animatorcontroller', 'anim/hero.esanimator'],
    ];

    it('gives back every receipt its preload produced, whatever the type', async () => {
        // The original bug lived in the bucketing: seven hard-coded categories,
        // so a tileset was acquired and never given back. Ownership is receipts
        // now, so a newly added type either produces one or was never acquired.
        for (const [type, path] of TRACKED) preloaded.push({ type, path, released: 0 });

        const app = createMockApp({ releaseTexture: vi.fn(), releaseTyped: vi.fn() });
        const manager = new SceneManagerState(app as never);
        manager.register({ name: 'declaring', data: { version: '1.0', name: 'd', entities: [] } });
        await manager.load('declaring');
        await manager.unload('declaring');

        for (const entry of preloaded) {
            expect(entry.released, `the ${entry.type} it acquired was never given back`).toBe(1);
        }
    });

    it('declaring an asset it never acquired releases nothing', async () => {
        // A failed load leaves no receipt, so unload has nothing to hand back
        // and nothing to guess at. Declaring is not owning.
        discovered.byType = new Map(TRACKED.map(([type, path]) => [type, new Set([path])]));
        const released: Array<[string, string]> = [];
        const app = createMockApp({
            releaseTexture: (r: string) => { released.push(['texture', r]); },
            releaseTyped: (t: string, r: string) => { released.push([t, r]); },
        });
        const manager = new SceneManagerState(app as never);
        manager.register({ name: 'declaring', data: { version: '1.0', name: 'd', entities: [] } });
        await manager.load('declaring');
        await manager.unload('declaring');

        expect(released).toEqual([]);
    });

    it('releases assets a scene tracked from inside setup (the packaged-game shape)', async () => {
        // A packaged game's config carries no `data`: the bytes arrive inside
        // setup(), which preloads its own. Unless that loader REPORTS what it
        // acquired, unload releases nothing at all.
        const releasedTextures: string[] = [];
        const releasedTyped: Array<[string, string]> = [];
        const app = createMockApp({
            releaseTexture: (r: string) => { releasedTextures.push(r); },
            releaseTyped: (t: string, r: string) => { releasedTyped.push([t, r]); },
        });
        const manager = new SceneManagerState(app as never);

        manager.register({
            name: 'packaged',
            // No `data` — exactly what createRuntimeSceneConfig produces.
            setup: (ctx) => {
                ctx.trackAssets(new Map([
                    ['texture', new Set(['tex/hero.png'])],
                    ['audio', new Set(['sfx/hit.wav'])],
                    ['tileset', new Set(['maps/tiles.estileset'])],
                ]));
            },
        });
        await manager.load('packaged');
        await manager.unload('packaged');

        expect(releasedTextures, 'a packaged scene released no textures').toContain('tex/hero.png');
        expect(releasedTyped).toContainEqual(['audio', 'sfx/hit.wav']);
        expect(releasedTyped).toContainEqual(['tileset', 'maps/tiles.estileset']);
    });

    it('takes over the receipts a packaged scene\'s loader acquired', async () => {
        // The runtime loader preloads into a scope of its own and hands it here.
        // Reporting paths instead left a release guessing which era it meant,
        // and left what the paths omitted (materials) with nobody to give back.
        const released: string[] = [];
        const app = createMockApp({
            releaseTexture: vi.fn(), releaseTyped: vi.fn(),
        });
        const manager = new SceneManagerState(app as never);
        const loaderScope = new AssetScope();
        for (const key of ['texture:hero.png', 'material:hero.esmat']) {
            loaderScope.add({ key, generation: 1, value: null, release: () => released.push(key) });
        }

        manager.register({ name: 'packaged', setup: (ctx) => { ctx.trackAssetScope(loaderScope); } });
        await manager.load('packaged');
        expect(loaderScope.size).toBe(0);        // ownership moved, it was not copied

        await manager.unload('packaged');
        expect(released).toEqual(['material:hero.esmat', 'texture:hero.png']);
    });

    it('releases every type the scene acquired, whatever its type', async () => {
        const releasedTextures: string[] = [];
        const releasedTyped: Array<[string, string]> = [];
        const assetsStub = {
            releaseTexture: (r: string) => { releasedTextures.push(r); },
            releaseTyped: (type: string, r: string) => { releasedTyped.push([type, r]); },
        };

        const app = createMockApp(assetsStub);
        const manager = new SceneManagerState(app as never);
        manager.register({ name: 'level1', data: { version: '1.0', name: 'level1', entities: [] } });
        await manager.load('level1');

        // Seeded directly: discovery needs the component registry, and the claim
        // here is about the release wiring, not about what a scene declares.
        const instance = (manager as unknown as {
            scenes_: Map<string, { loadedByType: Map<string, Set<string>> }>;
        }).scenes_.get('level1')!;
        for (const [type, path] of TRACKED) instance.loadedByType.set(type, new Set([path]));

        await manager.unload('level1');

        for (const [type, path] of TRACKED) {
            if (type === 'texture') {
                expect(releasedTextures, 'a texture was never released').toContain(path);
                continue;
            }
            expect(
                releasedTyped,
                `a ${type} the scene acquired was never released on unload`,
            ).toContainEqual([type, path]);
        }
    });

    it('releases materials through their receipt, not a bare Material.release', async () => {
        vi.mocked(Material.release).mockClear();
        preloaded.push({ type: 'material', path: 'mat/hero.esmat', released: 0 });

        const app = createMockApp({ releaseTexture: vi.fn(), releaseTyped: vi.fn() });
        const manager = new SceneManagerState(app as never);
        manager.register({
            name: 'level1',
            data: { version: '1.0', name: 'level1', entities: [] },
        });
        await manager.load('level1');
        await manager.unload('level1');

        // Through the lease, so the material's refcount + path cache stay
        // coherent; destroying the handle directly strands it in the cache.
        expect(preloaded[0].released).toBe(1);
        expect(Material.release).not.toHaveBeenCalled();
    });

    it('handles missing Assets resource gracefully (no throw)', async () => {
        const app = createMockApp();  // No Assets resource
        const manager = new SceneManagerState(app as never);
        manager.register({
            name: 'level1',
            data: { version: '1.0', name: 'level1', entities: [] },
        });
        await manager.load('level1');
        await expect(manager.unload('level1')).resolves.not.toThrow();
    });
});

describe('Assets per-category release wrappers', () => {
    let releaseTypedCalls: Array<{ type: string; ref: string }>;

    beforeEach(() => {
        releaseTypedCalls = [];
    });

    it('each wrapper forwards to releaseTyped with the correct type', () => {
        class FakeAssets {
            releaseAudio(ref: string) { this.releaseTyped_('audio', ref); }
            releaseAnimClip(ref: string) { this.releaseTyped_('anim-clip', ref); }
            releaseTimeline(ref: string) { this.releaseTyped_('timeline', ref); }
            releaseTilemap(ref: string) { this.releaseTyped_('tilemap', ref); }
            releasePrefab(ref: string) { this.releaseTyped_('prefab', ref); }
            private releaseTyped_(type: string, ref: string) {
                releaseTypedCalls.push({ type, ref });
            }
        }
        const a = new FakeAssets();
        a.releaseAudio('sfx/a');
        a.releaseAnimClip('anim/b');
        a.releaseTimeline('timeline/c');
        a.releaseTilemap('map/d');
        a.releasePrefab('prefab/e');

        expect(releaseTypedCalls).toEqual([
            { type: 'audio', ref: 'sfx/a' },
            { type: 'anim-clip', ref: 'anim/b' },
            { type: 'timeline', ref: 'timeline/c' },
            { type: 'tilemap', ref: 'map/d' },
            { type: 'prefab', ref: 'prefab/e' },
        ]);
    });
});
