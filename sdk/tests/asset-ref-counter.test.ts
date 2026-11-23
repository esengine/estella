// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { AssetRefCounter } from '../src/asset/AssetRefCounter';
import { World } from '../src/ecs/world';

describe('AssetRefCounter', () => {
    it('counts world-local users and retires only the departing world', () => {
        const counter = new AssetRefCounter(), a = new World(), b = new World();
        const first = a.spawn(), second = b.spawn();
        expect(first).toBe(second);
        for (const world of [a, b]) {
            counter.addTextureRef('shared', first, world);
            counter.addTextureRef('shared', first, world);
            counter.addMaterialRef('material', first, world);
            counter.addFontRef('font', first, world);
        }
        expect(counter.getAllTextureRefs()).toEqual([{ assetPath: 'shared', refCount: 2, entities: [first, second] }]);
        expect(counter.getTextureRefs('shared', b)).toEqual([second]);
        expect(counter.getTotalRefCount()).toEqual({ textures: 1, materials: 1, fonts: 1 });
        expect(counter.getTotalRefRows()).toBe(6);
        counter.removeAllRefsForEntity(first);
        expect(counter.getTotalRefRows()).toBe(6);
        counter.removeMaterialRef('material', first, a);
        a.disconnectCpp();
        expect(counter.getTotalRefRows()).toBe(3);
        expect(counter.getFontRefCount('font', a)).toBe(0);
        expect(counter.getFontRefCount('font', b)).toBe(1);
        counter.removeFontRef('font', second);
        expect(counter.getFontRefCount('font')).toBe(0);
        expect(a.getStorageSizes().despawnCallbacks).toBe(0);
        b.despawn(second);
        expect(counter.getTotalRefRows()).toBe(0);
        expect(b.getStorageSizes().despawnCallbacks).toBe(0);
    });

    it('adopts legacy rows into the app world and merges records already published there', () => {
        const counter = new AssetRefCounter(), a = new World(), b = new World();
        const entity = a.spawn(); b.spawn();
        counter.addTextureRef('paint', entity);
        counter.addTextureRef('paint', entity, a);
        counter.addTextureRef('paint', entity, b);
        counter.bindDefaultWorld(a);
        counter.bindDefaultWorld(b);
        expect(counter.getTotalRefRows()).toBe(2);
        counter.removeAllRefsForEntity(entity);
        expect(counter.getTextureRefs('paint', b)).toEqual([entity]);
        counter.addFontRef('font', entity);
        counter.clear();
        expect([a, b].map(w => w.getStorageSizes().despawnCallbacks)).toEqual([0, 0]);
        counter.addFontRef('fresh', entity);
        expect(counter.getFontRefs('fresh', a)).toEqual([entity]);
        a.despawn(entity);
        expect(counter.getTotalRefRows()).toBe(0);
    });
    it('keeps bidirectional usage consistent through duplicate, partial and entity-wide removal', () => {
        const counter = new AssetRefCounter();
        counter.addTextureRef('shared', 1); counter.addTextureRef('shared', 2);
        counter.addTextureRef('own', 1); counter.addTextureRef('own', 1);
        counter.addFontRef('font', 1); counter.addMaterialRef('material', 2);
        expect(counter.getTotalRefRows()).toBe(5);
        counter.removeTextureRef('own', 1);
        counter.removeTextureRef('own', 1);
        expect(counter.getTotalRefRows()).toBe(4);
        counter.removeAllRefsForEntity(1);
        expect(counter.getTextureRefs('shared')).toEqual([2]);
        expect(counter.getFontRefs('font')).toEqual([]);
        expect(counter.getTotalRefRows()).toBe(2);
        counter.clear(); counter.removeAllRefsForEntity(2);
        counter.addTextureRef('fresh', 2);
        expect(counter.getTotalRefRows()).toBe(1);
        counter.removeAllRefsForEntity(2);
        expect(counter.getTotalRefRows()).toBe(0);
    });
    let counter: AssetRefCounter;

    beforeEach(() => {
        counter = new AssetRefCounter();
    });

    describe('texture references', () => {
        it('should track texture references', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.addTextureRef('texture1.png', 2);

            expect(counter.getTextureRefCount('texture1.png')).toBe(2);
        });

        it('should return unique entities', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.addTextureRef('texture1.png', 1);

            expect(counter.getTextureRefCount('texture1.png')).toBe(1);
        });

        it('should remove texture references', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.addTextureRef('texture1.png', 2);
            counter.removeTextureRef('texture1.png', 1);

            expect(counter.getTextureRefCount('texture1.png')).toBe(1);
            expect(counter.getTextureRefs('texture1.png')).toEqual([2]);
        });

        it('should clean up when ref count reaches zero', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.removeTextureRef('texture1.png', 1);

            expect(counter.getTextureRefCount('texture1.png')).toBe(0);
        });

        it('should get all texture references', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.addTextureRef('texture1.png', 2);
            counter.addTextureRef('texture2.png', 3);

            const refs = counter.getAllTextureRefs();
            expect(refs).toHaveLength(2);
            expect(refs[0].assetPath).toBe('texture1.png');
            expect(refs[0].refCount).toBe(2);
            expect(refs[1].assetPath).toBe('texture2.png');
            expect(refs[1].refCount).toBe(1);
        });
    });

    describe('font references', () => {
        it('should track font references', () => {
            counter.addFontRef('font1.fnt', 1);
            counter.addFontRef('font1.fnt', 2);

            expect(counter.getFontRefCount('font1.fnt')).toBe(2);
        });

        it('should remove font references', () => {
            counter.addFontRef('font1.fnt', 1);
            counter.addFontRef('font1.fnt', 2);
            counter.removeFontRef('font1.fnt', 1);

            expect(counter.getFontRefCount('font1.fnt')).toBe(1);
        });

        it('should get all font references', () => {
            counter.addFontRef('font1.fnt', 1);
            counter.addFontRef('font2.fnt', 2);

            const refs = counter.getAllFontRefs();
            expect(refs).toHaveLength(2);
        });
    });

    describe('material references', () => {
        it('should track material references', () => {
            counter.addMaterialRef('material1.mat', 1);
            counter.addMaterialRef('material1.mat', 2);

            expect(counter.getMaterialRefCount('material1.mat')).toBe(2);
        });

        it('should remove material references', () => {
            counter.addMaterialRef('material1.mat', 1);
            counter.addMaterialRef('material1.mat', 2);
            counter.removeMaterialRef('material1.mat', 1);

            expect(counter.getMaterialRefCount('material1.mat')).toBe(1);
        });

        it('should get all material references', () => {
            counter.addMaterialRef('material1.mat', 1);
            counter.addMaterialRef('material2.mat', 2);

            const refs = counter.getAllMaterialRefs();
            expect(refs).toHaveLength(2);
        });
    });

    describe('entity cleanup', () => {
        it('should remove all references for an entity', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.addTextureRef('texture2.png', 1);
            counter.addFontRef('font1.fnt', 1);
            counter.addMaterialRef('material1.mat', 1);

            counter.removeAllRefsForEntity(1);

            expect(counter.getTextureRefCount('texture1.png')).toBe(0);
            expect(counter.getTextureRefCount('texture2.png')).toBe(0);
            expect(counter.getFontRefCount('font1.fnt')).toBe(0);
            expect(counter.getMaterialRefCount('material1.mat')).toBe(0);
        });

        it('should not affect other entities', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.addTextureRef('texture1.png', 2);

            counter.removeAllRefsForEntity(1);

            expect(counter.getTextureRefCount('texture1.png')).toBe(1);
            expect(counter.getTextureRefs('texture1.png')).toEqual([2]);
        });
    });

    describe('clear', () => {
        it('should clear all references', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.addFontRef('font1.fnt', 2);
            counter.addMaterialRef('material1.mat', 3);

            counter.clear();

            expect(counter.getTextureRefCount('texture1.png')).toBe(0);
            expect(counter.getFontRefCount('font1.fnt')).toBe(0);
            expect(counter.getMaterialRefCount('material1.mat')).toBe(0);
        });
    });

    describe('total count', () => {
        it('should return total ref counts', () => {
            counter.addTextureRef('texture1.png', 1);
            counter.addTextureRef('texture2.png', 2);
            counter.addFontRef('font1.fnt', 3);
            counter.addMaterialRef('material1.mat', 4);

            const total = counter.getTotalRefCount();
            expect(total.textures).toBe(2);
            expect(total.fonts).toBe(1);
            expect(total.materials).toBe(1);
        });
    });

    describe('edge cases', () => {
        it('should handle non-existent asset', () => {
            expect(counter.getTextureRefCount('nonexistent.png')).toBe(0);
            expect(counter.getTextureRefs('nonexistent.png')).toEqual([]);
        });

        it('should handle removing from non-existent asset', () => {
            expect(() => {
                counter.removeTextureRef('nonexistent.png', 1);
            }).not.toThrow();
        });

        it('should handle duplicate additions', () => {
            counter.addTextureRef('texture.png', 1);
            counter.addTextureRef('texture.png', 1);
            counter.addTextureRef('texture.png', 1);

            expect(counter.getTextureRefCount('texture.png')).toBe(1);
        });

        it('should handle multiple entities sharing assets', () => {
            for (let i = 1; i <= 100; i++) {
                counter.addTextureRef('shared.png', i);
            }

            expect(counter.getTextureRefCount('shared.png')).toBe(100);

            for (let i = 1; i <= 50; i++) {
                counter.removeTextureRef('shared.png', i);
            }

            expect(counter.getTextureRefCount('shared.png')).toBe(50);
        });
    });
});
