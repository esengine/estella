// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AnimationPlugin } from '../src/animation/AnimationPlugin';
import { SkeletalAnimationPlugin } from '../src/animation/SkeletalAnimationPlugin';
import { registerSkeletalAnimationSupport } from '../src/animation/skeletalAnimationSupport';
import { SpriteAnimation, SpriteAnimator } from '../src/animation/SpriteAnimator';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import { Assets } from '../src/asset/AssetPlugin';
import { contentHashHex } from '../src/asset/contentHash';
import { defineComponent, MeshRenderer, Parent, SceneOwner, Sprite, TilemapLayer } from '../src/ecs/component';
import { EntityEvents } from '../src/ecs/entityEvents';
import { linearColorSpace, setLinearColorSpace } from '../src/ecs/env';
import { installHotUpdateRebind } from '../src/hotUpdateRebind';
import { Input, InputState } from '../src/input/input';
import { registerScriptGraphSupport } from '../src/logic/logicSupport';
import { ScriptGraphAgent } from '../src/logic/ScriptGraphAgent';
import { ScriptGraphPlugin } from '../src/logic/ScriptGraphPlugin';
import { initRuntime, prepareRuntimeScene, publishRuntimeScene, type RuntimeAssetSource } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene/scene';
import { SceneManager } from '../src/scene/sceneManager';
import { sceneManagerPlugin } from '../src/scene/scenePlugin';
import { Tilemaps } from '../src/tilemap/tilemapAPI';
import { TilemapPlugin } from '../src/tilemap/tilemapPlugin';
import { registerTilemapSupport } from '../src/tilemap/tilemapSupport';
import { reservePromise } from '../src/util/reservePromise';
import type { CppResourceManager } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import { connectFakeCpp } from './helpers/fakeEngine';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const file = 'art/tiles.png', clip = 'art/run.esanim', material = 'art/floor.esmaterial';
const pixel = { filterMode: 'nearest', wrapMode: 'repeat', mipmaps: false, srgb: false };
const smooth = { filterMode: 'linear', wrapMode: 'mirror', mipmaps: true };
const nearest = { filter: 0, wrap: 0 }, linear = { filter: 3, wrap: 2 };

function device() {
    const uploads = new Map<number, { filter: number; wrap: number; flip: boolean; format: number }>();
    const pool = new Map<string, number>(), releases = vi.fn();
    const rm = {
        createTextureFromBytes(_w: number, _h: number, _data: Uint8Array, format: number, flip: boolean,
            _content: number, filter: number, wrap: number) {
            const handle = uploads.size + 1;
            uploads.set(handle, { filter, wrap, flip, format });
            return handle;
        },
        getTextureDimensions: () => ({ width: 4, height: 4 }),
        getTextureGLId: (handle: number) => handle,
        registerTextureWithPath: (handle: number, key: string) => pool.set(key, handle),
        acquireTextureByPath: (key: string) => pool.get(key) ?? 0,
        invalidateTexturePath: (key: string) => pool.delete(key),
        releaseTexture: releases,
    };
    initResourceManager(rm as unknown as CppResourceManager);
    return { uploads, pool };
}

type Component = SceneData['entities'][number]['components'][number];
function document(name: string, field: Component, importer = pixel): SceneData {
    return { name, version: 4, textureImporterSettings: { [file]: importer }, entities: [
        { id: 1, name, parent: null, children: [], components: [{ type: 'Transform', data: {} }, field] },
    ] };
}
const mesh = { type: 'MeshRenderer', data: { texture: file } };
const sprite = { type: 'Sprite', data: { texture: file } };
const smoothData = { ...smooth, srgb: true };

