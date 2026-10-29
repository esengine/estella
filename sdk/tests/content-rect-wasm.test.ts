// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ContentRect: the one rectangle world content occupies, and the sprites and texts that follow it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { App, flushPendingRegistrations } from '../src/app/app';
import { Sprite, Transform, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Text } from '../src/ui/core/text';
import { ContentRect, applyContentRect, contentRectContains, localPointInRect } from '../src/ui/core/content-rect';
import { contentRectPlugin } from '../src/ui/render/content-rect';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe('localPointInRect', () => {
    const rect = { size: { x: 20, y: 30 }, pivot: { x: 0.25, y: 0.5 } };

    it('spans from minus the pivot times the size to the far side', () => {
        // x in [-5, 15], y in [-15, 15]
        expect(localPointInRect(rect, -5, -15)).toBe(true);
        expect(localPointInRect(rect, 15, 15)).toBe(true);
        expect(localPointInRect(rect, -5.01, 0)).toBe(false);
        expect(localPointInRect(rect, 15.01, 0)).toBe(false);
        expect(localPointInRect(rect, 0, 15.01)).toBe(false);
        expect(localPointInRect(rect, 0, -15.01)).toBe(false);
    });
});

describe.skipIf(!HAS_WASM)('ContentRect on the engine', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let app: App | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => {
        app?.world.disconnectCpp();
        registry?.delete();
        app = undefined;
        registry = undefined;
    });

    function boot(): App {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        app.addPlugin(contentRectPlugin);
        flushPendingRegistrations(app);
        return app;
    }

    it('makes the sprite and text on its entity follow it, and writes nothing when they already do', () => {
        const { world } = boot();
        const e = world.spawn('node');
        world.insert(e, Transform);
        world.insert(e, ContentRect, { size: { x: 120, y: 60 }, pivot: { x: 0, y: 1 } });
        world.insert(e, Sprite, {});
        world.insert(e, Text, {});
        applyContentRect(world, e);
        const s = world.get(e, Sprite);
        expect([s.size.x, s.size.y, s.pivot.x, s.pivot.y]).toEqual([120, 60, 0, 1]);
        const t = world.get(e, Text);
        expect([t.boxWidth, t.boxHeight, t.boxPivot?.x, t.boxPivot?.y]).toEqual([120, 60, 0, 1]);
        // a second apply changes nothing (and does not need to touch the sprite)
        applyContentRect(world, e);
        expect(world.get(e, Sprite).size.x).toBe(120);
    });

    it('does nothing for an entity without a rect', () => {
        const { world } = boot();
        const e = world.spawn('plain');
        world.insert(e, Sprite, { size: { x: 7, y: 8 } });
        applyContentRect(world, e);
        expect(world.get(e, Sprite).size.x).toBe(7);
    });

    it('follows a change to the rectangle by itself, a frame later at most', async () => {
        const a = boot();
        const e = a.world.spawn('node');
        a.world.insert(e, Transform);
        a.world.insert(e, Sprite, {});
        a.world.insert(e, ContentRect, { size: { x: 50, y: 50 }, pivot: { x: 0.5, y: 0.5 } });
        await a.tick(1 / 60);
        expect(a.world.get(e, Sprite).size.x).toBe(50);
        a.world.set(e, ContentRect, { size: { x: 90, y: 40 }, pivot: { x: 0.5, y: 0.5 } });
        await a.tick(1 / 60);
        const s = a.world.get(e, Sprite);
        expect([s.size.x, s.size.y]).toEqual([90, 40]);
    });

    describe('contentRectContains', () => {
        function placed(pos: { x: number; y: number }, scale = 1, angle = 0) {
            const { world } = boot();
            const e = world.spawn('node');
            world.insert(e, Transform, {
                position: { x: pos.x, y: pos.y, z: 0 },
                scale: { x: scale, y: scale, z: 1 },
                rotation: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
            });
            world.insert(e, ContentRect, { size: { x: 40, y: 20 }, pivot: { x: 0.5, y: 0.5 } });
            return { world, e };
        }

        it('tests a world point against the rectangle where the entity stands', () => {
            const { world, e } = placed({ x: 100, y: 50 });
            expect(contentRectContains(world, e, 100, 50)).toBe(true);
            expect(contentRectContains(world, e, 119.9, 59.9)).toBe(true);
            expect(contentRectContains(world, e, 120.1, 50)).toBe(false);
            expect(contentRectContains(world, e, 100, 60.1)).toBe(false);
        });

        it('scales with the entity', () => {
            const { world, e } = placed({ x: 0, y: 0 }, 2);
            expect(contentRectContains(world, e, 39, 19)).toBe(true);
            expect(contentRectContains(world, e, 41, 0)).toBe(false);
        });

        it('turns with the entity', () => {
            const { world, e } = placed({ x: 0, y: 0 }, 1, Math.PI / 2);   // the 40 x 20 box now stands 20 wide and 40 tall
            expect(contentRectContains(world, e, 0, 19)).toBe(true);
            expect(contentRectContains(world, e, 19, 0)).toBe(false);
        });

        it('is false for an entity without a rectangle', () => {
            const { world } = boot();
            const e = world.spawn('bare');
            world.insert(e, Transform);
            expect(contentRectContains(world, e, 0, 0)).toBe(false);
        });
    });
});
