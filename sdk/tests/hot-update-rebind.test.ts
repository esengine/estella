// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hot-update-rebind.test.ts
 * @brief   A hot update reaches every field that declares an asset, not the two
 *          the rebinder's author remembered.
 *
 * @details Seven built-in fields carry a texture; the rebinder knew `Sprite.texture`
 *          and `MeshRenderer.texture`. The other five — and every project or plugin
 *          component — kept rendering the pre-update image with nothing reporting a
 *          failure. The cases here are DERIVED from `component.assetFields`, so a
 *          field added tomorrow is covered tomorrow rather than when someone
 *          remembers to extend a list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { World } from '../src/ecs/world';
import { defineComponent, getComponent, getComponentRegistry, unregisterComponent, type AnyComponentDef } from '../src/ecs/component';
import { COMPONENT_META } from '../src/ecs/component.generated';
import { Assets, type AssetsOptions } from '../src/asset/Assets';
import { createPackagedAssetSource, indexPackagedManifest } from '../src/runtime/packagedRuntime';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import { loadSceneWithAssets, SCENE_FORMAT_VERSION, type SceneData } from '../src/scene/scene';
import { spawnPrepared } from '../src/prefab/preparedPrefab';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import type { Backend } from '../src/asset/Backend';
import type { Entity } from '../src/types';
import { ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { installHotUpdateRebind } from '../src/hotUpdateRebind';
import { connectFakeCpp } from './helpers/fakeEngine';
import { SceneManager, SceneManagerState, type SceneContext } from '../src/scene/sceneManager';
import { AssetScope, ownedAssetLease, type AssetLease } from '../src/asset/AssetLease';
import { Disabled, Sprite, MeshRenderer, ParticleEmitter, TrailRenderer } from '../src/ecs/component';
import { UIVisual } from '../src/ui/core/ui-visual';
import { componentsBindingAssetTypes, liveAssetBindings, visitEntityAssetBindings } from '../src/asset/liveAssetBindings';
import { migrateLiveBindings } from '../src/asset/liveAssetRebind';
import { EntityAssetScopes } from '../src/asset/entityAssetScopes';

/** The pool, modelled: every decode mints a handle, invalidate severs revival. */
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
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
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
    platformCreateCanvas: () => ({
        width: 64, height: 64,
        getContext: () => ({
            clearRect: vi.fn(), drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64 * 64 * 4) } }),
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
    platformLoadSubpackage: vi.fn(async () => {}),
    platformGetStorageItem: () => null,
    platformSetStorageItem: vi.fn(),
    platformWriteCacheFile: vi.fn(async () => {}),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

const materialFake = vi.hoisted(() => {
    let next = 100;
    return {
        reset: () => { next = 100; },
        Material: {
            createFromAsset: vi.fn((): number => next++),
            setUniform: vi.fn(),
            tex: vi.fn((handle: number) => ({ kind: 'tex', handle })),
            compileShader: vi.fn(() => 7),
            noteProgram: vi.fn(),
            releaseShader: vi.fn(),
            release: vi.fn(),
        },
    };
});
vi.mock('../src/render/material', () => ({ Material: materialFake.Material }));

function buildAssets(docs: Record<string, string> = {}, options: Pick<AssetsOptions, 'manifest' | 'activateManifest'> = {}): Assets {
    return Assets.create({
        ...options,
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async (url: string) => {
                const key = Object.keys(docs).find((k) => url.endsWith(k));
                return key ? docs[key] : '{}';
            }),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
    });
}

// What every SDK entry does at load: register the engine's whole component
// catalogue. Without it the registry holds only what this test file happened to
// import, and the completeness check below would be measuring the imports.
ensureBuiltinComponentsRegistered();

/** Every (component, field) in the live registry that binds a texture. */
function declaredTextureFields(): Array<{ component: AnyComponentDef; field: string }> {
    const out: Array<{ component: AnyComponentDef; field: string }> = [];
    for (const component of getComponentRegistry().values()) {
        for (const f of component.assetFields) {
            if (f.type === 'texture') out.push({ component, field: f.field });
        }
    }
    return out;
}