async function game(field = sprite as Component, sourceOptions: Partial<RuntimeAssetSource> = {},
    config: { manifest?: AddressableManifest; home?: SceneData; next?: SceneData; app?: App; configure?: (app: App) => void } = {}) {
    const { uploads, pool } = device();
    const app = config.app ?? App.new();
    if (!config.app) connectFakeCpp(app.world);
    app.addPlugin(sceneManagerPlugin);
    config.configure?.(app);
    const source: RuntimeAssetSource = {
        backend: { fetchText: vi.fn(async () => JSON.stringify({ name: 'run', fps: 12, frames: [{ texture: './tiles.png' }] })),
            fetchBinary: async () => new ArrayBuffer(0), resolveUrl: path => path },
        decodePixels: vi.fn(async () => ({ width: 4, height: 4, pixels: new Uint8Array(64) })), ...sourceOptions,
    };
    const options = { app, module: null, source };
    await initRuntime({ ...options, manifest: config.manifest, firstScene: 'home', scenes: [
        { name: 'home', data: config.home ?? document('home', field) }, { name: 'next', data: config.next ?? document('next', field, smoothData) },
    ] });
    const assets = app.getResource(Assets), scenes = app.getResource(SceneManager);
    const raw = async () => {
        const lease = await assets.acquireTexture(file, false);
        const params = uploads.get(lease.value.handle);
        lease.release();
        return params;
    };
    return { app, assets, scenes, uploads, pool, options, raw, close: () => { app.quit(); shutdownResourceManager(); } };
}

describe.each([sprite, mesh])('$type scene texture imports', field => {
    it('isolates the upload for a prepared destination and shares it at handoff, including a warm native pool', async () => {
        const { assets, scenes, options, uploads, raw, close } = await game(field);
        try {
            const home = assets.getTexture(file)!.handle;
            expect(uploads.get(home)).toMatchObject(nearest);
            expect(await raw()).toMatchObject(nearest);
            await scenes.prepare('next');
            expect(assets.getTexture(file)!.handle).toBe(home);
            expect(await raw()).toMatchObject(nearest);
            expect(scenes.discardPrepared('next')).toBe(1);
            expect(await raw()).toMatchObject(nearest);

            const next = await prepareRuntimeScene({ ...options, sceneData: document('later', field, smoothData) });
            const nextHandle = next.assetResult.textureHandles.get(file)!;
            expect(nextHandle).not.toBe(home);
            expect(uploads.get(nextHandle)).toMatchObject(linear);
            await publishRuntimeScene(next);
            expect(uploads.get(home)).toMatchObject(nearest);
            expect(assets.getTexture(file)!.handle).toBe(nextHandle);
            expect(await raw()).toMatchObject(linear);
            await scenes.switchTo('next');
            expect(assets.getTexture(file)!.handle).toBe(nextHandle);
            expect(options.source.decodePixels).toHaveBeenCalledTimes(4);
        } finally { close(); }
    });
});

it('keeps the existing sampler on rejected handoff and releases a path-only load under its original profile', async () => {
    const { scenes, assets, options, uploads, raw, close } = await game();
    try {
        const old = await assets.loadTextureRaw(file);
        const ready = await prepareRuntimeScene({ ...options, sceneData: document('rejected', mesh, smoothData) }, true);
        scenes.register({ name: 'rejected', setup(ctx) {
            vi.spyOn(ctx, 'trackAssetScope').mockImplementation(() => { throw new Error('rejected handoff'); });
            return publishRuntimeScene(ready, { context: ctx });
        } });
        await expect(scenes.loadAdditive('rejected')).rejects.toThrow('rejected handoff');
        expect(await raw()).toMatchObject(nearest);
        expect(ready.assetResult.scope.size).toBe(0);
        await scenes.switchTo('next');
        const current = await assets.acquireTexture(file, false);
        expect(current.value.handle).not.toBe(old.handle);
        assets.releaseTexture(file);
        expect(assets.pathForHandle('texture', old.handle)).toBeNull();
        expect(assets.getTexture(file)).toBeDefined();
        expect(uploads.get(current.value.handle)).toMatchObject(linear);
        expect(assets.pathForHandle('texture', current.value.handle)).toBe(file);
        current.release();
    } finally { close(); }
});

