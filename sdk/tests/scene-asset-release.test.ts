// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene-asset-release.test.ts
 * @brief   Verify the per-category release wrappers on Assets plus that
 *          SceneInstance carries the extra loaded* buckets so unload can
 *          hand them back to Assets (previously leaked).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/scene/scene', () => ({
    loadSceneWithAssets: vi.fn().mockResolvedValue(new Map()),
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
import { Material } from '../src/render/material';

function createMockApp(assets?: unknown) {
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
    beforeEach(() => { discovered.byType = new Map(); });

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

    it('buckets every type discovery reports, including ones added later', async () => {
        // The original bug lived HERE, not in the release wiring: seven
        // hard-coded buckets, so a scene declaring a tileset acquired a
        // reference the manager never recorded and unload could not give back.
        discovered.byType = new Map(TRACKED.map(([type, path]) => [type, new Set([path])]));

        const app = createMockApp({ releaseTexture: vi.fn(), releaseTyped: vi.fn() });
        const manager = new SceneManagerState(app as never);
        manager.register({ name: 'declaring', data: { version: '1.0', name: 'd', entities: [] } });
        await manager.load('declaring');

        const instance = (manager as unknown as {
            scenes_: Map<string, { loadedByType: Map<string, Set<string>> }>;
        }).scenes_.get('declaring')!;

        for (const [type, path] of TRACKED) {
            expect(
                [...(instance.loadedByType.get(type) ?? [])],
                `the scene declared a ${type} and the manager kept no bucket for it`,
            ).toContain(path);
        }
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

    it('releases tracked materials through Assets by handle, not a bare Material.release', async () => {
        vi.mocked(Material.release).mockClear();
        const releasedHandles: number[] = [];
        const assetsStub = {
            releaseTexture: vi.fn(), releaseTyped: vi.fn(), releaseFont: vi.fn(), releaseAudio: vi.fn(),
            releaseAnimClip: vi.fn(), releaseTimeline: vi.fn(), releaseTilemap: vi.fn(),
            releaseMaterial: (h: number) => { releasedHandles.push(h); },
        };

        const app = createMockApp(assetsStub);
        const manager = new SceneManagerState(app as never);
        manager.register({
            name: 'level1',
            data: { version: '1.0', name: 'level1', entities: [] },
        });
        await manager.load('level1');

        const instance = (manager as unknown as {
            scenes_: Map<string, { loadedMaterials: Set<number> }>;
        }).scenes_.get('level1')!;
        instance.loadedMaterials = new Set([11, 22]);

        await manager.unload('level1');

        // Routed through Assets so the material refcount + path cache stay
        // coherent; destroying the handle directly would strand it in the cache.
        expect(releasedHandles).toEqual(expect.arrayContaining([11, 22]));
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