/** Run frames until the reload's promise has landed and its swap been applied. */
async function settle(app: App, frames = 4): Promise<void> {
    for (let i = 0; i < frames; i++) {
        await app.tick(1 / 60);
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

describe('the hot-update rebinder reaches every declared texture field', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('applies a new slice border to sprite and mesh bindings when the image and its URL are identical', async () => {
        const key = '22222222-2222-4222-8222-222222222222';
        const ref = `@uuid:${key}`;
        const shipped: AddressableManifest = {
            version: '2.0', groups: { main: { bundleMode: 'local', labels: [], assets: {
                [key]: { type: 'texture', path: 'art.png', contentHash: 'same', size: 16, labels: [] },
            } } },
        };
        const next = structuredClone(shipped);
        next.groups.main.assets[key].textureImport = { sliceBorder: { left: 2, right: 3, top: 4, bottom: 5 } };
        const index = indexPackagedManifest(shipped);
        const source = createPackagedAssetSource(index);
        const assets = buildAssets({ 'update.json': JSON.stringify(next) }, {
            manifest: index.model, activateManifest: source.activateManifest,
        });
        assets.setAssetRefResolver(source.resolveRef!);
        assets.setTextureImportSettingsResolver(source.textureImportSettings!);
        const app = App.new();
        connectFakeCpp(app.world);
        installHotUpdateRebind(app, assets);
        const held = await assets.acquireTexture(ref);
        const sprite = app.world.spawn();
        const mesh = app.world.spawn();
        app.world.insert(sprite, Sprite, { texture: held.value.handle });
        app.world.insert(mesh, MeshRenderer, { texture: held.value.handle });

        const plan = await assets.checkForUpdate({ manifestUrl: 'update.json' });
        expect(plan).toMatchObject({ hasUpdate: true, changedAssets: [], totalBytes: 0 });
        expect(await assets.applyUpdate()).toMatchObject({ ok: true, updated: 1 });
        await settle(app);

        const handle = assets.getTexture(ref)!.handle;
        expect(handle).not.toBe(held.value.handle);
        expect(pool.setTextureMetadata).toHaveBeenCalledWith(handle, 2, 3, 4, 5);
        expect(app.world.get(sprite, Sprite).texture).toBe(handle);
        expect(app.world.get(mesh, MeshRenderer).texture).toBe(handle);
        held.release();
        expect(assets.getTexture(ref)!.handle).toBe(handle);
    });

    it('rebinds all of them, including a component the project declared', async () => {
        // A project component is the case a hand-written list can never cover.
        const CustomVisual = defineComponent(
            'HotUpdateRebindTestVisual',
            { icon: 0, tint: 1 },
            { assetFields: [{ field: 'icon', type: 'texture' }] },
        );

        const app = App.new();
        connectFakeCpp(app.world);
        const assets = buildAssets();
        installHotUpdateRebind(app, assets);

        const before = await assets.loadTexture('hero.png');
        const fields = declaredTextureFields();
        // Completeness, against the engine's own declaration rather than a list
        // kept here: a texture field added to a C++ component and not covered
        // below fails this, instead of quietly going unrebound.
        const covered = new Set(fields.map((f) => `${f.component._name}.${f.field}`));
        const engineDeclared = Object.entries(COMPONENT_META).flatMap(([name, meta]) =>
            (meta.assetFields ?? [])
                .filter((f) => f.type === 'texture')
                .map((f) => `${name}.${f.field}`));
        expect(engineDeclared.length).toBeGreaterThanOrEqual(7);   // never vacuous
        expect([...covered]).toEqual(expect.arrayContaining(engineDeclared));
        expect(covered.has('HotUpdateRebindTestVisual.icon')).toBe(true);

        const bound: Array<{ entity: Entity; component: AnyComponentDef; field: string }> = [];
        for (const { component, field } of fields) {
            const entity = app.world.spawn();
            app.world.insert(entity, component, { [field]: before.handle } as never);
            bound.push({ entity, component, field });
        }
        // And one field of each kind left unbound, which a swap must not touch.
        const untouched = app.world.spawn();
        app.world.insert(untouched, CustomVisual, {});

        assets.invalidate('hero.png');
        await settle(app);

        const after = assets.getTexture('hero.png');
        expect(after).toBeDefined();
        expect(after!.handle).not.toBe(before.handle);

        for (const { entity, component, field } of bound) {
            const data = app.world.get(entity, component) as Record<string, unknown>;
            expect(`${component._name}.${field} = ${String(data[field])}`)
                .toBe(`${component._name}.${field} = ${after!.handle}`);
        }
        expect((app.world.get(untouched, CustomVisual) as { icon: number }).icon).toBe(0);
    });

    it('an unbound field is not a binding of the asset being replaced', () => {
        // 0 is what an unbound field holds; matching it would rebind the whole world.
        const world = new World();
        connectFakeCpp(world);
        const Widget = defineComponent(
            'HotUpdateRebindTestWidget', { icon: 0 },
            { assetFields: [{ field: 'icon', type: 'texture' }] },
        );
        const e = world.spawn();
        world.insert(e, Widget, {});

        expect([...liveAssetBindings(world, 'texture', 0)]).toEqual([]);
        expect([...liveAssetBindings(world, 'texture', 7)]).toEqual([]);
        world.insert(e, Widget, { icon: 7 });
        expect([...liveAssetBindings(world, 'texture', 7)]).toHaveLength(1);
    });

    it('does not hand a dying entity a new owner during despawn callbacks', () => {
        const world = new World(); connectFakeCpp(world);
        const entity = world.spawn(); world.insert(entity, Sprite, { texture: 7 });
        let pending: boolean | undefined;
        let bindingsDuringDespawn = -1;
        world.onDespawn(() => {
            pending = world.isDestructionPending(entity);
            bindingsDuringDespawn = [...liveAssetBindings(world, 'texture', 7)].length;
        });
        world.despawn(entity);
        expect(pending).toBe(true);
        expect(bindingsDuringDespawn).toBe(0);
    });
});

describe('a replacement is a transaction per owning scope', () => {
    beforeEach(() => { pool = createPoolFake(); });

    /** An App with scenes, whose world's C++ side is the store above. */
    function sceneApp(): { app: App; assets: Assets; manager: SceneManagerState } {
        const app = App.new();
        connectFakeCpp(app.world);
        const assets = buildAssets();
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        installHotUpdateRebind(app, assets);
        return { app, assets, manager };
    }

    it.each([
        { component: Sprite, mode: 'managed' }, { component: MeshRenderer, mode: 'managed' },
        { component: Sprite, mode: 'standalone' }, { component: MeshRenderer, mode: 'prefab' },
        { component: Sprite, mode: 'adopted' },
    ])('keeps the listed texture generation when a $mode $component._name field is replaced', async ({ component, mode }) => {
        const { app, assets, manager } = sceneApp();
        app.insertResource(AssetsResource, assets);
        const world = app.world, ref = 'images/shared.png';
        const list = defineComponent('RebindTextureList', { images: [] as string[] }, {
            discoverAssets: data => (data.images as string[]).map(path => ({ type: 'texture', path })),
        });
        const row = { name: 'Surface', parent: null, children: [], components: [
            { type: component._name, data: { texture: ref } }, { type: list._name, data: { images: [ref] } },
        ] };
        const data: SceneData = { version: SCENE_FORMAT_VERSION, name: 'surfaces', entities: [{ ...row, id: 1 }] };
        let owner: SceneContext | undefined;
        try {
            let entity;
            if (mode === 'standalone') {
                entity = (await loadSceneWithAssets(world, data, { assets, abortOnMissingAssets: true })).get(1)!;
            } else if (mode === 'prefab') {
                vi.spyOn(assets.backend, 'fetchText').mockResolvedValue(JSON.stringify({ version: '2', name: 'Surface',
                    rootEntityId: 'surface', entities: [{ ...row, prefabEntityId: 'surface' }] }));
                const prepared = await assets.preparePrefab('surface.esprefab');
                try { entity = spawnPrepared(world, prepared).root; } finally { prepared.release(); }
            } else {
                manager.register({ name: 'surfaces', data });
                owner = await manager.loadAdditive('surfaces');
                entity = [...owner.entities][0]!;
                if (mode === 'adopted') {
                    manager.register({ name: 'other' });
                    (await manager.loadAdditive('other')).adopt(entity);
                    await manager.unload('surfaces');
                    owner = undefined;
                }
            }
            const field = () => world.get(entity, component).texture;
            const original = field();
            expect(original).toBeGreaterThan(0);
            const scope = owner ? manager.assetScopeFor('surfaces')! : assets.entityScopes.scopeFor(entity, world)!;
            expect(scope.size).toBe(1);
            const generations: number[] = [original];
            for (let i = 0; i < 3; i++) {
                assets.invalidate(ref);
                await settle(app);
                const previous = generations[generations.length - 1]!;
                expect(field()).not.toBe(previous);
                generations.push(field());
                expect(pool.releaseTexture).not.toHaveBeenCalledWith(original);
                if (previous !== original) expect(pool.releaseTexture).toHaveBeenCalledWith(previous);
                expect(scope.size).toBe(2);
            }
            if (owner) {
                owner.setPersistent(entity, true);
                await manager.unload('surfaces');
            }
            const own = assets.entityScopes.scopeFor(entity, world)!;
            expect(own.size).toBe(2);
            const current = field();
            world.remove(entity, component);
            await Promise.resolve();
            expect(own.size).toBe(1);
            expect(own.bindingLease('texture', original)).toBeDefined();
            expect(pool.releaseTexture).toHaveBeenCalledWith(current);
            expect(pool.releaseTexture).not.toHaveBeenCalledWith(original);
            world.despawn(entity);
            expect(pool.releaseTexture).toHaveBeenCalledWith(original);
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it.each(['provided', 'inferred', 'scope-only'] as const)('preserves a separate reader with %s scene ownership', async mode => {
        const { app, assets, manager } = sceneApp();
        app.insertResource(AssetsResource, assets);
        const ref = 'shared.png', world = app.world;
        const gallery = defineComponent('ListedGallery', {}, { discoverAssets: () => [{ type: 'texture', path: ref }] });
        const data: SceneData = { version: SCENE_FORMAT_VERSION, name: 'room', entities: [
            { id: 1, name: 'Canvas', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: ref } }] },
            { id: 2, name: 'Gallery', parent: null, children: [], components: [{ type: gallery._name, data: {} }] },
        ] };
        if (mode === 'inferred') {
            // A structural provider can hand back ordinary receipts without either optional ownership field.
            const preload = assets.preloadSceneAssets.bind(assets);
            vi.spyOn(assets, 'preloadSceneAssets').mockImplementation(async (...args) => {
                const result = await preload(...args), scope = new AssetScope();
                const acquisitions = result.acquisitions!.map(({ type, path, lease }) => {
                    result.scope.forget(lease); scope.add(lease);
                    return { type, path, lease };
                });
                return { ...result, scope, acquisitions };
            });
            manager.register({ name: 'room', data });
        } else {
            manager.register({ name: 'room', setup: async ctx => {
                const canvas = ctx.spawn(), reader = ctx.spawn();
                let scope: AssetScope, held: AssetLease;
                if (mode === 'scope-only') {
                    const result = await assets.preloadSceneAssets(data);
                    scope = result.scope; held = result.acquisitions![0]!.lease;
                } else {
                    scope = new AssetScope(); held = scope.add(await assets.acquireTexture(ref));
                }
                world.insert(canvas, Sprite, { texture: (held.value as { handle: number }).handle });
                world.insert(reader, gallery, {});
                ctx.trackAssetScope(scope, mode === 'provided' ? new Map([[reader, [held]]]) : undefined);
            } });
        }
        try {
            const room = await manager.loadAdditive('room');
            const canvas = [...room.entities].find(e => world.has(e, Sprite))!;
            const reader = [...room.entities].find(e => world.has(e, gallery))!;
            const original = world.get(canvas, Sprite).texture;
            assets.invalidate(ref); await settle(app);
            const updated = world.get(canvas, Sprite).texture;
            expect(updated).not.toBe(original);
            expect(pool.releaseTexture).not.toHaveBeenCalledWith(original);
            expect(manager.assetScopeFor('room')!.size).toBe(2);
            if (mode !== 'scope-only') room.setPersistent(reader, true);
            await manager.unload('room');
            expect(pool.releaseTexture).toHaveBeenCalledWith(updated);
            if (mode !== 'scope-only') {
                expect(assets.entityScopes.scopeFor(reader, world)?.bindingLease('texture', original)).toBeDefined();
                expect(pool.releaseTexture).not.toHaveBeenCalledWith(original);
                world.despawn(reader);
            }
            expect(pool.releaseTexture).toHaveBeenCalledWith(original);
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); app.quit(); }
    });

    /** A scene that acquires `ref` for itself and binds it to `fields`. */
    function sceneHolding(
        app: App, assets: Assets, ref: string,
        fields: Array<{ component: AnyComponentDef; field: string }>,
    ) {
        return async (ctx: SceneContext): Promise<void> => {
            const scope = new AssetScope();
            const lease = await assets.acquireTexture(ref);
            scope.add(lease);
            ctx.trackAssetScope(scope);
            for (const { component, field } of fields) {
                const entity = ctx.spawn();
                app.world.insert(entity, component, { [field]: lease.value.handle } as never);
            }
        };
    }

    const boundValues = (app: App, component: AnyComponentDef, field: string): number[] =>
        app.world.getEntitiesWithComponents([component])
            .map((e) => (app.world.get(e, component) as Record<string, number>)[field]);

    function delayNextTexture(assets: Assets) {
        const acquire = assets.acquireTexture.bind(assets);
        type Lease = Awaited<ReturnType<typeof acquire>>;
        let finish!: (lease: Lease) => void;
        const pending = new Promise<Lease>(resolve => { finish = resolve; });
        const load = vi.spyOn(assets, 'acquireTexture').mockReturnValueOnce(pending);
        return { acquire, finish, load };
    }

    it.each([Sprite, MeshRenderer])('keeps scene and entity textures with their respective owners on $_name', async component => {
        const { app, assets, manager } = sceneApp();
        const world = app.world;
        manager.register({ name: 'room', setup: sceneHolding(app, assets, 'scene.png', [{ component, field: 'texture' }]) });
        await manager.load('room');
        const [entity] = world.getEntitiesWithComponents([component]);
        const scene = manager.assetScopeFor('room')!;
        const local = assets.entityScopes.ensure(world, entity);
        const privateTexture = local.add(await assets.acquireTexture('local.png')).value.handle;
        world.insert(entity, TrailRenderer, { texture: privateTexture });
        const original = world.get(entity, component).texture;

        assets.invalidate('scene.png');
        await settle(app);
        const sceneTexture = assets.getTexture('scene.png')!.handle;
        expect(world.get(entity, component).texture).toBe(sceneTexture);
        expect(world.get(entity, TrailRenderer).texture).toBe(privateTexture);
        expect(scene.bindingLease('texture', sceneTexture)).toBeDefined();
        expect(local.bindingLease('texture', sceneTexture)).toBeUndefined();
        expect(pool.releaseTexture).toHaveBeenCalledWith(original);

        assets.invalidate('local.png');
        await settle(app);
        const nextPrivate = assets.getTexture('local.png')!.handle;
        expect(world.get(entity, TrailRenderer).texture).toBe(nextPrivate);
        expect(local.bindingLease('texture', nextPrivate)).toBeDefined();
        expect(pool.releaseTexture).toHaveBeenCalledWith(privateTexture);
        expect([scene.size, local.size]).toEqual([1, 1]);
        world.despawn(entity);
        expect(pool.releaseTexture).toHaveBeenCalledWith(nextPrivate);
        expect(pool.releaseTexture).not.toHaveBeenCalledWith(sceneTexture);
        await manager.unload('room');
        expect(pool.releaseTexture).toHaveBeenCalledWith(sceneTexture);
        expect(assets.sizes().refRows).toBe(0);
    });

    it.each([
        { entitySource: false, restore: false }, { entitySource: false, restore: true },
        { entitySource: true, restore: false }, { entitySource: true, restore: true },
    ])('preserves separate receipts when a second field already holds the replacement (entity source $entitySource, restore $restore)', async ({ entitySource, restore }) => {
        const { app, assets, manager } = sceneApp();
        const world = app.world;
        manager.register({ name: 'room', setup: sceneHolding(app, assets, 'shared.png', [{ component: MeshRenderer, field: 'texture' }]) });
        await manager.load('room');
        const [entity] = world.getEntitiesWithComponents([MeshRenderer]);
        const before = world.get(entity, MeshRenderer).texture;
        const scene = manager.assetScopeFor('room')!;
        const local = assets.entityScopes.ensure(world, entity);
        const source = entitySource ? local : scene;
        const prebound = entitySource ? scene : local;
        if (entitySource) {
            const receipt = scene.bindingLease('texture', before)!;
            scene.forget(receipt);
            local.add(receipt);
        }
        const { acquire, finish } = delayNextTexture(assets);
        assets.invalidate('shared.png');
        await app.tick(1 / 60);
        const replacement = await acquire('shared.png');
        const handle = replacement.value.handle;
        prebound.add(replacement.retain()!);
        world.update(entity, MeshRenderer, data => { data.normalMap = handle; });
        if (restore) {
            const set = world.set.bind(world);
            vi.spyOn(world, 'set').mockImplementation((e, component, data) => {
                set(e, component, data);
                if (e === entity && component === MeshRenderer) set(e, MeshRenderer, { ...world.get(e, MeshRenderer), texture: before });
            });
        }
        finish(replacement);
        await settle(app);

        const texture = restore ? before : handle;
        expect(world.get(entity, MeshRenderer)).toMatchObject({ texture, normalMap: handle });
        expect(source.bindingLease('texture', texture)).toBeDefined();
        expect(prebound.bindingLease('texture', handle)).toBeDefined();
        expect([scene.size, local.size, assets.sizes().refRows]).toEqual([1, 1, 2]);
        world.despawn(entity);
        if (restore && !entitySource) expect(pool.releaseTexture).toHaveBeenCalledWith(handle);
        else expect(pool.releaseTexture).not.toHaveBeenCalledWith(handle);
        await manager.unload('room');
        expect(assets.sizes().refRows).toBe(0);
        expect(pool.releaseTexture).toHaveBeenCalledWith(handle);
    });

    it('migrates bindings on disabled entities and descendants before releasing a shared scene texture', async () => {
        const { app, assets, manager } = sceneApp();
        const world = app.world;
        manager.register({ name: 'room', setup: sceneHolding(app, assets, 'shared.png', [
            { component: Sprite, field: 'texture' },
            { component: MeshRenderer, field: 'texture' },
            { component: TrailRenderer, field: 'texture' },
        ]) });
        await manager.load('room');
        const [sprite] = world.getEntitiesWithComponents([Sprite]);
        const [mesh] = world.getEntitiesWithComponents([MeshRenderer]);
        const before = world.get(mesh, MeshRenderer).texture;
        world.setParent(mesh, sprite);
        world.insert(sprite, Disabled, {});
        expect(world.getEntitiesWithComponents([Sprite])).toEqual([]);
        expect(world.getEntitiesWithComponents([MeshRenderer])).toEqual([]);

        assets.invalidate('shared.png');
        await settle(app);
        const after = assets.getTexture('shared.png')!.handle;
        expect(world.get(sprite, Sprite).texture).toBe(after);
        expect(world.get(mesh, MeshRenderer).texture).toBe(after);
        expect(pool.releaseTexture).toHaveBeenCalledWith(before);
        expect(world.getEntitiesWithComponents([MeshRenderer])).toEqual([]);
        world.remove(sprite, Disabled);
        expect(boundValues(app, MeshRenderer, 'texture')).toEqual([after]);
        expect(assets.sizes().refRows).toBe(1);
        await manager.unload('room');
        expect(assets.sizes().refRows).toBe(0);
    });

    it('rebinds stored script definitions after the catalogue reuses their name', async () => {
        const { app, assets, manager } = sceneApp();
        const name = 'ReloadedVisualForAssetBinding';
        const defaults = { icon: 0, tint: 0 };
        const original = defineComponent(name, defaults, { assetFields: [{ field: 'icon', type: 'texture' }] });
        const world = app.world;
        try {
            manager.register({ name: 'room', setup: sceneHolding(app, assets, 'shared.png', [{ component: original, field: 'icon' }]) });
            const ctx = await manager.load('room');
            const [entity] = world.getEntitiesWithComponents([original]);
            const before = world.get(entity, original).icon;
            world.update(entity, original, data => { data.tint = before; });
            unregisterComponent(name);
            expect(componentsBindingAssetTypes(world, ['texture'])).toContain(name);
            const current = defineComponent(name, defaults, { assetFields: [{ field: 'tint', type: 'texture' }] });
            const sibling = ctx.spawn();
            world.insert(sibling, current, { icon: before, tint: before });
            assets.invalidate('shared.png');
            await settle(app);
            const after = world.get(entity, original).icon;
            expect(after).not.toBe(before);
            expect(after).toBe(assets.getTexture('shared.png')!.handle);
            expect(world.get(entity, original)).toMatchObject({ icon: after, tint: before });
            expect(world.get(sibling, current)).toMatchObject({ icon: before, tint: after });
            expect(pool.releaseTexture).toHaveBeenCalledWith(before);
            expect(assets.sizes().refRows).toBe(1);
            await manager.unload('room');
            expect(assets.sizes().refRows).toBe(0);
            expect([...world.getStoredScriptComponents()]).not.toContain(current);
        } finally {
            unregisterComponent(name);
        }
    });

    it('rechecks the row declaration if a write observer replaces the next script binding', async () => {
        const { app, assets, manager } = sceneApp();
        const world = app.world, name = 'ObserverReloadedAssetBinding';
        const defaults = { icon: 0, tint: 0 };
        const original = defineComponent(name, defaults, { assetFields: [{ field: 'icon', type: 'texture' }] });
        try {
            manager.register({ name: 'room', setup: sceneHolding(app, assets, 'shared.png', [
                { component: Sprite, field: 'texture' }, { component: original, field: 'icon' },
            ]) });
            await manager.load('room');
            const [entity] = world.getEntitiesWithComponents([original]);
            const before = world.get(entity, original).icon;
            unregisterComponent(name);
            const current = defineComponent(name, defaults, { assetFields: [{ field: 'tint', type: 'texture' }] });
            const set = world.set.bind(world);
            vi.spyOn(world, 'set').mockImplementation((e, component, data) => {
                set(e, component, data);
                if (component === Sprite) set(entity, current, { icon: before, tint: before });
            });

            assets.invalidate('shared.png');
            await settle(app, 6);
            const after = assets.getTexture('shared.png')!.handle;
            expect(world.get(entity, current)).toMatchObject({ icon: before, tint: after });
            const used: unknown[] = [];
            visitEntityAssetBindings(world, entity, (_, value) => { used.push(value); }, original);
            expect(used).toEqual([after]);
            expect(assets.sizes().refRows).toBe(1);
            await manager.unload('room');
            expect(assets.sizes().refRows).toBe(0);
        } finally {
            unregisterComponent(name);
        }
    });

    it('replaces a shared texture with bounded component reads and one load for independent owners', async () => {
        const { app, assets } = sceneApp();
        const source = await assets.acquireTexture('shared.png');
        const count = 64;
        const entities = Array.from({ length: count }, (_, i) => {
            const entity = app.world.spawn();
            app.world.insert(entity, i % 2 ? MeshRenderer : Sprite, { texture: source.value.handle });
            assets.entityScopes.ensure(app.world, entity).add(source.retain()!);
            return entity;
        });
        source.release();
        const load = vi.spyOn(assets, 'acquireTexture');
        const get = vi.spyOn(app.world, 'get'), tryGet = vi.spyOn(app.world, 'tryGet');
        assets.invalidate('shared.png');
        await settle(app);
        expect(get.mock.calls.length + tryGet.mock.calls.length).toBeLessThanOrEqual(6 * count);
        expect(load).toHaveBeenCalledTimes(1);
        const after = assets.getTexture('shared.png')!.handle;
        expect(after).not.toBe(source.value.handle);
        expect(assets.sizes().refRows).toBe(count);
        for (const [i, entity] of entities.entries()) {
            expect(app.world.get(entity, i % 2 ? MeshRenderer : Sprite).texture).toBe(after);
            app.world.despawn(entity);
        }
        expect(assets.sizes().refRows).toBe(0);
    });

    it('finds the current owners when a scene unloads and a new mesh binds during reload', async () => {
        const { app, assets, manager } = sceneApp();
        app.insertResource(AssetsResource, assets);
        const world = app.world;
        let survivor!: Entity;
        manager.register({ name: 'level', setup: async ctx => {
            const scope = new AssetScope();
            const source = scope.add(await assets.acquireTexture('shared.png'));
            ctx.trackAssetScope(scope);
            survivor = ctx.spawn();
            world.insert(survivor, Sprite, { texture: source.value.handle });
            ctx.setPersistent(survivor, true);
        } });
        await manager.load('level');
        const { acquire, finish } = delayNextTexture(assets);
        assets.invalidate('shared.png');
        await app.tick(1 / 60);
        await manager.unload('level');
        const held = assets.entityScopes.scopeFor(survivor, world)!.leases()[0];
        const mesh = world.spawn(), other = world.spawn();
        world.insert(mesh, MeshRenderer, { texture: world.get(survivor, Sprite).texture });
        assets.entityScopes.ensure(world, mesh).add(held.retain()!);
        const own = await acquire('other.png');
        world.insert(other, Sprite, { texture: own.value.handle });
        assets.entityScopes.ensure(world, other).add(own);
        const incoming = await acquire('shared.png');
        finish(incoming);
        await settle(app);
        expect(world.get(survivor, Sprite).texture).toBe(incoming.value.handle);
        expect(world.get(mesh, MeshRenderer).texture).toBe(incoming.value.handle);
        expect(world.get(other, Sprite).texture).toBe(own.value.handle);
        expect(assets.sizes().refRows).toBe(3);
        for (const entity of [survivor, mesh, other]) world.despawn(entity);
        expect(assets.sizes().refRows).toBe(0);
    });

    it('skips a replacement invalidated again before a delayed acquisition is delivered', async () => {
        const { app, assets } = sceneApp();
        const old = await assets.acquireTexture('hero.png'), entity = app.world.spawn();
        app.world.insert(entity, Sprite, { texture: old.value.handle });
        assets.entityScopes.ensure(app.world, entity).add(old);
        const { acquire, finish } = delayNextTexture(assets);
        assets.invalidate('hero.png');
        await app.tick(1 / 60);
        const middle = await acquire('hero.png');
        assets.invalidate('hero.png');
        await app.tick(1 / 60);
        const latest = await acquire('hero.png');
        finish(middle);
        await settle(app);
        expect(app.world.get(entity, Sprite).texture).toBe(latest.value.handle);
        latest.release();
        expect(assets.sizes().refRows).toBe(1);
        app.world.despawn(entity);
        expect(assets.sizes().refRows).toBe(0);
    });

    it('releases the replacement when a write synchronously despawns its owner', async () => {
        const { app, assets } = sceneApp();
        const world = app.world, entity = world.spawn(), source = await assets.acquireTexture('shared.png');
        world.insert(entity, Sprite, { texture: source.value.handle });
        assets.entityScopes.ensure(world, entity).add(source);
        const set = world.set.bind(world);
        vi.spyOn(world, 'set').mockImplementation((e, component, value) => {
            set(e, component, value);
            if (e === entity && component === Sprite) world.despawn(entity);
        });
        assets.invalidate('shared.png');
        await settle(app);
        expect(world.valid(entity)).toBe(false);
        expect(assets.entityScopes.size).toBe(0);
        expect(assets.sizes().refRows).toBe(0);
    });

    it('picks up a new entity bound by a synchronous component observer', async () => {
        const { app, assets } = sceneApp();
        const world = app.world, first = world.spawn(), source = await assets.acquireTexture('shared.png');
        world.insert(first, Sprite, { texture: source.value.handle });
        assets.entityScopes.ensure(world, first).add(source);
        let late: Entity | undefined;
        const set = world.set.bind(world);
        vi.spyOn(world, 'set').mockImplementation((entity, component, value) => {
            set(entity, component, value);
            if (entity !== first || component !== Sprite || late !== undefined) return;
            late = world.spawn();
            world.insert(late, MeshRenderer, { texture: source.value.handle });
            assets.entityScopes.ensure(world, late).add(source.retain()!);
        });
        assets.invalidate('shared.png');
        await settle(app, 6);
        const latest = assets.getTexture('shared.png')!.handle;
        expect(world.get(first, Sprite).texture).toBe(latest);
        expect(world.get(late!, MeshRenderer).texture).toBe(latest);
        expect(assets.sizes().refRows).toBe(2);
        world.despawn(first);
        world.despawn(late!);
        expect(assets.sizes().refRows).toBe(0);
    });

    it('releases the outgoing receipt when an observer already updated the next owner', async () => {
        const { app, assets } = sceneApp();
        const world = app.world, first = world.spawn(), second = world.spawn();
        const source = await assets.acquireTexture('shared.png');
        for (const entity of [first, second]) {
            world.insert(entity, Sprite, { texture: source.value.handle });
            assets.entityScopes.ensure(world, entity).add(source.retain()!);
        }
        source.release();
        const set = world.set.bind(world);
        vi.spyOn(world, 'set').mockImplementation((entity, component, data) => {
            set(entity, component, data);
            if (component !== Sprite) return;
            const peer = entity === first ? second : first;
            set(peer, Sprite, { ...world.get(peer, Sprite), texture: world.get(entity, Sprite).texture });
        });
        assets.invalidate('shared.png');
        await settle(app);
        const latest = assets.getTexture('shared.png')!.handle;
        expect(world.get(first, Sprite).texture).toBe(latest);
        expect(world.get(second, Sprite).texture).toBe(latest);
        expect(assets.sizes().refRows).toBe(2);
        expect(pool.releaseTexture).toHaveBeenCalledWith(source.value.handle);
        world.despawn(first);
        world.despawn(second);
        expect(assets.sizes().refRows).toBe(0);
    });

    it('drops a delayed replacement when the realm has released its assets', async () => {
        const { app, assets } = sceneApp();
        const old = await assets.acquireTexture('hero.png'), entity = app.world.spawn();
        app.world.insert(entity, Sprite, { texture: old.value.handle });
        const { acquire, finish, load } = delayNextTexture(assets);
        assets.invalidate('hero.png');
        await app.tick(1 / 60);
        const incoming = await acquire('hero.png');
        assets.releaseAll();
        finish(incoming);
        await settle(app);
        expect(app.world.get(entity, Sprite).texture).toBe(old.value.handle);
        expect(load).toHaveBeenCalledTimes(1);
        expect(assets.sizes().refRows).toBe(0);
        expect(assets.entityScopes.size).toBe(0);
        app.world.despawn(entity);
    });

    it('keeps both generations until an existing scene field bound by an observer has caught up', async () => {
        const { app, assets, manager } = sceneApp();
        const world = app.world;
        let sprite!: Entity, mesh!: Entity, old = 0;
        manager.register({ name: 'level', setup: async ctx => {
            const scope = new AssetScope();
            old = scope.add(await assets.acquireTexture('shared.png')).value.handle;
            ctx.trackAssetScope(scope);
            sprite = ctx.spawn();
            mesh = ctx.spawn();
            world.insert(sprite, Sprite, { texture: old });
            world.insert(mesh, MeshRenderer, { texture: 0 });
        } });
        await manager.load('level');
        let oldStillHeld = false;
        const set = world.set.bind(world);
        vi.spyOn(world, 'set').mockImplementation((entity, component, data) => {
            set(entity, component, data);
            if (entity === sprite && component === Sprite) set(mesh, MeshRenderer, { ...world.get(mesh, MeshRenderer), texture: old });
            if (entity === mesh && component === MeshRenderer) oldStillHeld = !pool.releaseTexture.mock.calls.some(([handle]) => handle === old);
        });
        assets.invalidate('shared.png');
        await settle(app, 6);
        const latest = assets.getTexture('shared.png')!.handle;
        expect(world.get(sprite, Sprite).texture).toBe(latest);
        expect(world.get(mesh, MeshRenderer).texture).toBe(latest);
        expect(oldStillHeld).toBe(true);
        expect(assets.sizes().refRows).toBe(1);
        await manager.unload('level');
        expect(assets.sizes().refRows).toBe(0);
    });

    it('respects an observer that restores the outgoing value without retrying or holding the unused replacement', async () => {
        const { app, assets } = sceneApp();
        const world = app.world, entity = world.spawn(), source = await assets.acquireTexture('shared.png');
        world.insert(entity, Sprite, { texture: source.value.handle });
        assets.entityScopes.ensure(world, entity).add(source);
        const set = world.set.bind(world);
        vi.spyOn(world, 'set').mockImplementation((e, component, data) => {
            set(e, component, data);
            if (e === entity && component === Sprite) set(entity, Sprite, { ...world.get(entity, Sprite), texture: source.value.handle });
        });
        const load = vi.spyOn(assets, 'acquireTexture');
        assets.invalidate('shared.png');
        await settle(app);
        expect(world.get(entity, Sprite).texture).toBe(source.value.handle);
        expect(load).toHaveBeenCalledTimes(1);
        expect(assets.sizes().refRows).toBe(1);
        expect(pool.releaseTexture).not.toHaveBeenCalledWith(source.value.handle);
        world.despawn(entity);
        expect(assets.sizes().refRows).toBe(0);
    });

    it('two scenes holding one texture get one acquisition EACH', async () => {
        // The cardinality the world-wide swap got wrong: it acquired once and
        // moved both owners onto it, so one of the two receipts named an era
        // nothing was drawing and the era both were drawing had one holder.
        const { app, assets, manager } = sceneApp();
        const base = assets.sizes().refRows;

        manager.register({ name: 'a', setup: sceneHolding(app, assets, 'hero.png', [{ component: Sprite, field: 'texture' }]) });
        manager.register({ name: 'b', setup: sceneHolding(app, assets, 'hero.png', [{ component: TrailRenderer, field: 'texture' }]) });
        await manager.loadAdditive('a');
        await manager.loadAdditive('b');

        const before = assets.getTexture('hero.png')!.handle;
        expect(assets.sizes().refRows).toBe(base + 2);          // two owners, one era

        assets.invalidate('hero.png');
        await settle(app);

        const after = assets.getTexture('hero.png')!.handle;
        expect(after).not.toBe(before);
        expect(boundValues(app, Sprite, 'texture')).toEqual([after]);
        expect(boundValues(app, TrailRenderer, 'texture')).toEqual([after]);
        // Two owners still, of the new era: one acquisition each, and the era
        // they left has no holders.
        expect(assets.sizes().refRows).toBe(base + 2);

        await manager.unload('a');
        // B is still drawing it, and still owes exactly one release.
        expect(assets.sizes().refRows).toBe(base + 1);
        expect(boundValues(app, TrailRenderer, 'texture')).toEqual([after]);

        await manager.unload('b');
        expect(assets.sizes().refRows).toBe(base);              // nothing stranded
    });

    it('one scene\'s four fields move together, and it owes ONE release', async () => {
        // Per scope, not per binding: a scene left holding the new era for some
        // of its fields and the old one for the rest owes two receipts for one
        // replacement, and nothing afterwards can say which field is which.
        const { app, assets, manager } = sceneApp();
        const base = assets.sizes().refRows;
        const fields = [
            { component: Sprite, field: 'texture' },
            { component: UIVisual, field: 'texture' },
            { component: MeshRenderer, field: 'normalMap' },
            { component: ParticleEmitter, field: 'texture' },
        ];
        manager.register({ name: 'level', setup: sceneHolding(app, assets, 'hero.png', fields) });
        await manager.loadAdditive('level');

        const before = assets.getTexture('hero.png')!.handle;
        expect(assets.sizes().refRows).toBe(base + 1);

        assets.invalidate('hero.png');
        await settle(app);

        const after = assets.getTexture('hero.png')!.handle;
        expect(after).not.toBe(before);
        for (const { component, field } of fields) {
            expect(boundValues(app, component, field), `${component._name}.${field}`).toEqual([after]);
        }
        expect(assets.sizes().refRows).toBe(base + 1);          // one owner, one receipt

        await manager.unload('level');
        expect(assets.sizes().refRows).toBe(base);
    });

    it('five hot updates in a row leave the scene owing exactly one release', async () => {
        // The measured leak: each successful rebind took a texture out of the
        // ledger with no receipt, so five updates left five rows that no unload
        // could ever reach. What a scene owes is one release, always.
        const { app, assets, manager } = sceneApp();
        const base = assets.sizes().refRows;
        manager.register({
            name: 'level',
            setup: sceneHolding(app, assets, 'hero.png', [{ component: Sprite, field: 'texture' }]),
        });
        await manager.loadAdditive('level');

        for (let i = 0; i < 5; i++) {
            assets.invalidate('hero.png');
            await settle(app);
            expect(boundValues(app, Sprite, 'texture'), `after update ${i + 1}`)
                .toEqual([assets.getTexture('hero.png')!.handle]);
            expect(assets.sizes().refRows, `after update ${i + 1}`).toBe(base + 1);
        }

        await manager.unload('level');
        expect(assets.sizes().refRows).toBe(base);
    });

    it('a runtime sprite releases its replacement when the entity despawns', async () => {
        const { app, assets } = sceneApp();
        const base = assets.sizes().refRows;

        const lease = await assets.acquireTexture('hero.png');
        const entity = app.world.spawn();
        app.world.insert(entity, Sprite, { texture: lease.value.handle });

        assets.invalidate('hero.png');
        await settle(app);
        const after = assets.getTexture('hero.png')!.handle;
        expect(boundValues(app, Sprite, 'texture')).toEqual([after]);

        lease.release();                                  // the game lets go of its own era
        expect(assets.sizes().refRows).toBe(base + 1);
        expect(assets.appScope.size).toBe(0);
        app.world.despawn(entity);
        expect(assets.entityScopes.size).toBe(0);
        expect(assets.sizes().refRows).toBe(base);
    });

    it('runtime mesh materials end with their own entities, including instance sets', async () => {
        const app = App.new(); connectFakeCpp(app.world);
        const assets = buildAssets({ 'leaf.esmaterial': JSON.stringify({
            version: '1.0', type: 'material', shader: 'builtin:model',
            properties: { u_normalMap: 'leaf.png' },
        }) });
        installHotUpdateRebind(app, assets);
        const base = assets.sizes().refRows;
        for (let i = 0; i < 3; i++) {
            const initial = await assets.acquireTyped<{ handle: number }>('material', 'leaf.esmaterial');
            const entities = [app.world.spawn(), app.world.spawn()];
            for (const entity of entities) app.world.insert(entity, MeshRenderer, { material: initial.value.handle });
            app.world.insert(entities[0], getComponent('MeshInstances')!, {});
            assets.invalidate('leaf.esmaterial'); await settle(app, 8);
            const replacement = app.world.get(entities[0], MeshRenderer).material;
            expect(replacement).not.toBe(initial.value.handle);
            expect(app.world.get(entities[1], MeshRenderer).material).toBe(replacement);
            initial.release();
            expect(assets.appScope.size).toBe(0);
            expect(assets.entityScopes.size).toBe(2);
            app.world.despawn(entities[0]);
            expect(assets.entityScopes.size).toBe(1);
            expect(materialFake.Material.release).not.toHaveBeenCalledWith(replacement);
            app.world.despawn(entities[1]);
            expect(materialFake.Material.release).toHaveBeenCalledWith(replacement);
            expect(assets.entityScopes.size).toBe(0);
            expect(assets.sizes().refRows, `after generation ${i}`).toBe(base);
        }
    });

    it('returns a late replacement when its runtime entity despawned while loading', async () => {
        const { app, assets } = sceneApp();
        const initial = await assets.acquireTexture('hero.png');
        const entity = app.world.spawn();
        app.world.insert(entity, Sprite, { texture: initial.value.handle });
        const { acquire, finish } = delayNextTexture(assets);
        assets.invalidate('hero.png'); await app.tick(1 / 60);
        expect(assets.acquireTexture).toHaveBeenCalledTimes(1);
        expect(assets.entityScopes.size).toBe(0);
        app.world.despawn(entity); initial.release();
        finish(await acquire('hero.png')); await settle(app);
        expect(assets.entityScopes.size).toBe(0);
        expect(assets.appScope.size).toBe(0);
        expect(assets.sizes().refRows).toBe(0);
    });
});

