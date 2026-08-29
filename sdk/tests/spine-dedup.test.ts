// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-dedup.test.ts
 * @brief   S4-A: ModuleBackend shares one loaded skeleton across every entity of
 *          the same asset (keyed) and refcounts it, instead of loading a fresh
 *          skeletonData per entity. Without a key it falls back to per-entity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleBackend } from '../src/spine/ModuleBackend';
import type { SpineModuleController } from '../src/spine/SpineController';
import type { Entity } from '../src/types';
import { defineComponent, clearUserComponents } from '../src/ecs/component';
import { applySpineEntities } from '../src/spine/loadSpineScene';
import type { SceneData } from '../src/scene/scene';

function makeController() {
    let nextSkel = 1, nextInst = 100;
    return {
        loadSkeleton: vi.fn(() => nextSkel++),
        getLastError: vi.fn(() => ''),
        getAtlasPageCount: vi.fn(() => 0),
        getAtlasPageTextureName: vi.fn(() => ''),
        setAtlasPageTexture: vi.fn(),
        createInstance: vi.fn(() => nextInst++),
        destroyInstance: vi.fn(),
        removeAllListeners: vi.fn(),
        unloadSkeleton: vi.fn(),
    } as unknown as SpineModuleController & Record<string, ReturnType<typeof vi.fn>>;
}

const NO_TEX = new Map<string, { glId: number; w: number; h: number }>();

function load(b: ModuleBackend, id: number, key?: string) {
    b.loadEntity(id as Entity, new Uint8Array(), '', NO_TEX, true, key);
}

describe('ModuleBackend skeleton dedup (S4-A)', () => {
    it('shares one skeleton across entities with the same asset key', () => {
        const c = makeController();
        const b = new ModuleBackend(c as never);
        load(b, 1, 'hero');
        load(b, 2, 'hero');
        expect(c.loadSkeleton).toHaveBeenCalledTimes(1);   // one skeletonData
        expect(c.createInstance).toHaveBeenCalledTimes(2); // two instances
    });

    it('unloads the shared skeleton only when the last instance is removed', () => {
        const c = makeController();
        const b = new ModuleBackend(c as never);
        load(b, 1, 'hero');
        load(b, 2, 'hero');

        b.removeEntity(1 as Entity);
        expect(c.unloadSkeleton).not.toHaveBeenCalled(); // entity 2 still holds it

        b.removeEntity(2 as Entity);
        expect(c.unloadSkeleton).toHaveBeenCalledTimes(1); // now released
    });

    it('re-loading a live entity onto a different skeleton frees the old instance + skeleton', () => {
        const c = makeController();
        const b = new ModuleBackend(c as never);
        load(b, 1, 'hero');
        expect(c.createInstance).toHaveBeenCalledTimes(1);

        load(b, 1, 'villain'); // asset swap on the SAME entity
        expect(c.destroyInstance).toHaveBeenCalledTimes(1); // old 'hero' instance freed
        expect(c.unloadSkeleton).toHaveBeenCalledTimes(1);  // 'hero' refcount hit 0 → unloaded
        expect(c.createInstance).toHaveBeenCalledTimes(2);  // fresh 'villain' instance
        expect(c.loadSkeleton).toHaveBeenCalledTimes(2);
    });

    it('re-loading the same shared skeleton keeps it loaded (net-zero refcount), swaps the instance', () => {
        const c = makeController();
        const b = new ModuleBackend(c as never);
        load(b, 1, 'hero');
        load(b, 2, 'hero');
        load(b, 1, 'hero'); // re-load entity 1 onto the same shared skeleton
        expect(c.destroyInstance).toHaveBeenCalledTimes(1); // entity 1's old instance
        expect(c.unloadSkeleton).not.toHaveBeenCalled();    // entity 2 still holds 'hero'
        expect(c.createInstance).toHaveBeenCalledTimes(3);
        expect(c.loadSkeleton).toHaveBeenCalledTimes(1);    // still one skeletonData
    });

    it('loads a fresh skeleton per entity when no asset key is given (legacy)', () => {
        const c = makeController();
        const b = new ModuleBackend(c as never);
        load(b, 1);
        load(b, 2);
        expect(c.loadSkeleton).toHaveBeenCalledTimes(2);
    });

    it('shutdown unloads each unique skeleton once and destroys every instance', () => {
        const c = makeController();
        const b = new ModuleBackend(c as never);
        load(b, 1, 'hero');
        load(b, 2, 'hero');
        load(b, 3, 'villain');
        b.shutdown();
        expect(c.unloadSkeleton).toHaveBeenCalledTimes(2); // hero + villain, once each
        expect(c.destroyInstance).toHaveBeenCalledTimes(3); // three instances
    });
});