it('uses the project importer for every scene, including aliases and raw uploads', async () => {
    const { assets, scenes, options, uploads, close } = await game(sprite, {
        resolveRef: ref => ref === '@uuid:sheet' ? file : ref,
        textureImportSettings: ref => ref === file ? { filter: 'linear', wrap: 'clamp', mipmaps: false } : undefined,
    });
    try {
        const before = assets.getTexture(file)!.handle;
        await scenes.prepare('next');
        await scenes.switchTo('next');
        expect(assets.getTexture(file)!.handle).toBe(before);
        expect(uploads.get(before)).toMatchObject({ filter: 1, wrap: 1 });
        expect(options.source.decodePixels).toHaveBeenCalledOnce();
        const alias = await assets.acquireTexture('@uuid:sheet', false);
        expect(uploads.get(alias.value.handle)).toMatchObject({ filter: 1, wrap: 1 });
        alias.release();
    } finally { close(); }
});

it('preserves linear data and sRGB color uploads of the same image through a prepared switch', async () => {
    const { scenes, raw, close } = await game();
    const previous = linearColorSpace();
    try {
        setLinearColorSpace(true);
        expect(await raw()).toMatchObject({ format: 1 });
        await scenes.prepare('next');
        expect(await raw()).toMatchObject({ format: 1 });
        await scenes.switchTo('next');
        expect(await raw()).toMatchObject({ format: 2 });
    } finally { setLinearColorSpace(previous); close(); }
});

it('retains both material and texture profiles and invalidates both warm uploads when their shared file changes', async () => {
    const { assets, options, uploads, pool, close } = await game();
    let id = 1000;
    const baked = new Map<number, number>();
    const materialReads = vi.fn();
    assets.register({ type: 'material', extensions: ['.esmaterial'], bindsTextures: true, async load(path, ctx) {
        materialReads(path);
        const texture = await ctx.acquireTexture(file);
        baked.set(++id, texture.value.handle);
        return { handle: id };
    }, unload() {} });
    const field = { type: 'MeshRenderer', data: { material } };
    try {
        const first = await prepareRuntimeScene({ ...options, sceneData: document('floor', field) });
        await publishRuntimeScene(first);
        const held = await assets.acquireTyped<{ handle: number }>('material', material);
        const next = await prepareRuntimeScene({ ...options, sceneData: document('other', field, smoothData) });
        const second = next.assetResult.materialHandles.get(material)!;
        expect(held.value.handle).not.toBe(second);
        expect(uploads.get(baked.get(held.value.handle)!)).toMatchObject(nearest);
        expect(uploads.get(baked.get(second)!)).toMatchObject(linear);
        await publishRuntimeScene(next);
        const current = await assets.acquireTyped<{ handle: number }>('material', material);
        expect(current.value.handle).toBe(second);
        expect(materialReads).toHaveBeenCalledTimes(2);
        expect(assets.invalidate(file)).toBe(true);
        await assets.assetGraphSettled();
        expect([...pool.keys()].filter(key => key.includes(file))).toHaveLength(0);
        const fresh = await assets.acquireTyped<{ handle: number }>('material', material);
        expect(fresh.value.handle).not.toBe(second);
        expect(uploads.get(baked.get(fresh.value.handle)!)).toMatchObject(linear);
        held.release(); current.release(); fresh.release();
    } finally { close(); }
});

it('selects named sprite clips through the publishing scene’s receipts and keeps a discarded clip private', async () => {
    defineComponent('SamplerClip', { clip: '' }, { assetFields: [{ field: 'clip', type: 'anim-clip' }] });
    const field = { type: 'SamplerClip', data: { clip } };
    const { assets, scenes, uploads, close } = await game(field);
    try {
        type Clip = { frames: { texture: number }[] };
        const visible = () => assets.resolveRegistryAsset<Clip>('anim-clip', clip)!;
        const first = visible();
        expect(uploads.get(first.frames[0].texture)).toMatchObject(nearest);
        await scenes.prepare('next');
        expect(visible()).toBe(first);
        expect(assets.publishedRegistryAssets('anim-clip')).toEqual([first]);
        scenes.discardPrepared('next');
        expect(visible()).toBe(first);
        await scenes.switchTo('next');
        expect(visible()).not.toBe(first);
        expect(uploads.get(visible().frames[0].texture)).toMatchObject(linear);
    } finally { close(); }
});

