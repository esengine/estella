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
import { Assets, type AssetsOptions } from '../src/asset/Assets';
import { App } from '../src/app/app';
import { SceneManager, SceneManagerState } from '../src/scene/sceneManager';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { AssetScope } from '../src/asset/AssetLease';
import { EntityAssetScopes } from '../src/asset/entityAssetScopes';
import { SpriteAnimation, SpriteAnimationAPI, SpriteAnimator, type SpriteAnimClip } from '../src/animation/SpriteAnimator';
import { Animator } from '../src/animation/Animator';
import { loadSceneWithAssets, serializeScene } from '../src/scene/scene';
import { spawnPrepared } from '../src/prefab/preparedPrefab';
import { AnimationPlugin } from '../src/animation/AnimationPlugin';
import { SkeletalAnimationPlugin } from '../src/animation/SkeletalAnimationPlugin';
import { AnimatorControllerAssetLoader } from '../src/asset/loaders/AnimatorControllerAssetLoader';
import { AvatarAssetLoader } from '../src/asset/loaders/AvatarAssetLoader';
import { connectFakeCpp } from './helpers/fakeEngine';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { defineComponent, markEngineComponentBaseline, seedEngineComponents, Sprite } from '../src/ecs/component';
import type { Entity } from '../src/types';
import type { Backend } from '../src/asset/Backend';
import { atlasCatalogFields, Catalog } from '../src/asset/Catalog';
import type { AddressableManifest, AddressableManifestAsset } from '../src/asset/AddressableManifest';
import { catalogForModel, indexPackagedManifest } from '../src/runtime/packagedRuntime';

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
    isPlatformInitialized: () => false,
    platformNow: () => performance.now(),
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

function buildAssets(sprites: SpriteAnimationAPI, doc: (path: string) => string, options: Pick<AssetsOptions, 'catalog' | 'activateManifest'> = {}) {
    const assets = Assets.create({
        ...options,
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async (path: string) => doc(path)),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
        getSpriteAnimation: () => sprites,
    } as never);
    // What AnimationPlugin wires: a clip loaded from a `.esanim` comes from this
    // app's realm, and `getClip` is where the two halves meet.
    sprites.useAssetClips((ref) => assets.resolveRegistryAsset<SpriteAnimClip>('anim-clip', ref));
    return assets;
}

// What an SDK entry does at load, and what the shared test setup then clears
// before every test: the engine's own `defineComponent`s (SpriteAnimator among
// them) live in the context registry, which is what a reflective walk reads.
markEngineComponentBaseline();

