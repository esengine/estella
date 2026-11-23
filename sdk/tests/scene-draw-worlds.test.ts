// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { SceneLoadCancelled, SceneManagerState } from '../src/scene/sceneManager';
import { clearDrawCallbacks, clearWorldDrawCallbacks, getDrawCallbacks, getPreSceneDrawCallbacks, getOverScreenDrawCallbacks, registerPreSceneDrawCallback, registerOverScreenDrawCallback, registerDrawCallback, unregisterDrawCallback } from '../src/render/customDraw';
import { connectFakeCpp } from './helpers/fakeEngine';

function preview() {
    const app = App.new();
    const manager = new SceneManagerState(app);
    manager.register({ name: 'map' });
    manager.register({ name: 'next' });
    return { app, manager };
}

afterEach(clearDrawCallbacks);

describe('drawing in simultaneous scene managers', () => {
    it('keeps same-name HUDs with their own world from late connection through teardown', async () => {
        const a = preview(), b = preview(), first = vi.fn(), second = vi.fn();
        try {
            (await a.manager.load('map')).registerDrawCallback('hud', first);
            (await b.manager.load('map')).registerDrawCallback('hud', second);
            connectFakeCpp(a.app.world);
            connectFakeCpp(b.app.world);
            const owners = () => [...getDrawCallbacks().values()].map(entry => [entry.fn, entry.registry, entry.scene]);
            expect.soft(owners()).toEqual([[first, a.app.world.getCppRegistry(), 'map'], [second, b.app.world.getCppRegistry(), 'map']]);
            clearWorldDrawCallbacks(a.app.world);
            await a.manager.unload('map');
            expect(owners()).toEqual([[second, b.app.world.getCppRegistry(), 'map']]);
            b.manager.reset();
            expect(getDrawCallbacks().size).toBe(0);
        } finally { a.manager.reset(); b.manager.reset(); a.app.quit(); b.app.quit(); }
    });

    it('can cancel one fade while the other world is still rendering its own fade', async () => {
        const a = preview(), b = preview();
        connectFakeCpp(a.app.world);
        connectFakeCpp(b.app.world);
        const one = expect(a.manager.switchTo('next', { transition: 'fade' })).rejects.toBeInstanceOf(SceneLoadCancelled);
        const two = expect(b.manager.switchTo('next', { transition: 'fade' })).rejects.toBeInstanceOf(SceneLoadCancelled);
        try {
            const owners = () => [...getDrawCallbacks().values()].map(entry => entry.registry);
            expect.soft(owners()).toEqual([a.app.world.getCppRegistry(), b.app.world.getCppRegistry()]);
            a.manager.reset(); await one;
            expect(owners()).toEqual([b.app.world.getCppRegistry()]);
        } finally { a.manager.reset(); b.manager.reset(); await Promise.all([one, two]); a.app.quit(); b.app.quit(); }
    });

    it('releases all three phases of a coreless app while preserving global callbacks', () => {
        const a = App.new(), b = App.new();
        for (const [register, entries] of [
            [registerPreSceneDrawCallback, getPreSceneDrawCallbacks],
            [registerDrawCallback, getDrawCallbacks],
            [registerOverScreenDrawCallback, getOverScreenDrawCallbacks],
        ] as const) {
            register('hud', vi.fn(), { world: a.world });
            register('hud', vi.fn(), { world: b.world });
            const dropGlobal = register('shared', vi.fn());
            try {
                a.quit();
                expect([...entries().values()].map(entry => entry.world)).toEqual([b.world, undefined]);
                b.quit();
                expect([...entries().values()].map(entry => entry.world)).toEqual([undefined]);
            } finally { dropGlobal(); }
        }
    });

    it('retains the public name-based replacement and removal of a scene callback in a game', async () => {
        const { app, manager } = preview(), sceneDraw = vi.fn(), globalDraw = vi.fn();
        try {
            const scene = await manager.load('map');
            registerDrawCallback('hud', globalDraw);
            scene.registerDrawCallback('hud', sceneDraw);
            const installed = () => [...getDrawCallbacks().values()].map(entry => entry.fn);
            expect(installed()).toEqual([sceneDraw]);
            registerDrawCallback('hud', globalDraw);
            expect(installed()).toEqual([globalDraw]);
            scene.registerDrawCallback('hud', sceneDraw);
            unregisterDrawCallback('hud');
            expect(installed()).toEqual([]);
        } finally { manager.reset(); app.quit(); }
    });
});