it('uses the original defaults for a dependency requested after another scene publishes', async () => {
    const home = document('home', sprite);
    delete home.textureImporterSettings;
    const { assets, scenes, raw, uploads, close } = await game(sprite, {}, { home });
    const started = reservePromise<void>(), resume = reservePromise<void>();
    try {
        const before = await raw();
        assets.register({ type: 'material', bindsTextures: true, extensions: [], async load(_path, ctx) {
            started.resolve();
            await resume.promise;
            return { handle: (await ctx.acquireTexture(file, false)).value.handle };
        }, unload() {} });
        const pending = assets.acquireTyped<{ handle: number }>('material', material);
        await started.promise;
        await scenes.switchTo('next');
        expect(await raw()).toMatchObject(linear);
        resume.resolve();
        const held = await pending;
        expect(uploads.get(held.value.handle)).toEqual(before);
        held.release();
    } finally { resume.resolve(); close(); }
});

it('keeps a clip private when the destination inherits its texture settings', async () => {
    defineComponent('InheritedSamplerClip', { clip: '' }, { assetFields: [{ field: 'clip', type: 'anim-clip' }] });
    const next = document('next', { type: 'InheritedSamplerClip', data: { clip } });
    delete next.textureImporterSettings;
    const { assets, scenes, close } = await game(sprite, {}, { next });
    try {
        await scenes.prepare('next');
        expect(assets.resolveRegistryAsset('anim-clip', clip)).toBeUndefined();
        scenes.discardPrepared('next');
        expect(assets.publishedRegistryAssets('anim-clip')).toEqual([]);
        await scenes.switchTo('next');
        expect(assets.resolveRegistryAsset('anim-clip', clip)).toBeDefined();
    } finally { close(); }
});

it('plays each additive scene’s own clip through a prepared load, hot refresh and unload', async () => {
    const animated = (name: string, settings: typeof pixel) => {
        const scene = document(name, { type: 'SpriteAnimator', data: { clip } }, settings);
        scene.entities[0].components.push({ type: 'Sprite', data: {} });
        return scene;
    };
    const { app, assets, scenes, uploads, close } = await game(sprite, {}, {
        home: animated('home', pixel), next: animated('next', smoothData),
        configure: app => app.addPlugin(new AnimationPlugin()),
    });
    try {
        const animation = app.getResource(SpriteAnimation);
        const frame = (name: string) => {
            animation.update(app.world, 1 / 60);
            const entity = app.world.findEntityByName(name)!;
            expect(app.world.get(entity, SpriteAnimator).clip).toBe(clip);
            return app.world.get(entity, Sprite).texture;
        };
        const first = frame('home');
        expect(uploads.get(first)).toMatchObject(nearest);
        await scenes.prepare('next');
        expect(frame('home')).toBe(first);
        await scenes.loadAdditive('next');
        expect(uploads.get(frame('next'))).toMatchObject(linear);
        expect(frame('home')).toBe(first);
        assets.invalidate(file);
        await assets.assetGraphSettled();
        const refreshed = frame('home');
        expect(refreshed).not.toBe(first);
        expect(uploads.get(refreshed)).toMatchObject(nearest);
        expect(uploads.get(frame('next'))).toMatchObject(linear);
        await scenes.unload('next');
        expect(frame('home')).toBe(refreshed);
    } finally { close(); }
});