describe('a persistent entity carries a ref-bound asset out of its scene', () => {
    beforeEach(() => { pool = createPoolFake(); seedEngineComponents(); });

    it('keeps a path-tracked clip and its frame textures on a sprite after reset', async () => {
        const app = App.new(), sprites = new SpriteAnimationAPI();
        const assets = buildAssets(sprites, () => clipDocument(12));
        const manager = new SceneManagerState(app), path = 'walk.esanim';
        app.insertResource(AssetsResource, assets);
        manager.register({ name: 'level', async setup(ctx) {
            await assets.loadAnimClip(path);
            ctx.trackAssets(new Map([['anim-clip', new Set([path])]]));
            app.world.insert(ctx.spawn(), SpriteAnimator, { clip: path });
        } });
        try {
            const ctx = await manager.load('level'), [sprite] = ctx.entities;
            manager.reset();
            expect(sprites.getClip(path)?.fps).toBe(12);
            expect(assets.sizes()).toMatchObject({ registrySlots: 1, refRows: 2 });
            app.world.despawn(sprite!);
            expect(sprites.getClip(path)).toBeUndefined();
            expect(assets.sizes()).toMatchObject({ registrySlots: 0, refRows: 0 });
            expect(pool.releaseTexture).toHaveBeenCalledTimes(2);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['shared name', 'UUID for a path acquisition'])('keeps the sprite clip for a %s', async mode => {
        const app = App.new(), sprites = new SpriteAnimationAPI();
        connectFakeCpp(app.world);
        const assets = buildAssets(sprites, () => JSON.stringify({ fps: 12, frames: [], joints: { hip: 'Rig/Hip' } }));
        const manager = new SceneManagerState(app);
        app.insertResource(AssetsResource, assets);
        assets.register(new AvatarAssetLoader());
        const path = 'assets/character.json';
        const ref = mode === 'shared name' ? path : '@uuid:e85e5e12-93bf-4eab-93c7-88db872b7581';
        assets.setAssetRefResolver(name => name === ref ? path : name);
        let entity!: Entity;
        manager.register({ name: 'level', setup: async ctx => {
            const scope = new AssetScope();
            scope.add(await assets.acquireTyped('avatar', path));
            scope.add(await assets.acquireTyped('anim-clip', path));
            ctx.trackAssetScope(scope);
            entity = ctx.spawn();
            app.world.insert(entity, SpriteAnimator, { clip: ref });
            ctx.setPersistent(entity, true);
        } });
        await manager.load('level');
        expect(sprites.getClip(ref)?.fps).toBe(12);
        await manager.unload('level');
        expect(sprites.getClip(ref)?.fps).toBe(12);
        expect(assets.resolveRegistryAsset('avatar', path)).toBeUndefined();
        app.world.despawn(entity);
        expect(assets.sizes().registrySlots).toBe(0);
    });

    it('retires a persistent entity’s clip and avatar when their last live fields change', async () => {
        const app = App.new(), sprites = new SpriteAnimationAPI(), manager = new SceneManagerState(app);
        connectFakeCpp(app.world);
        const assets = buildAssets(sprites, path => path.endsWith('.esavatar')
            ? JSON.stringify({ joints: { hip: 'Rig/Hip' } }) : clipDocument(12));
        assets.register(new AvatarAssetLoader());
        app.insertResource(AssetsResource, assets);
        const clip = 'anim/walk.esanim', avatar = 'rig/hero.esavatar';
        const alias = '@uuid:e85e5e12-93bf-4eab-93c7-88db872b7581';
        assets.setAssetRefResolver(ref => ref === alias ? clip : ref);
        const preview = defineComponent('ClipPreview', { clip: '' }, { assetFields: [{ field: 'clip', type: 'anim-clip' }] });
        let actor!: Entity;
        manager.register({ name: 'rigs', async setup(ctx) {
            const scope = new AssetScope();
            scope.add(await assets.acquireTyped('anim-clip', clip));
            scope.add(await assets.acquireTyped('avatar', avatar));
            ctx.trackAssetScope(scope);
            actor = ctx.spawn();
            app.world.insert(actor, SpriteAnimator, { clip });
            app.world.insert(actor, preview, { clip: alias });
            app.world.insert(actor, Animator, { avatar });
            ctx.setPersistent(actor, true);
        } });
        try {
            await manager.load('rigs');
            await manager.unload('rigs');
            app.world.remove(actor, SpriteAnimator);
            await Promise.resolve();
            expect(sprites.getClip(alias)?.fps).toBe(12);
            app.world.update(actor, preview, data => { data.clip = ''; });
            await Promise.resolve();
            expect(sprites.getClip(clip)).toBeUndefined();
            expect(pool.releaseTexture).toHaveBeenCalledTimes(2);
            expect(assets.resolveRegistryAsset('avatar', avatar)).toBeDefined();
            app.world.remove(actor, Animator);
            await Promise.resolve();
            expect(assets.sizes()).toMatchObject({ registrySlots: 0, refRows: 0 });
            expect(app.world.valid(actor)).toBe(true);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('a persistent sprite retains the clip its remapped UUID currently names', async () => {
        const app = App.new();
        const sprites = new SpriteAnimationAPI();
        const assets = buildAssets(sprites, path => clipDocument(path.endsWith('new.esanim') ? 12 : 6));
        const manager = new SceneManagerState(app);
        app.insertResource(AssetsResource, assets as never);
        app.insertResource(SceneManager, manager);
        const ref = '@uuid:e85e5e12-93bf-4eab-93c7-88db872b7581';
        let target = 'anim/old.esanim', entity = 0 as Entity;
        assets.setAssetRefResolver(name => name === ref ? target : name);
        manager.register({ name: 'rigs', setup: async ctx => {
            const scope = new AssetScope();
            scope.add(await assets.acquireTyped('anim-clip', ref));
            target = 'anim/new.esanim';
            scope.add(await assets.acquireTyped('anim-clip', ref));
            ctx.trackAssetScope(scope);
            entity = ctx.spawn();
            app.world.insert(entity, SpriteAnimator, { clip: ref } as never);
            ctx.setPersistent(entity, true);
        } });
        await manager.loadAdditive('rigs');
        expect(sprites.getClip(ref)?.fps).toBe(12);
        await manager.unload('rigs');
        expect(sprites.getClip(ref)?.fps).toBe(12);
        expect(sprites.getClip('anim/old.esanim')).toBeUndefined();
        target = 'anim/latest.esanim';
        const latest = await assets.acquireTyped('anim-clip', ref);
        app.world.update(entity, SpriteAnimator, data => { data.clip = ref; });
        await Promise.resolve();
        expect(sprites.getClip('anim/new.esanim')).toBeUndefined();
        expect(sprites.getClip(ref)?.fps).toBe(6);
        app.world.despawn(entity);
        latest.release();
        expect(assets.sizes().registrySlots).toBe(0);
    });

    it.skipIf(!HAS_WASM).each(['standalone scene', 'prepared prefab', 'standalone scope'])('settles named assets independently for two live instances of a %s', async publication => {
        const core = await loadWasmModule(), app = App.new(), sprites = new SpriteAnimationAPI();
        app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
        const clip = 'anim/walk.esanim', avatar = 'rig/hero.esavatar', ref = '@uuid:6893953c-e46d-4447-9066-5efb69798824';
        const preview = defineComponent('ClipPreview', { clip: '' }, { assetFields: [{ field: 'clip', type: 'anim-clip' }] });
        const components = [{ type: 'SpriteAnimator', data: { clip: ref } }, { type: preview._name, data: { clip } },
            { type: 'Animator', data: { avatar } }];
        const actor = { name: 'Actor', parent: null, children: [], visible: true, components };
        const assets = buildAssets(sprites, path => {
            if (path.endsWith('.esprefab')) return JSON.stringify({ version: '2', name: 'Actor', rootEntityId: 'actor',
                entities: [{ prefabEntityId: 'actor', ...actor }] });
            if (path.endsWith('.esavatar')) return JSON.stringify({ joints: { hip: 'Rig/Hip' } });
            return clipDocument(12);
        });
        assets.setAssetRefResolver(name => name === ref ? clip : name);
        assets.register(new AvatarAssetLoader());
        const world = app.world;
        try {
            let first: Entity, second: Entity;
            if (publication === 'standalone scope') vi.spyOn(assets, 'entityScopes', 'get').mockReturnValue(new EntityAssetScopes());
            if (publication === 'prepared prefab') {
                const recipe = await assets.preparePrefab('actor.esprefab');
                try { first = spawnPrepared(world, recipe).root; second = spawnPrepared(world, recipe).root; }
                finally { recipe.release(); }
            } else {
                const scene = await loadSceneWithAssets(world, { version: '1.0', name: 'Actors',
                    entities: [{ id: 1, ...actor }, { id: 2, ...actor }] }, { assets, abortOnMissingAssets: true });
                first = scene.get(1)!; second = scene.get(2)!;
            }
            const owner = assets.entityScopes.scopeFor(first, world)!;
            const manual = owner.add(await assets.acquireTyped('avatar', avatar));
            world.remove(first, SpriteAnimator);
            world.remove(first, preview);
            world.remove(first, Animator);
            world.update(second, SpriteAnimator, data => { data.clip = ''; });
            world.update(second, SpriteAnimator, data => { data.clip = clip; });
            await Promise.resolve();
            expect(owner.leases()).toEqual([manual]);
            expect(sprites.getClip(ref)?.frames).toHaveLength(2);
            world.remove(second, SpriteAnimator);
            world.remove(second, preview);
            world.remove(second, Animator);
            await Promise.resolve();
            expect(sprites.getClip(clip)).toBeUndefined();
            expect(pool.releaseTexture).toHaveBeenCalledTimes(2);
            expect(assets.entityScopes.scopeFor(second, world)?.size).toBe(0);
            expect(assets.resolveRegistryAsset('avatar', avatar)).toBeDefined();
            expect(world.valid(first) && world.valid(second)).toBe(true);
            owner.releaseAll();
            expect(assets.sizes()).toMatchObject({ registrySlots: 0, refRows: 0 });
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['indexed', 'legacy'])('keeps a discovered dependency shared with a field using %s ownership metadata', async mode => {
        const app = App.new(), sprites = new SpriteAnimationAPI();
        connectFakeCpp(app.world);
        const assets = buildAssets(sprites, () => clipDocument(6));
        if (mode === 'legacy') {
            const preload = assets.preloadSceneAssets.bind(assets);
            vi.spyOn(assets, 'preloadSceneAssets').mockImplementation(async (...args) => {
                const result = await preload(...args);
                return { ...result, acquisitions: result.acquisitions?.map(({ auxiliaryEntityIds, ...receipt }) => receipt) };
            });
        }
        const clip = 'anim/look.esanim', alias = '@uuid:513837ff-8bb1-478e-adc5-a746a42a247c';
        assets.setAssetRefResolver(ref => ref === alias ? clip : ref);
        const previews = defineComponent('PreviewLibrary', { clips: [] as string[] }, {
            discoverAssets: data => (data.clips as string[]).map(path => ({ type: 'anim-clip', path })),
        });
        try {
            const scene = await loadSceneWithAssets(app.world, { version: '1.0', name: 'Library',
                entities: [{ id: 1, name: 'Actor', parent: null, children: [], components: [
                    { type: 'SpriteAnimator', data: { clip } }, { type: previews._name, data: { clips: [alias] } },
                ] }] }, { assets, abortOnMissingAssets: true });
            const entity = scene.get(1)!;
            expect(assets.entityScopes.scopeFor(entity, app.world)?.size).toBe(1);
            app.world.remove(entity, SpriteAnimator);
            await Promise.resolve();
            expect(sprites.getClip(alias)?.fps).toBe(6);
            app.world.despawn(entity);
            expect(assets.sizes()).toMatchObject({ registrySlots: 0, refRows: 0 });
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('releases a named field removed by an insertion observer before scene ownership attaches', async () => {
        const app = App.new(), sprites = new SpriteAnimationAPI();
        connectFakeCpp(app.world);
        const assets = buildAssets(sprites, () => clipDocument(4)), clip = 'anim/spawn.esanim';
        const off = app.world.onAssetFieldsChanged((entity, component) => {
            if (component === SpriteAnimator && app.world.has(entity, SpriteAnimator)) app.world.remove(entity, SpriteAnimator);
        });
        try {
            const loaded = await loadSceneWithAssets(app.world, { version: '1.0', name: 'Spawn',
                entities: [{ id: 1, name: 'Actor', parent: null, children: [], components: [
                    { type: 'SpriteAnimator', data: { clip } },
                ] }] }, { assets, abortOnMissingAssets: true });
            const actor = loaded.get(1)!;
            expect(app.world.valid(actor)).toBe(true);
            expect(app.world.has(actor, SpriteAnimator)).toBe(false);
            expect(sprites.getClip(clip)).toBeUndefined();
            expect(assets.sizes()).toMatchObject({ registrySlots: 0, refRows: 0 });
        } finally { off(); assets.releaseAll(); app.quit(); }
    });

    it('the slot survives the scene, and ends with the entity', async () => {
        // The half the last round left out: a promotion matched bindings by
        // VALUE, and a field naming an asset by ref has no handle to match. It
        // names the slot, and the slot's own names say which one.
        const sprites = new SpriteAnimationAPI();
        const assets = buildAssets(sprites, () => clipDocument(1));
        const app = App.new();
        connectFakeCpp(app.world);
        const manager = new SceneManagerState(app);
        app.insertResource(AssetsResource, assets as never);
        app.insertResource(SceneManager, manager);
        const base = assets.sizes().refRows;
        let e = 0 as Entity;

        manager.register({
            name: 'level',
            setup: async (ctx) => {
                const scope = new AssetScope();
                scope.add(await assets.acquireTyped('anim-clip', 'anim/walk.esanim'));
                ctx.trackAssetScope(scope);
                e = ctx.spawn();
                app.world.insert(e, SpriteAnimator, { clip: 'anim/walk.esanim' } as never);
                ctx.setPersistent(e, true);
            },
        });
        await manager.loadAdditive('level');
        await manager.unload('level');

        expect(app.world.valid(e)).toBe(true);
        expect(sprites.getClip('anim/walk.esanim'), 'the scene took the clip with it').toBeDefined();
        expect(assets.sizes().registrySlots).toBe(1);
        expect(assets.sizes().refRows, 'the era it is reading is still owned').toBe(base + 2);

        app.world.despawn(e);
        expect(sprites.getClip('anim/walk.esanim')).toBeUndefined();
        expect(assets.sizes().registrySlots).toBe(0);
        expect(assets.sizes().refRows).toBe(base);
    });
});

describe('a registry-backed asset lives as long as it is held', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it.each([
        { setup: 'Animator alone', hasSprite: false, hasPlayer: false },
        { setup: 'a visible sprite', hasSprite: true, hasPlayer: false },
        { setup: 'an existing standalone player', hasSprite: true, hasPlayer: true },
    ])('plays and auto-advances controller-only clips on $setup', async ({ hasSprite, hasPlayer }) => {
        const controller = 'assets/intro/logo.esanimator';
        const nextRef = '@uuid:12345678-1234-4234-8234-123456789abc';
        const graph = {
            initialState: 'Nexon', parameters: [], states: [
                { name: 'Nexon', motion: { kind: 'sprite', clip: 'nexon.esanim' },
                    transitions: [{ to: 'Wizet', conditions: [], hasExitTime: true }] },
                { name: 'Wizet', motion: { kind: 'sprite', clip: nextRef }, transitions: [] },
            ],
        };
        const assets = buildAssets(new SpriteAnimationAPI(), path => {
            if (path.endsWith('.esanimator')) return JSON.stringify(graph);
            const first = path.endsWith('assets/intro/nexon.esanim');
            if (!first && !path.endsWith('assets/intro/wizet.esanim')) throw new Error('Unexpected asset ' + path);
            const frames = first ? 34 : 4;
            return JSON.stringify({
                fps: 6, loop: !first, frames: Array.from({ length: frames }, (_, cell) => ({ cell })),
                events: Array.from({ length: frames }, (_, frame) => ({ frame, name: first ? 'Nexon' : 'Wizet' })),
                sheet: { texture: first ? 'nexon.png' : 'wizet.png', cellWidth: 8, cellHeight: 8,
                    pageWidth: frames * 8, pageHeight: 8 },
            });
        });
        assets.setAssetRefResolver(ref => ref === nextRef ? 'assets/intro/wizet.esanim' : ref);
        assets.register(new AnimatorControllerAssetLoader());
        const app = App.new();
        connectFakeCpp(app.world);
        app.insertResource(AssetsResource, assets as never);
        app.addPlugin(new AnimationPlugin());
        app.addPlugin(new SkeletalAnimationPlugin());
        const entities = await loadSceneWithAssets(app.world, {
            version: '1.0', name: 'Intro', entities: [{ id: 1, name: 'Logo', parent: null, children: [],
                components: [
                    { type: 'Animator', data: { controller } },
                    ...(hasSprite ? [{ type: 'Sprite', data: {} }] : []),
                    ...(hasPlayer ? [{ type: 'SpriteAnimator', data: {} }] : []),
                ] }],
        }, { assets, abortOnMissingAssets: true });
        const actor = entities.get(1)!;

        const events: Record<string, number[]> = { Nexon: [], Wizet: [] };
        const visible = new Map([['Nexon', new Set<number>()], ['Wizet', new Set<number>()]]);
        app.getResource(SpriteAnimation).onEvent(actor, event => events[event.name]!.push(event.frame));
        let switchedAt = 0;
        for (let tick = 1; tick <= 420; tick++) {
            await app.tick(1 / 60);
            const state = app.world.get(actor, Animator).currentState;
            if (state === 'Wizet' && !switchedAt) switchedAt = tick;
            if (hasSprite) visible.get(state)!.add(app.world.get(actor, Sprite).uvOffset.x);
        }
        expect(switchedAt).toBe(341);
        expect(events.Nexon).toEqual(Array.from({ length: 34 }, (_, i) => i));
        expect(events.Wizet!.slice(0, 5)).toEqual([0, 1, 2, 3, 0]);
        if (hasSprite) {
            expect(visible.get('Nexon')!.size).toBe(34);
            expect(visible.get('Wizet')!.size).toBe(4);
            expect(app.world.get(actor, Sprite).texture).toBeGreaterThan(0);
        }
        expect(app.world.has(actor, SpriteAnimator)).toBe(hasPlayer);
        expect(app.world.has(actor, Sprite)).toBe(hasSprite);
        const saved = serializeScene(app.world).entities.find(entity => entity.id === actor)!;
        expect(saved.components.map(component => component.type)).not.toContain('AnimatorSpritePlayback');
        expect(saved.components.some(component => component.type === 'SpriteAnimator')).toBe(hasPlayer);
        app.world.despawn(actor);
        expect(assets.resolveRegistryAsset('anim-clip', nextRef)).toBeUndefined();
    });

    it('uses each clip’s authored directory and frame geometry when clips and textures share cooked files', async () => {
        const record = (type: AddressableManifestAsset['type'], address: string, path: string): AddressableManifestAsset =>
            ({ type, address, path, size: 8, labels: [] });
        const records: Record<string, AddressableManifestAsset> = {};
        for (const [i, dir] of ['red', 'blue'].entries()) {
            records[dir] = record('anim-clip', `assets/${dir}/walk.esanim`, 'packed/clip.esanim');
            records[`${dir}-grid`] = {
                ...record('texture', `assets/${dir}/grid.png`, 'packed/page.png'),
                metadata: { atlasFrame: { x: i * 4, y: 0, width: 4, height: 4 }, atlasPageWidth: 8, atlasPageHeight: 8 },
            };
        }
        const manifest: AddressableManifest = { version: '2.0', groups: { main: { bundleMode: 'local', labels: [], assets: records } } };
        const index = indexPackagedManifest(manifest);
        const doc = JSON.stringify({
            frameSizing: 'frame', sheet: { texture: 'grid.png', cellWidth: 2, cellHeight: 2, pageWidth: 4, pageHeight: 4 },
            frames: [{ cell: 3 }, { texture: './grid.png', offset: { x: 1, y: 0 } }, {
                texture: 'grid.png', atlasFrame: { x: 2, y: 0, width: 2, height: 1, pageWidth: 4, pageHeight: 4 },
            }],
        });
        const next = structuredClone(manifest);
        next.groups.main.assets['blue-grid'].metadata!.atlasFrame!.y = 4;
        const sprites = new SpriteAnimationAPI();
        const assets = buildAssets(sprites, path => path.endsWith('update.json') ? JSON.stringify(next) : doc, {
            activateManifest: model => model && catalogForModel(model) || Catalog.empty(),
        });
        assets.setManifest(manifest);
        assets.setAssetRefResolver(index.resolvePath);
        try {
            const leases = await Promise.all(['red', 'blue'].map(ref => assets.acquireTyped('anim-clip', ref)));
            const expected = (x: number) => [
                { size: { x: 2, y: 2 }, uvOffset: { x: x + 0.25, y: 0.5 }, uvScale: { x: 0.25, y: 0.25 } },
                { size: { x: 4, y: 4 }, pivot: { x: 0.25, y: 0.5 }, uvOffset: { x, y: 0.5 }, uvScale: { x: 0.5, y: 0.5 } },
                { size: { x: 2, y: 1 }, uvOffset: { x: x + 0.25, y: 0.875 }, uvScale: { x: 0.25, y: 0.125 } },
            ];
            expect(sprites.getClip('red')?.frames).toMatchObject(expected(0));
            expect(sprites.getClip('blue')?.frames).toMatchObject(expected(0.5));
            const page = sprites.getClip('red')!.frames[0].texture;
            expect(page).toBeGreaterThan(0);
            expect(sprites.getClip('blue')!.frames.every(f => f.texture === page)).toBe(true);
            expect(pool.createTexture).toHaveBeenCalledTimes(1);
            leases[0].release();
            expect(sprites.getClip('red')).toBeUndefined();
            expect(sprites.getClip('blue')?.frames[1].texture).toBe(page);
            const plan = await assets.checkForUpdate({ manifestUrl: 'update.json' });
            expect(plan.downloadFiles).toHaveLength(0);
            expect((await assets.applyUpdate()).ok).toBe(true);
            expect(sprites.getClip('blue')?.frames[1].uvOffset).toEqual({ x: 0.5, y: 0 });
            leases[1].release();
            expect(assets.sizes()).toMatchObject({ registrySlots: 0, refRows: 0 });
        } finally { assets.releaseAll(); }
    });

    it('loads a sibling by its project path when Play serves an uncooked clip over a URL', async () => {
        const clip = 'assets/intro/hero.esanim', image = 'assets/intro/hero.png';
        const manifest: AddressableManifest = { version: '2.0', groups: { main: {
            bundleMode: 'local', labels: [], assets: {
                clip: { type: 'anim-clip', path: clip, size: 0, labels: [] },
                image: { type: 'texture', path: image, size: 0, labels: [] },
            },
        } } };
        const index = indexPackagedManifest(manifest), sprites = new SpriteAnimationAPI();
        const assets = buildAssets(sprites, () => JSON.stringify({ frames: [{ texture: 'hero.png' }] }));
        assets.setManifest(manifest);
        assets.setAssetRefResolver(ref => ref.includes('://') ? ref : `https://play.test/${index.resolvePath(ref)}`);
        const acquire = vi.spyOn(assets, 'acquireTexture');
        try {
            const lease = await assets.acquireTyped('anim-clip', 'clip');
            expect(acquire).toHaveBeenCalledWith(image, true, 'imported');
            expect(sprites.getClip('clip')?.frames[0].texture).toBeGreaterThan(0);
            lease.release();
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('resolves uncooked flipbook frames against the editor index before the catalog is populated', async () => {
        const clip = 'assets/intro/hero.esanim', sibling = 'assets/intro/hero.png';
        const local = 'assets/intro/detail.png';
        const indexed = new Set([sibling, local, 'detail.png']);
        const sprites = new SpriteAnimationAPI();
        const assets = buildAssets(sprites, () => JSON.stringify({ frames: [
            { texture: 'hero.png' }, { texture: 'detail.png' }, { texture: './detail.png' },
        ] }));
        assets.setAssetRefResolver(ref => ref, path => indexed.has(path) ? 'texture' : undefined);
        const acquire = vi.spyOn(assets, 'acquireTexture');
        try {
            const lease = await assets.acquireTyped('anim-clip', clip);
            expect(acquire.mock.calls.map(([path]) => path)).toEqual([sibling, 'detail.png', local]);
            const frames = sprites.getClip(clip)!.frames;
            expect(new Set(frames.map(frame => frame.texture)).size).toBe(3);
            expect(frames.every(frame => frame.texture > 0)).toBe(true);
            lease.release();
        } finally { assets.releaseAll(); }
    });

    it('uses the same atlas frame as a sprite when the host maps a UUID to a catalog path', async () => {
        const image = 'assets/actor.png', ref = '@uuid:f55eb7b8-70c1-4e63-950a-9b6839250280';
        const catalog = Catalog.fromJson({ version: 1, entries: { [image]: {
            type: 'texture', buildPath: 'packed.png',
            ...atlasCatalogFields({ frame: { x: 4, y: 0, width: 4, height: 2 }, pageWidth: 8, pageHeight: 8 }, 'packed.png'),
        } } });
        const sprites = new SpriteAnimationAPI(), doc = { frameSizing: 'frame', frames: [{ texture: ref }] };
        const assets = buildAssets(sprites, () => JSON.stringify(doc), { catalog });
        assets.setAssetRefResolver(name => name === ref ? image : name);
        try {
            const lease = await assets.acquireTyped('anim-clip', 'walk.esanim');
            expect(assets.getAtlasFrame(ref)?.uvOffset).toEqual([0.5, 0.75]);
            expect(sprites.getClip('walk.esanim')?.frames[0]).toMatchObject({
                size: { x: 4, y: 2 }, uvOffset: { x: 0.5, y: 0.75 }, uvScale: { x: 0.5, y: 0.25 },
            });
            lease.release();
        } finally { assets.releaseAll(); }
    });

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
