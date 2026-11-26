// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { EmbeddedBackend } from '../src/asset/Backend';
import { Catalog, atlasCatalogFields } from '../src/asset/Catalog';
import { ownedAssetLease } from '../src/asset/AssetLease';
import { bindAssetReferenceTracking } from '../src/asset/assetReferenceTracking';
import { migrateLiveBindings } from '../src/asset/liveAssetRebind';
import { defineComponent, MeshRenderer, Sprite, unregisterComponent } from '../src/ecs/component';
import { setEntityVisible } from '../src/ecs/entityUtils';
import { World } from '../src/ecs/world';
import { SystemRunner } from '../src/ecs/system';
import { ResourceStorage, Time } from '../src/ecs/resource';
import { setEntityProperty } from '../src/ecs/propertyPath';
import { UIVisual } from '../src/ui/core/ui-visual';
import { markThemed } from '../src/ui/theme/theme-style';
import { DARK_TOKENS, LIGHT_TOKENS, setTheme } from '../src/ui/theme/tokens';
import { switchTheme } from '../src/ui/behavior/theme-apply';
import { UIController, controllerState } from '../src/ui/controller/ui-controller';
import { UIGear, gearBinding } from '../src/ui/controller/ui-gear';
import { createGearApplySystem } from '../src/ui/controller/gear-apply';
import { Mut, Query, QueryInstance } from '../src/ecs/query';
import { getDefaultContext } from '../src/ecs/context';
import { serializeScene } from '../src/scene/scene';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

vi.mock('../src/wasm/resourceManager', async original => ({
    ...await original<typeof import('../src/wasm/resourceManager')>(), getResourceManager: () => ({}), requireResourceManager: () => ({}),
}));