it.each(['invalidate', 'manifest'])('keeps controller-owned clips live on a persistent actor through a %s update', async change => {
    registerSkeletalAnimationSupport();
    const controller = 'art/player.esanimator';
    const field = { type: 'Animator', data: { controller } };
    const home = document('home', field), next = document('next', field, smoothData);
    delete home.textureImporterSettings;
    for (const scene of [home, next]) scene.entities[0].components.push({ type: 'Sprite', data: {} });
    const key = '11111111-1111-4111-8111-111111111112';
    const manifest: AddressableManifest = { version: '2.0', groups: { main: { bundleMode: 'local', labels: [], assets: {
        [key]: { type: 'anim-clip', path: clip, address: clip, size: 1, labels: [], contentHash: contentHashHex(Uint8Array.of(1)) },
    } } } };
    const updated = structuredClone(manifest);
    updated.groups.main.assets[key].contentHash = contentHashHex(Uint8Array.of(2));
    const graph = { initialState: 'Run', parameters: [], states: [
        { name: 'Run', motion: { kind: 'sprite', clip: './run.esanim' }, transitions: [] },
    ] };
    let fps = 12;
    const { app, scenes, assets, uploads, close } = await game(sprite, { backend: {
        fetchText: async path => JSON.stringify(path.endsWith('update.json') ? updated : path.endsWith('.esanimator') ? graph
            : { fps, loop: true, frames: [{ texture: './tiles.png' }] }),
        fetchBinary: async () => Uint8Array.of(2).buffer, resolveUrl: ref => ref,
    } }, { home, next, manifest: change === 'manifest' ? manifest : undefined, configure(app) {
        app.addPlugin(new AnimationPlugin());
        app.addPlugin(new SkeletalAnimationPlugin());
    } });
    try {
        const actor = app.world.findEntityByName('home')!;
        const animation = app.getResource(SpriteAnimation);
        const handle = (entity: typeof actor) => app.world.get(entity, Sprite).texture;
        await app.tick(1 / 60);
        const first = handle(actor), defaults = uploads.get(first);
        expect(defaults).toBeDefined();
        expect(defaults).not.toMatchObject(linear);
        await scenes.loadAdditive('next');
        const other = app.world.findEntityByName('next')!;
        await app.tick(1 / 60);
        expect(handle(actor)).toBe(first);
        expect(uploads.get(handle(other))).toMatchObject(linear);
        scenes.getScene('home')!.setPersistent(actor, true);
        await scenes.unload('home');
        expect(assets.entityScopes.scopeFor(actor, app.world)?.size).toBeGreaterThan(0);
        fps = 24;
        if (change === 'manifest') {
            await assets.checkForUpdate({ manifestUrl: 'update.json' });
            expect(await assets.applyUpdate()).toMatchObject({ ok: true, updated: 1 });
        } else {
            expect(assets.invalidate(clip)).toBe(true);
        }
        await assets.assetGraphSettled();
        for (const id of [actor, other]) expect(animation.getClip(clip, id)?.fps).toBe(24);
        expect(assets.invalidate(file)).toBe(true);
        await assets.assetGraphSettled();
        await app.tick(1 / 60);
        expect(handle(actor)).not.toBe(first);
        expect(uploads.get(handle(actor))).toEqual(defaults);
        expect(uploads.get(handle(other))).toMatchObject(linear);
        await scenes.unload('next');
        await app.tick(1 / 60);
        expect(animation.getClip(clip, actor)?.frames[0].texture).toBe(handle(actor));
        app.world.despawn(actor);
        expect(assets.entityScopes.scopeFor(actor, app.world)).toBeNull();
        expect(assets.sizes().refRows).toBe(0);
    } finally { close(); }
});