describe('a scope migrates all of its bindings or none', () => {
    it.each([
        { mode: 'typed', odd: 'mesh', even: 'mesh' }, { mode: 'structural' },
        { mode: 'typed to structural', odd: 'mesh' }, { mode: 'structural to typed', even: 'mesh' },
    ])('prefers the live $mode generation when pinned mesh generations reuse a handle', ({ odd, even }) => {
        const world = new World(); connectFakeCpp(world);
        const entity = world.spawn(); world.insert(entity, MeshRenderer, { mesh: 7 });
        const disposed: number[] = [];
        const next = (revision: number) => ownedAssetLease('model', revision, 7, () => disposed.push(revision), revision % 2 ? odd : even);
        const before = new AssetScope(), active = new AssetScope();
        const first = before.add(next(1)), second = before.add(next(2));
        before.preserveDependency(first); before.preserveDependency(second);
        active.absorb(before);
        migrateLiveBindings(world, 'mesh', 7, second, () => active);
        expect(active.size).toBe(2);
        expect(active.bindingLease('mesh', 7)).toBe(second);
        expect(active.bindingLease('mesh', 7)).toBe(second);
        const owners = new EntityAssetScopes();
        owners.retainFromScene(world, entity, active, [first, second]);
        const promoted = owners.scopeFor(entity, world)!;
        expect(promoted.size).toBe(2);
        expect(promoted.bindingLease('mesh', 7)?.generation).toBe(2);
        promoted.releaseAll();
        for (let revision = 3; revision <= 6; revision++) {
            const replacement = next(revision);
            migrateLiveBindings(world, 'mesh', 7, replacement, () => active);
            replacement.release();
            expect(active.bindingLease('mesh', 7)?.generation).toBe(revision);
            expect(active.bindingLease('mesh', 7)?.generation).toBe(revision);
            expect(active.size).toBe(3);
        }
        expect(disposed).toEqual([3, 4, 5]);
        active.releaseAll();
        expect(disposed).toEqual([3, 4, 5, 6, 2, 1]);
        world.despawn(entity);
    });

    it('uses the exact preloaded generation when another dependency has the incoming handle', () => {
        const world = new World(); connectFakeCpp(world);
        const entity = world.spawn(); world.insert(entity, Sprite, { texture: 7 });
        const scope = new AssetScope(), freed: number[] = [];
        const hold = (generation: number, value: number) =>
            scope.add(ownedAssetLease('image', generation, value, () => freed.push(generation), 'texture'));
        hold(1, 7);
        const earlier = hold(2, 9), replacement = hold(3, 9);
        scope.preserveDependency(earlier); scope.preserveDependency(replacement);
        expect(migrateLiveBindings(world, 'texture', 7, replacement, () => scope).moved).toBe(1);
        expect(world.get(entity, Sprite).texture).toBe(9);
        expect(scope.size).toBe(2);
        expect(scope.bindingLease('texture', 9)).toBe(replacement);
        expect(scope.bindingLease('texture', 9)).toBe(replacement);
        expect(freed).toEqual([1]);
        scope.releaseAll();
        expect(freed).toEqual([1, 3, 2]);
    });

    it('keeps one receipt for a generation already held when the loader reuses a handle', () => {
        const world = new World(); connectFakeCpp(world);
        const scope = new AssetScope(), releaseOld = vi.fn(), releaseNew = vi.fn();
        scope.add(ownedAssetLease('mesh:path', 1, 7, releaseOld, 'mesh'));
        const next = ownedAssetLease('mesh:path', 2, 7, releaseNew, 'mesh');
        scope.add(next.retain()!);
        const entity = world.spawn();
        world.insert(entity, MeshRenderer, { mesh: 7 });
        const set = vi.spyOn(world, 'set');
        expect(migrateLiveBindings(world, 'mesh', 7, next, () => scope)).toEqual({ moved: 1, revisit: false });
        expect(set).not.toHaveBeenCalled();
        expect(scope.size).toBe(1);
        expect(releaseOld).toHaveBeenCalledTimes(1);
        next.release();
        expect(releaseNew).not.toHaveBeenCalled();
        scope.releaseAll();
        expect(releaseNew).toHaveBeenCalledTimes(1);
    });

    /** A world whose Nth write refuses — the failure the rollback exists for. */
    function worldFailingWriteAt(nth: number): World {
        const world = new World();
        connectFakeCpp(world);
        let writes = 0;
        const set = world.set.bind(world);
        world.set = ((entity: never, component: never, data: never) => {
            if (++writes === nth) throw new Error('component store refused the write');
            return set(entity, component, data);
        }) as typeof world.set;
        return world;
    }

    it('rolls back a failed owner while an independent owner still receives the replacement', () => {
        const scope = new AssetScope();
        let released = 0;
        const outgoing = {
            key: 'texture:hero.png', generation: 1, value: { handle: 11 },
            release: () => { released++; },
        };
        scope.add(outgoing as never);

        const world = worldFailingWriteAt(3);
        const Widget = defineComponent(
            'RollbackTestWidget', { icon: 0 },
            { assetFields: [{ field: 'icon', type: 'texture' }] },
        );
        const entities = [world.spawn(), world.spawn(), world.spawn(), world.spawn()];
        for (const e of entities) world.insert(e, Widget, { icon: 11 });
        const independent = world.spawn(), otherScope = new AssetScope();
        world.insert(independent, Widget, { icon: 11 });

        let replacementReleased = 0;
        const replacement = ownedAssetLease('texture:hero.png', 2, { handle: 22 }, () => { replacementReleased++; }, 'texture');
        const migrated = migrateLiveBindings(world, 'texture', 11, replacement, e => e === independent ? otherScope : scope);
        replacement.release();

        expect(migrated).toEqual({ moved: 1, revisit: false });
        // Every binding still holds the era the scope still owns...
        for (const e of entities) expect((world.get(e, Widget) as { icon: number }).icon).toBe(11);
        expect(released).toBe(0);
        expect(world.get(independent, Widget).icon).toBe(22);
        expect(replacementReleased).toBe(0);
        expect(scope.size).toBe(1);
        expect(scope.leases()[0]).toBe(outgoing);
        otherScope.releaseAll();
        expect(replacementReleased).toBe(1);
    });
});

