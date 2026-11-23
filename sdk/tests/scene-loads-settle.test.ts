// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** What a frame-stepping driver needs: which scenes are loading, and a way to wait for them. */
import { describe, it, expect, vi } from 'vitest';
import { App } from '../src/app/app';
import { SceneLoadCancelled, SceneManager } from '../src/scene/sceneManager';
import { sceneManagerPlugin } from '../src/scene/scenePlugin';
import { reservePromise } from '../src/util/reservePromise';

const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('SceneManager load tracking', () => {
    it('names a scene while it loads, and settles once it has', async () => {
        const app = App.new();
        app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager);
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        scenes.register({ name: 'level', setup: async () => { await gate; } });
        const loading = scenes.load('level');
        await Promise.resolve();
        expect(scenes.getLoading()).toEqual(['level']);
        let settled = false;
        const waiting = scenes.whenLoadsSettle().then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        release();
        await loading; await waiting;
        expect(settled).toBe(true);
        expect(scenes.getLoading()).toEqual([]);
        expect(scenes.isLoaded('level')).toBe(true);
    });

    it('tracks a queued arrival through retirement and setup, and keeps the wait snapshot', async () => {
        const app = App.new(); app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager);
        const retire = reservePromise<void>(), setup = reservePromise<void>(), later = reservePromise<void>();
        const entered = reservePromise<void>(), settle = vi.fn();
        scenes.register({ name: 'room', retire: () => retire.promise });
        await scenes.load('room');
        const leaving = scenes.unload('room', { staggered: true });
        const incoming = vi.fn(async () => { entered.resolve(); await setup.promise; });
        scenes.register({ name: 'room', setup: incoming });
        const additive = scenes.loadAdditive('room'), exclusive = scenes.load('room');
        const snapshot = scenes.whenLoadsSettle().then(settle);
        scenes.register({ name: 'later', setup: () => later.promise });
        const following = scenes.loadAdditive('later');
        try {
            expect(scenes.getLoading()).toEqual(['room', 'later']);
            expect(scenes.getSceneStatus('room')).toBe('unloading');
            await nextTurn();
            expect(settle).not.toHaveBeenCalled();
            retire.resolve(); await entered.promise;
            expect(scenes.getLoading()).toEqual(['room', 'later']);
            expect(settle).not.toHaveBeenCalled();
            setup.resolve();
            await snapshot;
            expect(await additive).toBe(await exclusive);
            expect(incoming).toHaveBeenCalledOnce();
            expect(scenes.getActive()).toBe('room');
            expect(scenes.getLoading()).toEqual(['later']);
        } finally {
            retire.resolve(); setup.resolve(); later.resolve();
            await Promise.allSettled([leaving, additive, exclusive, following, snapshot]); app.quit();
        }
    });

    it.each(['switch', 'reload'])('exposes the destination before %s calls outgoing cleanup', async mode => {
        const app = App.new(); app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager), retire = reservePromise<void>(), setup = reservePromise<void>();
        const destination = mode === 'reload' ? 'old' : 'next', settle = vi.fn();
        let names: string[] = [], observed!: Promise<void>;
        scenes.register({ name: 'old', retire: () => retire.promise, cleanup() {
            names = scenes.getLoading();
            observed = scenes.whenLoadsSettle().then(settle);
        } });
        await scenes.load('old');
        scenes.register({ name: destination, setup: () => setup.promise });
        const switched = mode === 'reload' ? scenes.reload({ staggered: true }) : scenes.switchTo(destination, { staggered: true });
        try {
            expect(names).toEqual([destination]);
            await nextTurn(); expect(settle).not.toHaveBeenCalled();
            retire.resolve(); await nextTurn();
            expect(scenes.getSceneStatus(destination)).toBe('loading');
            expect(settle).not.toHaveBeenCalled();
            setup.resolve(); await observed;
            expect(scenes.getActive()).toBe(destination);
            expect(scenes.getLoading()).toEqual([]);
        } finally { retire.resolve(); setup.resolve(); await Promise.allSettled([switched, observed]); app.quit(); }
    });

    it('settles a cancelled setup even when its external work has not returned', async () => {
        const app = App.new(); app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager), setup = reservePromise<void>();
        const retire = vi.fn(async () => {});
        scenes.register({ name: 'room', retire, setup: async ctx => {
            const partial = ctx.spawn();
            ctx.setPersistent(partial, true);
            await setup.promise; ctx.spawn();
        } });
        const cancelled = expect(scenes.load('room')).rejects.toBeInstanceOf(SceneLoadCancelled);
        const settled = vi.fn(), snapshot = scenes.whenLoadsSettle().then(settled);
        try {
            await scenes.unload('room', { staggered: true }); await nextTurn();
            expect(settled).toHaveBeenCalledOnce();
            expect(scenes.getLoading()).toEqual([]);
            expect(app.world.entityCount()).toBe(0);
            expect(retire).not.toHaveBeenCalled();
            scenes.register({ name: 'room', setup(ctx) { ctx.spawn(); } });
            const replacement = await scenes.loadAdditive('room');
            setup.resolve(); await cancelled;
            expect(scenes.getScene('room')).toBe(replacement);
            expect(app.world.entityCount()).toBe(1);
        } finally { setup.resolve(); await Promise.allSettled([cancelled, snapshot]); app.quit(); }
    });

    it('activates a scene when an exclusive caller joins an additive load', async () => {
        const app = App.new(); app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager), setup = reservePromise<void>();
        scenes.register({ name: 'old' }); await scenes.load('old');
        scenes.register({ name: 'next', setup: () => setup.promise });
        const background = scenes.loadAdditive('next');
        const switched = scenes.switchTo('next');
        try {
            await nextTurn(); setup.resolve();
            await Promise.all([background, switched]);
            expect(scenes.getActive()).toBe('next');
        } finally { setup.resolve(); await Promise.allSettled([background, switched]); app.quit(); }
    });

    it('keeps a switch snapshot on its original load when setup starts a same-name replacement', async () => {
        const app = App.new(); app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager);
        const original = reservePromise<void>(), newer = reservePromise<void>(), entered = reservePromise<void>();
        let replacement: Promise<unknown> | undefined;
        scenes.register({ name: 'old' }); await scenes.load('old');
        scenes.register({ name: 'next', setup() {
            void scenes.unload('next');
            scenes.register({ name: 'next', setup: () => newer.promise });
            replacement = scenes.loadAdditive('next');
            entered.resolve();
            return original.promise;
        } });
        const switched = expect(scenes.switchTo('next')).rejects.toBeInstanceOf(SceneLoadCancelled);
        const settled = vi.fn(), snapshot = scenes.whenLoadsSettle().then(settled);
        try {
            await entered.promise; await nextTurn();
            expect(scenes.getLoading()).toEqual(['next']);
            expect(settled).toHaveBeenCalledOnce();
        } finally {
            original.resolve(); newer.resolve();
            await Promise.all([switched, replacement, snapshot]); app.quit();
        }
    });

    it('waits for publication within a fade without waiting for either animation', async () => {
        const app = App.new(); app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager), setup = reservePromise<void>();
        scenes.register({ name: 'old' }); scenes.register({ name: 'next', setup: () => setup.promise });
        await scenes.load('old');
        const switched = scenes.switchTo('next', { transition: 'fade', duration: 2 });
        try {
            expect(scenes.getLoading()).toEqual([]);
            await scenes.whenLoadsSettle();
            scenes.updateTransition(1);
            expect(scenes.getLoading()).toEqual(['next']);
            const waiting = scenes.whenLoadsSettle();
            setup.resolve(); await waiting;
            expect(scenes.getActive()).toBe('next');
            expect(scenes.getLoading()).toEqual([]);
            expect(scenes.isTransitioning()).toBe(true);
        } finally {
            setup.resolve(); await nextTurn(); scenes.updateTransition(0); scenes.updateTransition(1);
            await switched; app.quit();
        }
    });

    it.each(['failure', 'reset'])('settles a switch on outgoing %s without starting the destination', async outcome => {
        const app = App.new(); app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager), retire = reservePromise<void>(), setup = vi.fn();
        scenes.register({ name: 'old', retire: () => retire.promise }); scenes.register({ name: 'next', setup });
        await scenes.load('old');
        const switched = scenes.switchTo('next', { staggered: true });
        const failure = new Error('retirement failed');
        const rejected = outcome === 'failure' ? expect(switched).rejects.toBe(failure)
            : expect(switched).rejects.toBeInstanceOf(SceneLoadCancelled);
        try {
            const waiting = scenes.whenLoadsSettle();
            expect(scenes.getLoading()).toEqual(['next']);
            if (outcome === 'failure') retire.reject(failure);
            else scenes.reset();
            await Promise.all([waiting, rejected]);
            expect(scenes.getLoading()).toEqual([]);
            expect(setup).not.toHaveBeenCalled();
        } finally { retire.resolve(); await Promise.allSettled([switched]); app.quit(); }
    });
});