it.skipIf(!HAS_WASM)('sends each painted and Tiled layer its own atlas when both scenes run and the image refreshes', async () => {
    registerTilemapSupport();
    const core = await loadWasmModule();
    const app = App.new().connectCpp(new core.Registry(), core, { ownedRegistry: true });
    const tileset = 'art/ground.estileset';
    const ground = (name: string, settings: typeof pixel) => {
        const scene = document(name, { type: 'Tilemap', data: { source: 'art/map.tmj' } }, settings);
        scene.entities.push({ id: 2, name: name + '-paint', parent: null, children: [], components: [
            { type: 'Transform', data: {} }, { type: 'TilemapLayer', data: { tilesetAssets: [tileset] } },
        ] });
        return scene;
    };
    const map = { width: 1, height: 1, tilewidth: 4, tileheight: 4,
        tilesets: [{ firstgid: 1, name: 'ground', image: 'tiles.png', columns: 1, tilecount: 1 }],
        layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [1] }] };
    const { assets, scenes, uploads, close } = await game(sprite, { backend: {
        fetchText: async ref => JSON.stringify(ref.endsWith('.tmj') ? map
            : { version: 1, texture: file, tileWidth: 4, tileHeight: 4, columns: 1, rows: 1 }),
        fetchBinary: async () => new ArrayBuffer(0), resolveUrl: ref => ref,
    } }, { app, home: ground('home', pixel), next: ground('next', smoothData), configure: app => app.addPlugin(new TilemapPlugin()) });
    try {
        const native = vi.spyOn(app.getResource(Tilemaps), 'setTilesets');
        const handles = (name: string) => {
            const parent = app.world.findEntityByName(name)!;
            const child = app.world.getEntitiesWithComponents([Parent, TilemapLayer]).find(id => app.world.get(id, Parent).entity === parent);
            const painted = app.world.findEntityByName(name + '-paint');
            const calls = [...native.mock.calls].reverse();
            return [painted, child].map(id => calls.find(([layer]) => layer === id)?.[1][0]?.textureHandle);
        };
        await app.tick(1 / 60);
        await scenes.loadAdditive('next');
        await app.tick(1 / 60);
        const before = handles('home');
        const sampling = (name: string) => handles(name).map(id => id && uploads.get(id));
        expect(sampling('home')).toMatchObject([nearest, nearest]);
        expect(sampling('next')).toMatchObject([linear, linear]);
        // A spawned instance can acquire an already-loaded atlas without publishing a name.
        const painted = app.world.findEntityByName('home-paint')!;
        const owned = assets.entityScopes.ensure(app.world, painted);
        const alternate = await assets.acquireTyped('tileset', tileset);
        owned.add(alternate);
        await app.tick(1 / 60);
        expect(sampling('home')).toMatchObject([linear, nearest]);
        owned.releaseAll();
        await app.tick(1 / 60);
        expect(sampling('home')).toMatchObject([nearest, nearest]);
        expect(assets.invalidate(file)).toBe(true);
        await assets.assetGraphSettled();
        await app.tick(1 / 60);
        expect(handles('home').every((id, i) => id !== before[i])).toBe(true);
        expect(sampling('home')).toMatchObject([nearest, nearest]);
        expect(sampling('next')).toMatchObject([linear, linear]);
    } finally { close(); }
});