describe('a live binding follows the asset, whatever kind it is', () => {
    beforeEach(() => { pool = createPoolFake(); materialFake.reset(); });

    /** A material on a built-in shader, binding no textures of its own. */
    const MATERIAL = JSON.stringify({
        type: 'material', shader: 'builtin:sprite-unlit', properties: {},
    });

    describe.each([
        ['texture', 'png', 'Sprite', 'MeshRenderer', 'texture'],
        ['material', 'esmaterial', 'Sprite', 'MeshRenderer', 'material'],
        ['mesh', 'esmesh', 'MeshRenderer', 'MeshCollider3D', 'mesh'],
        ['font', 'fnt', 'BitmapText', 'BitmapText', 'font'],
        ['environment', 'esenv', 'Light', 'Light', 'environment'],
        ['probeVolume', 'esprobes', 'LightProbeVolume', 'LightProbeVolume', 'probes'],
    ] as const)('%s shared file', (type, ext, firstComponent, secondComponent, field) => {
        it.each(['local', 'remote'] as const)('keeps two %s records on the same file independently bound', async mode => {
            const first = '45d141cb-38d9-4c51-ad93-c06a785471c1';
            const second = '7727ca31-4df7-4d64-800c-7090ad6f5a94';
            const shared = `blobs/shared.${ext}`, changed = `blobs/changed.${ext}`;
            const record = (name: string) => ({ type, path: shared, address: `art/${name}.${ext}`, labels: [], size: 8 });
            const shipped: AddressableManifest = { version: '2.0', groups: { art: { bundleMode: mode, labels: [], assets: {
                [first]: record('first'), [second]: record('second'),
            } } } };
            const updated = structuredClone(shipped);
            updated.groups.art.assets[first].path = changed;
            const index = indexPackagedManifest(shipped), source = createPackagedAssetSource(index);
            const assets = buildAssets({ [shared]: MATERIAL, [changed]: MATERIAL,
                'split.json': JSON.stringify(updated), 'join.json': JSON.stringify(shipped),
            }, { manifest: index.model, activateManifest: source.activateManifest });
            if (type !== 'texture' && type !== 'material') {
                let serial = 0;
                assets.register({ type, extensions: [`.${ext}`], load: async () => ({ handle: ++serial }), unload: () => {} });
            }
            assets.setAssetRefResolver(source.resolveRef!);
            if (mode === 'remote') assets.setRemoteRoot('https://cdn.test');
            const app = App.new(); connectFakeCpp(app.world); installHotUpdateRebind(app, assets);
            const refs = [`@uuid:${first}`, `art/second.${ext}`, `/art/first.${ext}`];
            const scene: SceneData = { version: SCENE_FORMAT_VERSION, name: 'shared', entities: refs.map((ref, id) => ({
                id, name: String(id), parent: null, children: [], visible: true,
                components: [{ type: id === 1 ? secondComponent : firstComponent, data: { [field]: ref } }],
            })) };
            const prepared = await assets.preloadSceneAssets(scene, undefined, { entityOwnership: true });
            try {
                expect(prepared.missing).toEqual([]);
                assets.resolveSceneAssetPaths(scene, prepared);
                const handles = scene.entities.map(e => Number(e.components[0].data[field]));
                expect(handles[0]).toBeGreaterThan(0);
                expect(handles[1]).toBeGreaterThan(0);
                expect(handles[0]).not.toBe(handles[1]);
                expect(handles[2]).toBe(handles[0]);
                const locator = (file: string) => mode === 'remote' ? `https://cdn.test/${file}` : file;
                for (const handle of handles) expect(assets.pathForHandle(type, handle)).toBe(locator(shared));
                expect(prepared.acquisitions?.map(a => [...a.entityIds!])).toEqual(expect.arrayContaining([[0, 2], [1]]));
                const left = app.world.spawn(), right = app.world.spawn();
                const leftDef = getComponent(firstComponent)!, rightDef = getComponent(secondComponent)!;
                app.world.insert(left, leftDef, { [field]: handles[0] });
                app.world.insert(right, rightDef, { [field]: handles[1] });
                for (const url of ['split.json', 'join.json']) {
                    await assets.checkForUpdate({ manifestUrl: url });
                    expect((await assets.applyUpdate()).ok).toBe(true);
                    await settle(app, 8);
                    const current = await assets.acquireTyped<{ handle: number }>(type, first);
                    try {
                        expect(app.world.get(left, leftDef)[field]).toBe(current.value.handle);
                        expect(current.value.handle).not.toBe(handles[1]);
                        expect(app.world.get(right, rightDef)[field]).toBe(handles[1]);
                        expect(assets.pathForHandle(type, handles[1])).toBe(locator(shared));
                        expect(assets.pathForHandle(type, current.value.handle)).toBe(locator(url === 'split.json' ? changed : shared));
                    } finally { current.release(); }
                }
            } finally { prepared.scope.releaseAll(); assets.releaseAll(); }
        });

    });

    describe.each([['texture', 'png'], ['material', 'esmaterial']] as const)('%s in a shipped manifest', (type, ext) => {
        it.each(['renamed', 'restored', 'reused locator', 'released'] as const)('handles a %s asset across 2D and 3D fields', async mode => {
            const key = '4e032db1-5b38-47ee-8102-f2ba5536f727';
            const ref = `@uuid:${key}`;
            const original = `old.${ext}`, replacement = `new.${ext}`;
            const manifest = (file?: string): AddressableManifest => ({
                version: '2.0', revision: file ?? 'removed',
                groups: { art: { labels: [], bundleMode: 'remote', assets: file ? {
                    [key]: { type, labels: [], path: file, address: `art/hero.${ext}`, size: 8 },
                } : {} } },
            });
            const absent = manifest(), nextManifest = manifest(replacement);
            if (mode === 'reused locator') {
                const other = { type, labels: [], path: original, size: 8, address: `art/other.${ext}` };
                absent.groups.art.assets.other = other;
                nextManifest.groups.art.assets.other = other;
            }
            const index = indexPackagedManifest(manifest(original));
            const source = createPackagedAssetSource(index);
            const assets = buildAssets({
                'removed.json': JSON.stringify(absent), 'next.json': JSON.stringify(nextManifest),
                [original]: MATERIAL, [replacement]: MATERIAL,
            }, { manifest: index.model, activateManifest: source.activateManifest });
            const app = App.new();
            connectFakeCpp(app.world);
            assets.setAssetRefResolver(source.resolveRef!);
            assets.setRemoteRoot('https://cdn.test');
            installHotUpdateRebind(app, assets);
            const old = await assets.acquireTyped<{ handle: number }>(type, ref);
            const sprite = app.world.spawn(), mesh = app.world.spawn();
            app.world.insert(sprite, Sprite, { [type]: old.value.handle });
            app.world.insert(mesh, MeshRenderer, { [type]: old.value.handle });
            const checkFields = (handle: number) => {
                expect(app.world.get(sprite, Sprite)[type]).toBe(handle);
                expect(app.world.get(mesh, MeshRenderer)[type]).toBe(handle);
            };
            let unrelated: Entity | undefined;
            let other: AssetLease<{ handle: number }> | undefined;
            const events = vi.fn();
            assets.onInvalidate(events);
            try {
                if (mode !== 'renamed') {
                    const removal = await assets.checkForUpdate({ manifestUrl: 'removed.json' });
                    expect(removal.downloadFiles).toEqual([]);
                    expect((await assets.applyUpdate()).ok).toBe(true);
                    await settle(app);
                    checkFields(old.value.handle);
                    expect(events).not.toHaveBeenCalledWith(expect.objectContaining({ ref: key }));
                }
                if (mode === 'released') old.release();
                if (mode === 'reused locator') {
                    other = await assets.acquireTyped<{ handle: number }>(type, 'other');
                    unrelated = app.world.spawn();
                    app.world.insert(unrelated, Sprite, { [type]: other.value.handle });
                }
                await assets.checkForUpdate({ manifestUrl: 'next.json' });
                expect((await assets.applyUpdate()).ok).toBe(true);
                await settle(app, 8);
                const next = await assets.acquireTyped<{ handle: number }>(type, ref);
                try {
                    expect(next.value.handle).not.toBe(old.value.handle);
                    if (mode === 'released') {
                        checkFields(old.value.handle);
                        expect(events).not.toHaveBeenCalledWith(expect.objectContaining({ oldValue: expect.anything() }));
                    } else {
                        checkFields(next.value.handle);
                        const retained = old.retain()!;
                        expect(retained.value).toBe(old.value);
                        retained.release();
                    }
                    if (other && unrelated !== undefined) expect(app.world.get(unrelated, Sprite)[type]).toBe(other.value.handle);
                } finally { next.release(); }
            } finally { other?.release(); old.release(); assets.releaseAll(); }
        });
    });

    it('shares a cold decode while keeping sampling, borders and warm handles on each texture record', async () => {
        const file = 'blobs/shared.png';
        const record = { type: 'texture' as const, path: file, contentHash: 'immutable', size: 4, labels: [] };
        const index = indexPackagedManifest({ version: '2.0', groups: { art: { labels: [], bundleMode: 'remote', assets: {
            'first:%': { ...record, address: 'art/first.png', textureImport: { filter: 'nearest', mipmaps: false } },
            second: { ...record, address: 'art/second.png', textureImport: { filter: 'linear', mipmaps: false,
                sliceBorder: { left: 1, right: 2, top: 3, bottom: 4 } } },
        } } } });
        const source = createPackagedAssetSource(index);
        const assets = buildAssets({}, { manifest: index.model, activateManifest: source.activateManifest });
        assets.setAssetRefResolver(source.resolveRef!);
        assets.setTextureImportSettingsResolver(source.textureImportSettings!);
        assets.setRemoteRoot('https://cdn.test');
        const decode = vi.fn(async () => ({ width: 1, height: 1, pixels: new Uint8Array(4) }));
        assets.getTextureLoader().setPixelDecoder(decode);
        const upload = vi.fn((..._args: unknown[]) => pool.createTexture());
        Object.assign(pool, { createTextureEx: upload });
        const bundle = await assets.loadGroup('art');
        try {
            const first = bundle.textures.get('first:%')!.handle, second = bundle.textures.get('second')!.handle;
            expect(first).not.toBe(second);
            expect(decode).toHaveBeenCalledTimes(1);
            expect(decode).toHaveBeenCalledWith('https://cdn.test/' + file, true, 0);
            expect(upload.mock.calls[0][6]).not.toBe(upload.mock.calls[1][6]);
            expect(pool.setTextureMetadata.mock.calls).toEqual([[second, 1, 2, 3, 4]]);
            expect(assets.getTexture(file)?.handle).toBe(first);
            expect(assets.getTexture('/art/second.png')?.handle).toBe(second);
            expect(assets.pathForHandle('texture', second)).toBe('https://cdn.test/' + file);
            bundle.release();
            const again = await assets.acquireTexture('art/second.png');
            expect(again.value.handle).toBe(second);
            expect(decode).toHaveBeenCalledTimes(1);
            again.release();
            const raw = await Promise.all(['first:%', 'second'].map(ref => assets.acquireTexture(ref, false)));
            expect(decode).toHaveBeenCalledTimes(2);
            expect(new Set([first, second, ...raw.map(r => r.value.handle)]).size).toBe(4);
            for (const r of raw) r.release();
        } finally { bundle.release(); assets.releaseAll(); }
    });

    it('reads shared material bytes once and resolves relative textures from each authored directory', async () => {
        const file = 'blobs/shared.esmaterial', texture = (path: string) => ({ type: 'texture' as const, path, labels: [], size: 8 });
        const record = { type: 'material' as const, path: file, labels: [], size: 8, contentHash: 'immutable' };
        const index = indexPackagedManifest({ version: '2.0', groups: { art: { bundleMode: 'local', labels: [], assets: {
            left: { ...record, address: 'art/left/paint.esmaterial' }, right: { ...record, address: 'art/right/paint.esmaterial' },
            red: { ...texture('blobs/red.png'), address: 'art/left/color.png' },
            blue: { ...texture('blobs/blue.png'), address: 'art/right/color.png' },
        } } } });
        const source = createPackagedAssetSource(index);
        const assets = buildAssets({ [file]: JSON.stringify({ ...JSON.parse(MATERIAL), properties: { u_color: 'color.png' } }) },
            { manifest: index.model, activateManifest: source.activateManifest });
        assets.setAssetRefResolver(source.resolveRef!);
        const fetched = vi.spyOn(assets.backend, 'fetchText');
        const [left, right] = await Promise.all(['left', 'right'].map(ref => assets.acquireTyped<{ handle: number }>('material', ref)));
        try {
            expect(fetched).toHaveBeenCalledTimes(1);
            expect(fetched).toHaveBeenCalledWith('http://test/' + file);
            expect(left.value.handle).not.toBe(right.value.handle);
            const red = assets.getTexture('red')!.handle, blue = assets.getTexture('blue')!.handle;
            expect(red).not.toBe(blue);
            expect(materialFake.Material.setUniform).toHaveBeenCalledWith(left.value.handle, 'u_color', { kind: 'tex', handle: red });
            expect(materialFake.Material.setUniform).toHaveBeenCalledWith(right.value.handle, 'u_color', { kind: 'tex', handle: blue });
        } finally { left.release(); right.release(); assets.releaseAll(); }
    });

    it('streams only the preview belonging to the record drawn on a mesh', async () => {
        const file = 'blobs/large.png';
        const record = { type: 'texture' as const, path: file, labels: [], size: 16, contentHash: 'immutable' };
        const tail = { path: 'blobs/small.png', width: 8, height: 8, fullWidth: 128, fullHeight: 128, size: 4 };
        const index = indexPackagedManifest({ version: '2.0', groups: { art: { bundleMode: 'remote', labels: [], assets: {
            first: { ...record, address: 'art/preview.png', streamTail: tail }, second: { ...record, address: 'art/full.png' },
        } } } });
        const source = createPackagedAssetSource(index);
        const assets = buildAssets({}, { manifest: index.model, activateManifest: source.activateManifest });
        assets.setAssetRefResolver(source.resolveRef!);
        assets.setRemoteRoot('https://cdn.test');
        assets.setTextureStreamingStart(8);
        Object.assign(pool, { adoptTextureContent: () => true });
        const decode = vi.fn(async () => ({ width: 8, height: 8, pixels: new Uint8Array(8 * 8 * 4) }));
        assets.getTextureLoader().setPixelDecoder(decode);
        for (const ref of ['first', 'second']) assets.noteMeshSurface({ texture: ref });
        const [first, second] = await Promise.all(['first', 'second'].map(ref => assets.acquireTexture(ref)));
        try {
            expect(decode.mock.calls).toEqual(expect.arrayContaining([
                ['https://cdn.test/' + tail.path, true, 8], ['https://cdn.test/' + file, true, 8],
            ]));
            expect(first.value.fullWidth).toBe(128);
            expect(second.value.fullWidth).not.toBe(128);
        } finally { first.release(); second.release(); assets.releaseAll(); }
    });

    it('a material field moves to the new generation, like a texture field', async () => {
        // Every handle-bound kind — material, font, mesh, environment — follows
        // the same transaction a texture does; nothing about it is texture-shaped.
        const app = App.new();
        connectFakeCpp(app.world);
        const assets = buildAssets({ 'hero.esmaterial': MATERIAL });
        installHotUpdateRebind(app, assets);

        const before = await assets.acquireTyped<{ handle: number }>('material', 'hero.esmaterial');
        const entity = app.world.spawn();
        app.world.insert(entity, MeshRenderer, { material: before.value.handle } as never);

        assets.invalidate('hero.esmaterial');
        await settle(app);

        const after = (app.world.get(entity, MeshRenderer) as { material: number }).material;
        expect(after, 'the field kept the handle from before the update')
            .not.toBe(before.value.handle);
        const fresh = await assets.acquireTyped<{ handle: number }>('material', 'hero.esmaterial');
        expect(after, 'the field moved to something other than the published era')
            .toBe(fresh.value.handle);
    });

    it('converging is not done while a reload is still in the air', async () => {
        // The barrier a host asks about after `applyUpdate`: the asset graph has
        // caught up, and this says whether the world reading it has. Answering
        // between the queues would say yes with an acquisition in flight.
        const app = App.new();
        connectFakeCpp(app.world);
        const assets = buildAssets({ 'hero.esmaterial': MATERIAL });
        const bindings = installHotUpdateRebind(app, assets);

        const before = await assets.acquireTyped<{ handle: number }>('material', 'hero.esmaterial');
        const entity = app.world.spawn();
        app.world.insert(entity, MeshRenderer, { material: before.value.handle } as never);

        assets.invalidate('hero.esmaterial');
        let converged = false;
        void bindings.settled().then(() => { converged = true; });

        await app.tick(1 / 60);
        await Promise.resolve();
        expect(converged, 'said the world had caught up with a reload in flight').toBe(false);

        await settle(app);
        expect(converged).toBe(true);
        expect((app.world.get(entity, MeshRenderer) as { material: number }).material)
            .not.toBe(before.value.handle);
    });

    it('which kinds can be rebound is read from the loader doors', async () => {
        // A ref-bound asset has nothing to move: the field holds the name, and
        // what the name means is the slot's business.
        const assets = buildAssets();

        expect(assets.handleBoundTypes()).toContain('material');
        expect(assets.handleBoundTypes()).not.toContain('anim-clip');
        expect(assets.handleBoundTypes()).not.toContain('tilemap');
    });
});
