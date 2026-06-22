/**
 * @file    spine-dedup.test.ts
 * @brief   S4-A: ModuleBackend shares one loaded skeleton across every entity of
 *          the same asset (keyed) and refcounts it, instead of loading a fresh
 *          skeletonData per entity. Without a key it falls back to per-entity.
 */
import { describe, it, expect, vi } from 'vitest';
import { ModuleBackend } from '../src/spine/ModuleBackend';
import type { SpineModuleController } from '../src/spine/SpineController';
import type { Entity } from '../src/types';

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