it.skipIf(!HAS_WASM)('spawns direct and called graph prefabs with the agent’s sampler and scene lifetime', async () => {
    registerScriptGraphSupport();
    const core = await loadWasmModule();
    const app = App.new().connectCpp(new core.Registry(), core, { ownedRegistry: true });
    const graph = 'logic/main.esgraph', callee = 'logic/effect.esgraph', prefab = 'art/effect.esprefab';
    const wire = (from: string, to: string) => ({ id: from + '-' + to, from, fromPort: 'then', to, toPort: '' });
    const spawn = { id: 'spawn', kind: 'entity.spawn', literals: { prefab } };
    const docs = new Map<string, unknown>([
        [graph, { version: '1.0', nodes: [
            { id: 'start', kind: 'event.start' },
            { id: 'direct', kind: 'event.on', literals: { type: 'direct' } }, spawn,
            { id: 'nested', kind: 'event.on', literals: { type: 'nested' } },
            { id: 'call', kind: 'graph.call', literals: { graph: callee } },
        ], edges: [wire('start', 'call'), wire('direct', 'spawn'), wire('nested', 'call')] }],
        [callee, { version: '1.0', nodes: [{ id: 'in', kind: 'graph.input' }, spawn], edges: [wire('in', 'spawn')] }],
        [prefab, { version: '2', name: 'Effect', rootEntityId: 'root', entities: [
            { prefabEntityId: 'root', name: 'Effect', parent: null, children: ['child'], visible: true,
                components: [{ type: 'Transform', data: {} }, sprite] },
            { prefabEntityId: 'child', name: 'Glow', parent: 'root', children: [], visible: true,
                components: [{ type: 'Transform', data: {} }, mesh] },
        ] }],
    ]);
    const field = { type: 'ScriptGraphAgent', data: { graph } };
    const { assets, scenes, uploads, close } = await game(field, { backend: {
        resolveUrl: path => path, fetchBinary: async () => new ArrayBuffer(0),
        fetchText: async path => { if (!docs.has(path)) throw new Error(path); return JSON.stringify(docs.get(path)); },
    } }, { app, configure(app) { app.insertResource(Input, new InputState()); app.addPlugin(new ScriptGraphPlugin()); } });
    try {
        const emit = (name: string, event: string, owner: string | null = name) => {
            const before = new Set(app.world.getEntitiesWithComponents([Sprite]));
            app.getResource(EntityEvents).emit(app.world.findEntityByName(name)!, event);
            const roots = app.world.getEntitiesWithComponents([Sprite]).filter(entity => !before.has(entity));
            expect(roots).toHaveLength(1);
            const [root] = roots;
            const child = app.world.getEntitiesWithComponents([MeshRenderer]).find(entity => app.world.get(entity, Parent).entity === root)!;
            expect(child).toBeDefined();
            const texture = app.world.get(root, Sprite).texture;
            for (const entity of [root, child]) expect(app.world.tryGet(entity, SceneOwner)?.scene ?? null).toBe(owner);
            for (const handle of [texture, app.world.get(child, MeshRenderer).texture]) {
                expect(uploads.get(handle)).toMatchObject(name === 'home' ? nearest : linear);
            }
            return { root, child, texture };
        };
        await app.tick(1 / 60);
        await scenes.prepare('next');
        const first = emit('home', 'direct');
        await scenes.loadAdditive('next');
        await app.tick(1 / 60);
        const started = [...scenes.getScene('next')!.entities].filter(entity => app.world.has(entity, Sprite));
        expect(started).toHaveLength(1);
        expect(uploads.get(app.world.get(started[0], Sprite).texture)).toMatchObject(linear);
        const other = emit('next', 'nested');
        expect(emit('home', 'nested').texture).toBe(first.texture);
        expect(emit('next', 'direct').texture).toBe(other.texture);
        assets.invalidate(file);
        await assets.assetGraphSettled();
        const refreshed = emit('home', 'direct');
        expect(refreshed.texture).not.toBe(first.texture);
        expect(emit('home', 'nested').texture).toBe(refreshed.texture);
        scenes.getScene('home')!.adopt(app.world.findEntityByName('next')!);
        const moved = emit('next', 'nested', 'home');
        await scenes.unload('next');
        for (const entity of [other.root, other.child]) expect(app.world.valid(entity)).toBe(false);
        expect(app.world.valid(moved.root)).toBe(true);
        const actor = app.world.findEntityByName('home')!;
        scenes.getScene('home')!.setPersistent(actor, true);
        await scenes.unload('home');
        expect(app.world.getEntitiesWithComponents([Sprite])).toHaveLength(0);
        expect(app.world.getEntitiesWithComponents([MeshRenderer])).toHaveLength(0);
        const unowned = emit('home', 'direct', null);
        app.world.despawn(unowned.root);
        app.world.set(actor, ScriptGraphAgent, { graph: '' });
        app.getResource(EntityEvents).emit(actor, 'direct');
        expect(app.world.getEntitiesWithComponents([Sprite])).toHaveLength(0);
        app.world.despawn(actor);
        expect(assets.sizes().refRows).toBe(0);
    } finally { close(); }
});