describe('a hot swap loads the new bytes, once', () => {
    const COMP = 'SpineHotSwap_Spine';
    beforeEach(() => {
        clearUserComponents();
        defineComponent(COMP, { skeleton: '', atlas: '' }, {
            skeletalFields: { skeletonField: 'skeleton', atlasField: 'atlas' },
        });
    });

    /** Two entities of ONE pair — what makes the shared skeleton shared. */
    const SCENE = {
        version: 1,
        entities: [1, 2].map((id) => ({
            id,
            components: [{ type: COMP, data: { skeleton: 'hero.skel', atlas: 'hero.atlas' } }],
        })),
    } as unknown as SceneData;

    /** A manager that is the real backend, so what is asserted is what the
     *  native side was actually told. */
    function managerOver(backend: ModuleBackend) {
        return {
            loadEntity: vi.fn(async (
                entity: Entity, skelData: Uint8Array | string, atlasText: string,
                textures: Map<string, { glId: number; w: number; h: number }>,
                _registry: unknown, era?: string,
            ) => {
                backend.loadEntity(entity, skelData, atlasText, textures, true, era);
                return '4.2';
            }),
            setEntityProps: vi.fn(), setSkin: vi.fn(), setAnimation: vi.fn(),
        };
    }

    function generation(era: string) {
        return new Map([['hero.skel:hero.atlas', {
            version: '4.2' as const, era, isBinary: true,
            skelData: new Uint8Array([era.length]), atlasText: era, textures: new Map(),
        }]]);
    }

    it('does not reuse the skeleton built from the era before it', async () => {
        // Two entities share one skeleton, so the update removes one reference,
        // finds the other still holding it, and hands back the skeleton the OLD
        // bytes were parsed into — with nothing reporting a failure.
        const controller = makeController();
        const backend = new ModuleBackend(controller as never);
        const spineManager = managerOver(backend);
        const entityMap = new Map([[1, 11 as Entity], [2, 12 as Entity]]);
        const apply = (era: string) => applySpineEntities({
            spineManager: spineManager as never,
            sceneData: SCENE, entityMap, registry: {} as never, assetInfo: generation(era) as never,
        });

        await apply('hero.skel:hero.atlas#1');
        expect(controller.loadSkeleton).toHaveBeenCalledTimes(1);

        await apply('hero.skel:hero.atlas#2');

        expect(controller.loadSkeleton, 'the new era was never parsed').toHaveBeenCalledTimes(2);
        expect(controller.unloadSkeleton, 'the era nobody is left in must go')
            .toHaveBeenCalledTimes(1);
        expect(controller.createInstance, 'one instance per entity per era').toHaveBeenCalledTimes(4);
    });

    it('the era its last entity leaves is the one that goes', async () => {
        // Old and new coexist while a holder of each is alive: the first entity
        // moves to the new era, the second is still posing the old one.
        const controller = makeController();
        const backend = new ModuleBackend(controller as never);
        const spineManager = managerOver(backend);
        const both = new Map([[1, 11 as Entity], [2, 12 as Entity]]);
        await applySpineEntities({
            spineManager: spineManager as never,
            sceneData: SCENE, entityMap: both, registry: {} as never,
            assetInfo: generation('era#1') as never,
        });

        // Only entity 1 moves on.
        await applySpineEntities({
            spineManager: spineManager as never,
            sceneData: SCENE, entityMap: new Map([[1, 11 as Entity]]), registry: {} as never,
            assetInfo: generation('era#2') as never,
        });

        expect(controller.unloadSkeleton, 'the old era was pulled from under entity 2')
            .not.toHaveBeenCalled();

        backend.removeEntity(12 as Entity);
        expect(controller.unloadSkeleton, 'the old era outlived its last entity')
            .toHaveBeenCalledTimes(1);
    });
});