describe.skipIf(!HAS_WASM)('live asset field writes', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });

    function realm() {
        const world = new World(), registry = new core.Registry();
        world.connectCpp(registry as unknown as CppRegistry, core);
        const catalog = Catalog.fromJson({ version: 1, entries: { 'frame.png': { type: 'texture', ...atlasCatalogFields({
            frame: { x: 4, y: 0, width: 4, height: 4 }, pageWidth: 8, pageHeight: 8,
        }, 'page.png') } } });
        const assets = Assets.create({ backend: new EmbeddedBackend({}), module: core, catalog });
        let current: Assets | null = assets;
        bindAssetReferenceTracking(world, assets, () => current);
        const waiting = new Map<string, (handle: number) => void>(), released = vi.fn();
        vi.spyOn(assets, 'acquireTexture').mockImplementation(ref => new Promise(resolve => {
            waiting.set(ref, handle => resolve(ownedAssetLease(ref, 1, { handle, width: 8, height: 8 },
                () => released(ref), 'texture')));
        }));
        const preload = vi.spyOn(assets, 'preloadSceneAssets');
        const settle = async (ref: string, handle: number, batch: number) => {
            await vi.waitFor(() => expect(waiting.has(ref)).toBe(true));
            waiting.get(ref)!(handle);
            await preload.mock.results[batch]!.value;
            await Promise.resolve();
        };
        const entity = world.spawn();
        return { world, entity, assets, waiting, released, settle, unloadRealm: () => { current = null; },
            dispose() {
                for (const e of world.getAllEntities()) world.despawn(e);
                world.disconnectCpp(); registry.delete(); assets.releaseAll();
            } };
    }

    function applyGears(world: World) {
        const resources = new ResourceStorage();
        resources.insert(Time, { ...Time._default, delta: 1 / 60 });
        return new SystemRunner(world, resources).run(createGearApplySystem(world));
    }

    it.each([Sprite, MeshRenderer])('keeps a loading $_name texture through hide and show', async component => {
        const { world, entity, assets, waiting, settle, released, dispose } = realm();
        try {
            world.insert(entity, component, { texture: 'pending.png' as never });
            await vi.waitFor(() => expect(waiting.has('pending.png')).toBe(true));
            setEntityVisible(world, entity, false);
            expect(world.get(entity, component).enabled).toBe(false);
            setEntityVisible(world, entity, true);
            await settle('pending.png', 29, 0);
            expect(world.get(entity, component)).toMatchObject({ enabled: true, texture: 29 });
            expect(assets.getRefCounter()!.getTextureRefs('pending.png', world)).toEqual([entity]);
            expect(released).not.toHaveBeenCalled();
        } finally { dispose(); }
    });

    it.each(['theme', 'gear', 'property action'])('keeps a loading UI texture through a %s color edit', async source => {
        const { world, entity, assets, settle, released, dispose } = realm();
        try {
            world.insert(entity, UIVisual, { texture: 'image.png' as never, color: { r: 1, g: 1, b: 1, a: 0.5 } });
            const color = { ...LIGHT_TOKENS.colors.primary, a: 0.5 };
            if (source === 'theme') {
                markThemed(world, entity, { visual: 'primary' });
                switchTheme(world, LIGHT_TOKENS);
            } else if (source === 'gear') {
                world.insert(entity, UIController, { controllers: [controllerState('view', ['on'])] });
                world.insert(entity, UIGear, { bindings: [gearBinding('view', 'UIVisual', 'color', { on: color })] });
                await applyGears(world);
            } else {
                expect(setEntityProperty(world, entity, 'UIVisual.color.r', color.r)).toBe(true);
            }
            await settle('image.png', 29, 0);
            const visual = world.get(entity, UIVisual);
            expect(visual.color.r).toBeCloseTo(color.r);
            expect(visual.color.a).toBe(0.5);
            expect(visual.texture).toBe(29);
            expect(assets.getRefCounter()!.getTextureRefs('image.png', world)).toEqual([entity]);
            expect(released).not.toHaveBeenCalled();
        } finally { dispose(); setTheme(DARK_TOKENS); }
    });

    it.each(['gear', 'property action'])('a %s can clear one loading mesh texture and keep its normal map', async source => {
        const { world, entity, settle, dispose } = realm();
        try {
            world.insert(entity, MeshRenderer, { texture: 'shared.png' as never, normalMap: 'shared.png' as never });
            if (source === 'gear') {
                world.insert(entity, UIController, { controllers: [controllerState('view', ['off'])] });
                world.insert(entity, UIGear, { bindings: [gearBinding('view', 'MeshRenderer', 'texture', { off: 0 })] });
                await applyGears(world);
            } else {
                expect(setEntityProperty(world, entity, 'MeshRenderer.texture', 0)).toBe(true);
            }
            await settle('shared.png', 33, 0);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 0, normalMap: 33 });
        } finally { dispose(); }
    });

    it('validates a reflected assignment before superseding a pending texture', async () => {
        const { world, entity, settle, dispose } = realm();
        try {
            world.insert(entity, UIVisual, { texture: 'image.png' as never });
            expect(setEntityProperty(world, entity, 'UIVisual.color.missing', 1)).toBe(false);
            expect(() => setEntityProperty(world, entity, 'UIVisual.color.r', 'red')).toThrow(/color\.r/);
            await settle('image.png', 29, 0);
            expect(world.get(entity, UIVisual)).toMatchObject({ texture: 29, color: { r: 1 } });
        } finally { dispose(); }
    });

    for (const component of [Sprite, MeshRenderer] as const) {
        it(`${component._name} retires a published path on replacement and removal`, async () => {
            const { world, entity, assets, settle, released, dispose } = realm();
            const refs = assets.getRefCounter()!;
            try {
                world.insert(entity, component, { texture: 'old.png' as never });
                await settle('old.png', 11, 0);
                expect(refs.getTextureRefs('old.png', world)).toEqual([entity]);
                world.update(entity, component, draft => { draft.texture = 'new.png' as never; });
                await settle('new.png', 22, 1);
                expect(released.mock.calls).toEqual([['old.png']]);
                expect(assets.entityScopes.scopeFor(entity, world)?.size).toBe(1);
                expect(refs.getAllTextureRefs(world)).toEqual([{ assetPath: 'new.png', refCount: 1, entities: [entity] }]);
                world.remove(entity, component);
                expect(refs.getTotalRefRows()).toBe(0);
                await Promise.resolve();
                expect(released.mock.calls).toEqual([['old.png'], ['new.png']]);
                expect(assets.entityScopes.scopeFor(entity, world)?.size).toBe(0);
            } finally { dispose(); }
        });

        it.each([true, false])(`${component._name} publishes the latest path (old finishes first: %s)`, async oldFirst => {
            const { world, entity, released, settle, dispose } = realm();
            try {
                world.insert(entity, component, { texture: 'old.png' as never });
                world.set(entity, component, { ...world.get(entity, component), texture: 'new.png' as never });
                if (oldFirst) {
                    await settle('old.png', 11, 0);
                    expect(world.get(entity, component).texture).toBe(0);
                    await settle('new.png', 22, 1);
                } else {
                    await settle('new.png', 22, 1);
                    await settle('old.png', 11, 0);
                }
                expect(world.get(entity, component).texture).toBe(22);
                expect(released.mock.calls).toEqual([['old.png']]);
                world.despawn(entity);
                expect(released.mock.calls).toEqual([['old.png'], ['new.png']]);
            } finally { dispose(); }
        });
    }

    it.each(['empty path', 'zero handle', 'zero in update', 'removed component', 'replaced component', 'replaced realm'])(
        'discards an in-flight atlas frame on %s', async action => {
            const { world, entity, assets, settle, released, unloadRealm, dispose } = realm();
            try {
                world.insert(entity, Sprite, { texture: 'frame.png' as never });
                if (action === 'empty path') world.update(entity, Sprite, draft => { draft.texture = '' as never; });
                if (action === 'zero handle') world.set(entity, Sprite, { ...world.get(entity, Sprite), texture: 0 });
                if (action === 'zero in update') world.update(entity, Sprite, draft => { draft.texture = 0; });
                if (action === 'removed component') { world.remove(entity, Sprite); world.insert(entity, Sprite); }
                if (action === 'replaced component') world.insert(entity, Sprite);
                if (action === 'replaced realm') unloadRealm();
                await settle('frame.png', 11, 0);
                expect(world.get(entity, Sprite)).toMatchObject({ texture: 0, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 } });
                expect(assets.entityScopes.scopeFor(entity, world)).toBeNull();
                expect(released.mock.calls).toEqual([['frame.png']]);
            } finally { dispose(); }
        },
    );

    it('publishes the surviving field of an overlapping batch and retains only its receipts', async () => {
        const { world, entity, assets, waiting, released, settle, dispose } = realm();
        try {
            world.insert(entity, MeshRenderer, { texture: 'old.png' as never, normalMap: 'normal.png' as never });
            world.update(entity, MeshRenderer, draft => { draft.texture = 'new.png' as never; });
            await settle('new.png', 22, 1);
            waiting.get('old.png')!(11);
            await settle('normal.png', 33, 0);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 22, normalMap: 33 });
            expect(released.mock.calls).toEqual([['old.png']]);
            expect(assets.entityScopes.scopeFor(entity, world)?.size).toBe(2);
        } finally { dispose(); }
    });

    it('keeps shared field and explicit ownership independent across component and query edits', async () => {
        const { world, entity, assets, settle, released, dispose } = realm();
        const refs = assets.getRefCounter()!;
        try {
            world.insert(entity, MeshRenderer, { texture: 'shared.png' as never, normalMap: 'shared.png' as never });
            await settle('shared.png', 33, 0);
            const scope = assets.entityScopes.scopeFor(entity, world)!;
            const manual = scope.add(scope.leases()[0].retain()!);
            refs.addTextureRef('shared.png', entity, world);
            world.insert(entity, Sprite, { texture: 33 });
            world.resolveSetter(MeshRenderer)!(entity, { ...world.get(entity, MeshRenderer), texture: 0 });
            await Promise.resolve();
            expect(scope.size).toBe(2);
            world.remove(entity, MeshRenderer);
            await Promise.resolve();
            expect(scope.size).toBe(2);
            expect(refs.getTextureRefs('shared.png', world)).toEqual([entity]);
            refs.removeTextureRef('shared.png', entity, world);
            expect(refs.getTextureRefs('shared.png', world)).toEqual([entity]);
            refs.addTextureRef('shared.png', entity, world);
            new QueryInstance(world, Query(Mut(Sprite))).forEach((_e, sprite) => { sprite.texture = 0; });
            await Promise.resolve();
            expect(scope.leases()).toEqual([manual]);
            expect(refs.getTextureRefs('shared.png', world)).toEqual([entity]);
            expect(released).not.toHaveBeenCalled();
            scope.releaseAll();
            expect(released.mock.calls).toEqual([['shared.png']]);
            refs.removeTextureRef('shared.png', entity, world);
            expect(refs.getTotalRefRows()).toBe(0);
        } finally { dispose(); }
    });

    it('settles the final fields after synchronous rollback and after a hot replacement', async () => {
        const { world, entity, assets, released, settle, dispose } = realm();
        try {
            world.insert(entity, Sprite, { texture: 'source.png' as never });
            await settle('source.png', 12, 0);
            const scope = assets.entityScopes.scopeFor(entity, world)!;
            const replacement = ownedAssetLease('updated', 2, 25, () => released('updated'), 'texture');
            const set = world.set.bind(world);
            vi.spyOn(world, 'set').mockImplementationOnce((e, component, data) => {
                set(e, component, data);
                throw Error('observer rejected the edit');
            });
            expect(migrateLiveBindings(world, 'texture', 12, replacement, () => scope).moved).toBe(0);
            await Promise.resolve();
            expect(world.get(entity, Sprite).texture).toBe(12);
            expect(scope.size).toBe(1);
            expect(assets.getRefCounter()!.getTextureRefs('source.png', world)).toEqual([entity]);
            expect(released).not.toHaveBeenCalled();
            expect(migrateLiveBindings(world, 'texture', 12, replacement, () => scope).moved).toBe(1);
            replacement.release();
            await Promise.resolve();
            expect(scope.size).toBe(1);
            world.remove(entity, Sprite);
            await Promise.resolve();
            expect(scope.size).toBe(0);
            expect(released.mock.calls).toEqual([['source.png'], ['updated']]);
        } finally { dispose(); }
    });

    it('holds one shared generation when two components separately load the same path', async () => {
        const { world, entity, assets, released, dispose } = realm();
        const source = ownedAssetLease('shared.png', 7, { handle: 42, width: 8, height: 8 }, () => released('shared.png'), 'texture');
        vi.mocked(assets.acquireTexture).mockImplementation(async () => source.retain()!);
        try {
            world.insert(entity, Sprite, { texture: 'shared.png' as never });
            await vi.waitFor(() => expect(world.get(entity, Sprite).texture).toBe(42));
            world.insert(entity, MeshRenderer, { texture: 'shared.png' as never });
            await vi.waitFor(() => expect(world.get(entity, MeshRenderer).texture).toBe(42));
            source.release();
            const scope = assets.entityScopes.scopeFor(entity, world)!;
            expect(scope.size).toBe(1);
            world.remove(entity, Sprite);
            await Promise.resolve();
            expect(scope.size).toBe(1);
            expect(released).not.toHaveBeenCalled();
            world.remove(entity, MeshRenderer);
            await Promise.resolve();
            expect(scope.size).toBe(0);
            expect(released.mock.calls).toEqual([['shared.png']]);
        } finally { source.release(); dispose(); }
    });

    it('keeps a handle used by a stored script component across a catalogue reload', async () => {
        const { world, entity, assets, settle, released, dispose } = realm();
        const slot = defineComponent('LiveFieldReloadSlot', { texture: 0 }, { assetFields: [{ field: 'texture', type: 'texture' }] });
        try {
            world.insert(entity, Sprite, { texture: 'shared.png' as never });
            await settle('shared.png', 33, 0);
            world.insert(entity, slot, { texture: 33 });
            unregisterComponent(slot._name);
            world.remove(entity, Sprite);
            await Promise.resolve();
            expect(world.get(entity, slot).texture).toBe(33);
            expect(assets.entityScopes.scopeFor(entity, world)?.size).toBe(1);
            expect(assets.getRefCounter()!.getTextureRefs('shared.png', world)).toEqual([entity]);
            world.remove(entity, slot);
            await Promise.resolve();
            expect(released.mock.calls).toEqual([['shared.png']]);
        } finally { unregisterComponent(slot._name); dispose(); }
    });

    it('composes the atlas frame with the current authored UVs', async () => {
        const { world, entity, settle, dispose } = realm();
        try {
            world.insert(entity, Sprite, { texture: 'frame.png' as never });
            world.update(entity, Sprite, draft => { draft.uvOffset = { x: 0.25, y: 0 }; });
            await settle('frame.png', 11, 0);
            expect(world.get(entity, Sprite)).toMatchObject({ texture: 11, uvOffset: { x: 0.625, y: 0.5 } });
        } finally { dispose(); }
    });

    it('does not publish a prepared handle after the same asset service resets', async () => {
        const { world, entity, assets, waiting, settle, released, dispose } = realm();
        let ready!: () => void, resume!: () => void;
        const prepared = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
        const preload = vi.mocked(assets.preloadSceneAssets);
        preload.mockImplementationOnce(async (...args) => {
            const result = await Assets.prototype.preloadSceneAssets.apply(assets, args);
            ready(); await gate; return result;
        });
        try {
            world.insert(entity, Sprite, { texture: 'frame.png' as never });
            await vi.waitFor(() => expect(waiting.has('frame.png')).toBe(true));
            waiting.get('frame.png')!(11); await prepared;
            assets.releaseAll(); resume(); await preload.mock.results[0]!.value; await Promise.resolve();
            expect(world.get(entity, Sprite)).toMatchObject({ texture: 0, uvScale: { x: 1, y: 1 } });
            expect(released.mock.calls).toEqual([['frame.png']]); expect(assets.entityScopes.size).toBe(0);
            world.update(entity, Sprite, draft => { draft.texture = 'new.png' as never; });
            await settle('new.png', 22, 1); expect(world.get(entity, Sprite).texture).toBe(22);
        } finally { resume(); dispose(); }
    });

    it('continues a live path across a successful refresh of the same registry', async () => {
        const { world, entity, assets, settle, dispose } = realm();
        try {
            world.insert(entity, Sprite, { texture: 'old.png' as never });
            world.connectCpp(world.getCppRegistry()!, core, { strict: true });
            await settle('old.png', 11, 0);
            expect(world.get(entity, Sprite).texture).toBe(11);
            expect(assets.entityScopes.scopeFor(entity, world)?.size).toBe(1);
        } finally { dispose(); }
    });

    it('returns the receipt and preserves the authored ref for retry if conversion throws', async () => {
        const { world, entity, assets, settle, released, dispose } = realm();
        try {
            vi.spyOn(assets, 'resolveSceneAssetPaths').mockImplementationOnce(() => { throw Error('catalog changed'); });
            world.insert(entity, Sprite, { texture: 'old.png' as never });
            await settle('old.png', 11, 0);
            expect(world.get(entity, Sprite).texture).toBe(0);
            expect(released.mock.calls).toEqual([['old.png']]);
            const snapshotTexture = () => serializeScene(world).entities[0]!.components.find(c => c.type === 'Sprite')!.data.texture;
            expect(snapshotTexture()).toBe('old.png');
            world.update(entity, Sprite, draft => { draft.texture = 'old.png' as never; });
            await vi.waitFor(() => expect(assets.acquireTexture).toHaveBeenCalledTimes(2));
            await settle('old.png', 22, 1);
            expect(world.get(entity, Sprite).texture).toBe(22);
            expect(snapshotTexture()).toBe(22);
        } finally { dispose(); }
    });

    it('routes a pre-resolved query setter through the same field ordering', async () => {
        const { world, entity, released, settle, dispose } = realm();
        try {
            const write = world.resolveSetter(Sprite)!;
            world.insert(entity, Sprite, { texture: 'old.png' as never });
            write(entity, { ...world.get(entity, Sprite), texture: 'new.png' });
            await settle('new.png', 22, 1);
            await settle('old.png', 11, 0);
            expect(world.get(entity, Sprite).texture).toBe(22);
            expect(released.mock.calls).toEqual([['old.png']]);
        } finally { dispose(); }
    });

    it.each(['keep', 'clear', 'replace'])('commits a kept Mut row once and honors its subsequent edit: %s', async action => {
        const { world, entity, assets, settle, released, dispose } = realm();
        try {
            world.insert(entity, Sprite);
            const query = new QueryInstance(world, Query(Mut(Sprite)));
            let kept;
            for (const [, sprite] of query) {
                sprite.texture = 'old.png' as never;
                kept = sprite;
            }
            if (action === 'clear') kept!.texture = 0;
            if (action === 'replace') world.update(entity, Sprite, draft => { draft.texture = 'new.png' as never; });
            query.settleKeptRows();
            expect(assets.acquireTexture).toHaveBeenCalledTimes(action === 'replace' ? 2 : 1);
            await settle('old.png', 11, 0);
            if (action === 'replace') await settle('new.png', 22, 1);
            expect(world.get(entity, Sprite).texture).toBe(action === 'keep' ? 11 : action === 'clear' ? 0 : 22);
            expect(released.mock.calls).toEqual(action === 'keep' ? [] : [['old.png']]);
        } finally { dispose(); }
    });

    it('clears a pending texture through a borrowed Mut row and keeps the other pending field', async () => {
        const { world, entity, assets, waiting, settle, dispose } = realm();
        try {
            world.insert(entity, MeshRenderer, { texture: 'shared.png' as never, normalMap: 'shared.png' as never });
            new QueryInstance(world, Query(Mut(MeshRenderer))).forEach((_e, renderer) => { renderer.texture = 0; });
            await settle('shared.png', 33, 0);
            expect(waiting.size).toBe(1);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 0, normalMap: 33 });
            expect(assets.entityScopes.scopeFor(entity, world)?.size).toBe(1);
        } finally { dispose(); }
    });

    it('preserves a published handle when a kept row is committed again after the load', async () => {
        const { world, entity, assets, settle, dispose } = realm();
        try {
            world.insert(entity, Sprite);
            const query = new QueryInstance(world, Query(Mut(Sprite)));
            for (const [, sprite] of query) sprite.texture = 'old.png' as never;
            world.update(entity, Sprite, draft => { expect(structuredClone(draft).texture).toBe(0); });
            await settle('old.png', 11, 0);
            query.settleKeptRows();
            expect(world.get(entity, Sprite).texture).toBe(11);
            expect(assets.acquireTexture).toHaveBeenCalledTimes(1);
        } finally { dispose(); }
    });

    it('keeps an unsuccessful atlas frame from changing UVs beside a successful material', async () => {
        const { world, entity, assets, released, settle, dispose } = realm();
        try {
            assets.register({ type: 'material', extensions: ['.esmaterial'], load: async () => ({ handle: 33 }) });
            world.insert(entity, Sprite, { texture: 'frame.png' as never, material: 'good.esmaterial' as never });
            await settle('frame.png', 0, 0);
            expect(world.get(entity, Sprite)).toMatchObject({ texture: 0, material: 33, uvOffset: { x: 0, y: 0 } });
            expect(released.mock.calls).toEqual([['frame.png']]);
        } finally { dispose(); }
    });

    it('reserves the write before a component-added observer assigns a newer path', async () => {
        const { world, entity, waiting, settle, dispose } = realm();
        const context = getDefaultContext(), previous = context.editorBridge;
        context.editorBridge = { registerComponent() {}, onComponentAdded(e, type) {
            if (e === entity && type === 'Sprite') world.update(entity, Sprite, draft => { draft.texture = 'new.png' as never; });
        } };
        try {
            world.insert(entity, Sprite, { texture: 'old.png' as never });
            await settle('new.png', 22, 0);
            expect(world.get(entity, Sprite).texture).toBe(22);
            expect(waiting.has('old.png')).toBe(false);
        } finally { context.editorBridge = previous; dispose(); }
    });

    it('keeps the normal map when texture conversion reentrantly replaces only the color texture', async () => {
        const { world, entity, assets, waiting, released, settle, dispose } = realm();
        const convert = assets.resolveSceneAssetPaths.bind(assets);
        vi.spyOn(assets, 'resolveSceneAssetPaths').mockImplementationOnce((scene, result) => {
            world.update(entity, MeshRenderer, draft => { draft.texture = 'new.png' as never; });
            convert(scene, result);
        });
        try {
            world.insert(entity, MeshRenderer, { texture: 'old.png' as never, normalMap: 'normal.png' as never });
            await vi.waitFor(() => expect(waiting.has('normal.png')).toBe(true));
            waiting.get('old.png')!(11);
            await settle('normal.png', 33, 0);
            await settle('new.png', 22, 1);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 22, normalMap: 33 });
            expect(released.mock.calls).toEqual([['old.png']]);
        } finally { dispose(); }
    });

    it('starts only the surviving paths after an insertion observer clears one field of a mesh', async () => {
        const { world, entity, assets, settle, dispose } = realm();
        const context = getDefaultContext(), previous = context.editorBridge;
        context.editorBridge = { registerComponent() {}, onComponentAdded(e, type) {
            if (e === entity && type === 'MeshRenderer') world.update(entity, MeshRenderer, draft => { draft.texture = 0; });
        } };
        try {
            world.insert(entity, MeshRenderer, { texture: 'old.png' as never, normalMap: 'normal.png' as never });
            await settle('normal.png', 33, 0);
            expect(assets.acquireTexture).toHaveBeenCalledTimes(1);
            expect(world.get(entity, MeshRenderer)).toMatchObject({ texture: 0, normalMap: 33 });
        } finally { context.editorBridge = previous; dispose(); }
    });
});