it('finishes a clip load that started before the first scene sampler took its public name', async () => {
    defineComponent('LateSamplerClip', { clip: '' }, { assetFields: [{ field: 'clip', type: 'anim-clip' }] });
    const home = document('home', sprite);
    delete home.textureImporterSettings;
    const next = document('next', { type: 'LateSamplerClip', data: { clip } }, smoothData);
    const started = reservePromise<void>(), resume = reservePromise<void>();
    const read = async () => JSON.stringify({ fps: 12, frames: [{ texture: './tiles.png' }] });
    const { assets, scenes, uploads, close } = await game(sprite, { backend: {
        fetchText: vi.fn(read).mockImplementationOnce(async () => { started.resolve(); await resume.promise; return read(); }),
        fetchBinary: async () => new ArrayBuffer(0), resolveUrl: ref => ref,
    } }, { home, next });
    try {
        const pending = assets.acquireTyped('anim-clip', clip);
        await started.promise;
        await scenes.loadAdditive('next');
        type Clip = { frames: { texture: number }[] };
        const active = assets.resolveRegistryAsset<Clip>('anim-clip', clip)!;
        expect(uploads.get(active.frames[0].texture)).toMatchObject(linear);
        resume.resolve();
        const old = await pending;
        expect(assets.publishedRegistryAssets('anim-clip')).toEqual([active]);
        old.release();
        expect(assets.resolveRegistryAsset('anim-clip', clip)).toBe(active);
    } finally { resume.resolve(); close(); }
});

it('retires warm sampler variants after a realm reset and rejects publication from the old realm', async () => {
    const { assets, scenes, options, pool, close } = await game();
    try {
        const prepared = await prepareRuntimeScene({ ...options, sceneData: document('warm', mesh, smoothData) }, true);
        await scenes.prepare('next');
        scenes.discardPrepared('next');
        assets.releaseAll();
        expect(() => prepared.assetResult.publishTextureImports!()).toThrow(/released/i);
        expect([...pool.keys()].filter(key => key.includes(file))).toHaveLength(2);
        expect(assets.invalidate(file)).toBe(true);
        expect([...pool.keys()].filter(key => key.includes(file))).toHaveLength(0);
    } finally { close(); }
});

it.each(['file', 'project importer'])('rebinds two live scenes after a manifest %s update', async change => {
    const key = '11111111-1111-4111-8111-111111111111';
    const manifest: AddressableManifest = { version: '2.0', groups: { main: { bundleMode: 'local', labels: [], assets: {
        [key]: { type: 'texture', path: file, address: file, contentHash: contentHashHex(Uint8Array.of(1)), size: 1, labels: [] },
    } } } };
    const next = structuredClone(manifest);
    if (change === 'file') next.groups.main.assets[key].contentHash = contentHashHex(Uint8Array.of(2));
    else next.groups.main.assets[key].textureImport = { filter: 'linear', wrap: 'clamp', mipmaps: false };
    const { app, assets, scenes, uploads, close } = await game(sprite, {
        resolveRef: ref => ref === key || ref === '@uuid:' + key ? file : ref,
        backend: { fetchText: async () => JSON.stringify(next), fetchBinary: async () => Uint8Array.of(2).buffer, resolveUrl: ref => ref },
    }, { manifest, next: document('next', mesh, smoothData) });
    try {
        installHotUpdateRebind(app, assets);
        await scenes.loadAdditive('next');
        const spriteId = app.world.findEntityByName('home')!, meshId = app.world.findEntityByName('next')!;
        const handles = () => [app.world.get(spriteId, Sprite).texture, app.world.get(meshId, MeshRenderer).texture];
        const before = handles();
        expect(before.map(h => uploads.get(h))).toMatchObject([nearest, linear]);
        await assets.checkForUpdate({ manifestUrl: 'update.json' });
        expect(await assets.applyUpdate()).toMatchObject({ ok: true, updated: 1 });
        await vi.waitFor(async () => {
            await app.tick(1 / 60);
            expect(handles().every((h, index) => h !== before[index])).toBe(true);
        });
        const [first, second] = handles();
        if (change === 'file') {
            expect([uploads.get(first), uploads.get(second)]).toMatchObject([nearest, linear]);
        } else {
            expect(first).toBe(second);
            expect(uploads.get(first)).toMatchObject({ filter: 1, wrap: 1 });
        }
    } finally { close(); }
});
