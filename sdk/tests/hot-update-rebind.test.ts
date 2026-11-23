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
import { Assets } from '../src/asset/Assets';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import type { Backend } from '../src/asset/Backend';
import type { Entity } from '../src/types';
import { ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { installHotUpdateRebind } from '../src/hotUpdateRebind';
import { connectFakeCpp } from './helpers/fakeEngine';
import { SceneManager, SceneManagerState, type SceneContext } from '../src/scene/sceneManager';
import { AssetScope, ownedAssetLease } from '../src/asset/AssetLease';
import { Disabled, Sprite, MeshRenderer, ParticleEmitter, TrailRenderer } from '../src/ecs/component';
import { UIVisual } from '../src/ui/core/ui-visual';
import { componentsBindingAssetTypes, liveAssetBindings, visitEntityAssetBindings } from '../src/asset/liveAssetBindings';
import { migrateLiveBindings } from '../src/asset/liveAssetRebind';

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

function buildAssets(docs: Record<string, string> = {}): Assets {
    return Assets.create({
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

    it('preserves the scene receipt when the entity already holds the incoming generation', async () => {
        const { app, assets, manager } = sceneApp();
        const world = app.world;
        manager.register({ name: 'room', setup: sceneHolding(app, assets, 'shared.png', [{ component: MeshRenderer, field: 'texture' }]) });
        await manager.load('room');
        const [entity] = world.getEntitiesWithComponents([MeshRenderer]);
        const { acquire, finish } = delayNextTexture(assets);
        assets.invalidate('shared.png');
        await app.tick(1 / 60);
        const replacement = await acquire('shared.png');
        const handle = replacement.value.handle;
        const local = assets.entityScopes.ensure(world, entity);
        local.add(replacement.retain()!);
        world.update(entity, MeshRenderer, data => { data.normalMap = handle; });
        finish(replacement);
        await settle(app);

        expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: handle, normalMap: handle });
        expect(manager.assetScopeFor('room')!.bindingLease('texture', handle)).toBeDefined();
        expect([local.size, assets.sizes().refRows]).toEqual([1, 2]);
        world.despawn(entity);
        expect(pool.releaseTexture).not.toHaveBeenCalledWith(handle);
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
