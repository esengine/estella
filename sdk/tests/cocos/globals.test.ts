// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The globals a Cocos script reads at startup: `sys`, `macro`, `Layers`, `view`, `screen`, `game`, `KeyCode`, and
 *        `resources` / `assetManager`. No engine: what is checked is the values scripts compare against and the shapes they iterate.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    Component, EventHandler, Game, KeyCode, Scheduler, Asset, director, reportFrame, Layers, Prefab, Size, View, assetManager, game, macro, resources, screen, setResourceManifest, setVisibleSize, sys, view,
    providePrefab,
} from '../../src/cocos';
import { keyCodeOf } from '../../src/cocos/inputApi';
import { setWindowPixels } from '../../src/cocos/ui/screen';

describe('sys', () => {
    it('answers in the names scripts compare against', () => {
        expect(Object.values(sys.OS)).toContain(sys.os);
        expect(Object.values(sys.Platform)).toContain(sys.platform);
        expect(sys.OS.IOS).toBe('iOS');
        expect(sys.OS.ANDROID).toBe('Android');
        expect(sys.Platform.WECHAT_GAME).not.toBe(sys.Platform.IOS);
        expect(typeof sys.isNative).toBe('boolean');
        expect(typeof sys.isBrowser).toBe('boolean');
    });

    it('keeps values in localStorage, as strings, and forgets what was removed', () => {
        sys.localStorage.setItem('k', 42 as never);
        expect(sys.localStorage.getItem('k')).toBe('42');
        sys.localStorage.removeItem('k');
        expect(sys.localStorage.getItem('k')).toBeNull();
        sys.localStorage.setItem('a', '1');
        sys.localStorage.clear();
        expect(sys.localStorage.getItem('a')).toBeNull();
    });
});

describe('macro and Layers', () => {
    it('has the constants scripts use', () => {
        expect(macro.REPEAT_FOREVER).toBe(Number.MAX_VALUE - 1);
        expect(macro.TextAlignment.CENTER).toBe(1);
        expect(macro.INVALID_INDEX).toBe(-1);
    });

    it('has Cocos\'s layer numbers, and names layers both ways', () => {
        expect(Layers.Enum.UI_2D).toBe(1 << 25);
        expect(Layers.Enum.DEFAULT).toBe(1 << 30);
        expect(Layers.nameToLayer('UI_2D')).toBe(1 << 25);
        expect(Layers.layerToName(1 << 25)).toBe('UI_2D');
        Layers.addLayer('Boss', 3);
        expect(Layers.nameToLayer('Boss')).toBe(8);
        expect(Layers.check(8 | 1, Layers.makeMaskInclude([8]))).toBe(true);
        expect(Layers.check(1, Layers.makeMaskExclude([1]))).toBe(false);
        Layers.deleteLayer(3);
        expect(Layers.nameToLayer('Boss')).toBeUndefined();
    });
});

describe('view and screen', () => {
    beforeEach(() => { setVisibleSize(960, 640); setWindowPixels(1920, 1280); });

    it('is one View', () => {
        expect(View.instance).toBe(view);
    });

    it('reports the visible size, and the design size as the visible size until one is set', () => {
        expect([view.getVisibleSize().width, view.getVisibleSize().height]).toEqual([960, 640]);
        expect(view.getDesignResolutionSize()).toEqual(new Size(960, 640));
        view.setDesignResolutionSize(750, 1334, View.ResolutionPolicy.FIXED_WIDTH);
        expect(view.getDesignResolutionSize()).toEqual(new Size(750, 1334));
        expect(view.getResolutionPolicy()).toBe(View.ResolutionPolicy.FIXED_WIDTH);
    });

    it('tells a listener when the canvas resizes, once per change', () => {
        let n = 0;
        const cb = (): void => { n++; };
        view.on('canvas-resize', cb);
        setVisibleSize(960, 640);   // unchanged
        setVisibleSize(1280, 720);
        view.off('canvas-resize', cb);
        setVisibleSize(1000, 700);
        expect(n).toBe(1);
    });

    it('gives the window in physical pixels, and the frame in CSS pixels', () => {
        expect([screen.windowSize.width, screen.windowSize.height]).toEqual([1920, 1280]);
        expect(view.getFrameSize().width).toBe(1920 / screen.devicePixelRatio);
        expect(view.getScaleX()).toBe(2);
        let seen: number[] = [];
        screen.on('window-resize', (w: number, h: number) => { seen = [w, h]; });
        setWindowPixels(800, 600);
        expect(seen).toEqual([800, 600]);
    });
});

describe('game', () => {
    it('has the event names scripts register for', () => {
        expect(Game.EVENT_HIDE).toBe('game_on_hide');
        expect(Game.EVENT_SHOW).toBe('game_on_show');
        expect(game.isInited).toBe(true);
    });

    it('emits and removes listeners like any event target', () => {
        const seen: unknown[] = [];
        const cb = (x: unknown): void => { seen.push(x); };
        game.on('custom', cb);
        game.emit('custom', 1);
        game.off('custom', cb);
        game.emit('custom', 2);
        expect(seen).toEqual([1]);
    });

    it('keeps persistent roots', () => {
        const node = {} as never;
        game.addPersistRootNode(node);
        expect(game.isPersistRootNode(node)).toBe(true);
        game.removePersistRootNode(node);
        expect(game.isPersistRootNode(node)).toBe(false);
    });
});

describe('KeyCode', () => {
    it('has the numbers of Cocos and finds them from the engine\'s key names', () => {
        expect(KeyCode.KEY_A).toBe(65);
        expect(KeyCode.SPACE).toBe(32);
        expect(KeyCode.ARROW_UP).toBe(38);
        expect(keyCodeOf('KeyW')).toBe(KeyCode.KEY_W);
        expect(keyCodeOf('ArrowLeft')).toBe(KeyCode.ARROW_LEFT);
        expect(keyCodeOf('Digit5')).toBe(KeyCode.DIGIT_5);
        expect(keyCodeOf('MediaPlay')).toBe(KeyCode.NONE);
    });

    it('gives every key its own number', () => {
        const values = Object.values(KeyCode);
        expect(new Set(values).size).toBe(values.length);
    });
});

describe('resources and assetManager', () => {
    const prepared = { ref: 'bullet.esprefab', scene: { version: 4, name: 'bullet', entities: [] } as never, rootId: 0, missing: [], release() {} };
    beforeEach(() => {
        setResourceManifest({
            resources: { 'prefab/bullet': { path: 'bullet.esprefab', kind: 'prefab' }, 'icon/gold': { path: 'gold.png', kind: 'texture' } },
            hero: { 'skin/red': { path: 'red.esprefab', kind: 'prefab' } },
        });
        providePrefab('bullet.esprefab', prepared);
        providePrefab('red.esprefab', prepared);
    });

    const load = <T>(fn: (cb: (e: Error | null, r: T) => void) => void): Promise<{ err: Error | null; result: T }> =>
        new Promise((resolve) => fn((err, result) => resolve({ err, result })));

    it('loads a prefab by its resources path, in any argument order', async () => {
        const a = await load<Prefab>((cb) => resources.load('prefab/bullet', Prefab, cb));
        expect(a.err).toBeNull();
        expect(a.result).toBeInstanceOf(Prefab);
        expect(a.result.path).toBe('bullet.esprefab');
        const b = await load<Prefab>((cb) => resources.load('prefab/bullet', (() => {}) as never, cb));
        expect(b.err).toBeNull();
        const c = await load<Prefab>((cb) => resources.load('prefab/bullet.prefab', cb));   // an extension is ignored
        expect(c.err).toBeNull();
    });

    it('loads a list of paths into a list, and a directory into everything under it that loads', async () => {
        const many = await load<Prefab[]>((cb) => resources.load(['prefab/bullet'], Prefab, cb));
        expect(Array.isArray(many.result)).toBe(true);
        const dir = await load<Prefab[]>((cb) => resources.loadDir('prefab', Prefab, cb));
        expect(dir.result.map((p) => p.path)).toEqual(['bullet.esprefab']);
    });

    it('says what is missing or not supported, instead of answering an empty asset', async () => {
        const missing = await load<unknown>((cb) => resources.load('nope', cb));
        expect(missing.err?.message).toMatch(/no asset "nope"/);
        const texture = await load<unknown>((cb) => resources.load('icon/gold', cb));
        expect(texture.err?.message).toMatch(/not supported/);
    });

    it('has bundles by name, from the manifest', async () => {
        const bundle = await load<{ name: string; load: Function }>((cb) => assetManager.loadBundle('hero', cb));
        expect(bundle.err).toBeNull();
        expect(bundle.result.name).toBe('hero');
        expect(assetManager.getBundle('hero')).toBe(bundle.result);
        const prefab = await load<Prefab>((cb) => (bundle.result as never as { load: Function }).load('skin/red', Prefab, cb));
        expect(prefab.result.path).toBe('red.esprefab');
        const unknown = await load<unknown>((cb) => assetManager.loadBundle('ghost', cb));
        expect(unknown.err?.message).toMatch(/no bundle "ghost"/);
    });

    it('has the caches scripts iterate', async () => {
        await load<Prefab>((cb) => resources.load('prefab/bullet', Prefab, cb));
        expect(assetManager.assets.count).toBeGreaterThan(0);
        let seen = 0;
        assetManager.assets.forEach(() => seen++);
        expect(seen).toBe(assetManager.assets.count);
        expect(assetManager.bundles.find((b) => b.name === 'resources')).toBe(resources);
        expect(assetManager.cacheManager.cachedFiles.count).toBe(0);
    });
});

describe('director', () => {
    it('hands out a scheduler that runs timers by target, with a delay, an interval and a repeat count', () => {
        const scheduler = director.getScheduler();
        const target = {};
        const calls: number[] = [];
        scheduler.schedule(function (this: unknown, dt) { expect(this).toBe(target); calls.push(dt); }, target, 0.5, 1, 0.25);
        reportFrame(0.2); expect(calls).toHaveLength(0);               // inside the delay
        reportFrame(0.1); expect(calls).toHaveLength(1);               // the delay ended: the first fire
        reportFrame(0.5); expect(calls).toHaveLength(2);               // one interval later: the one repeat
        reportFrame(0.5); expect(calls).toHaveLength(2);               // and no more
        expect(scheduler.isScheduled(() => {}, target)).toBe(false);
    });

    it('stops what was unscheduled, pauses by target, and scales time', () => {
        const scheduler = new Scheduler();
        const target = {};
        let n = 0;
        const tick = (): void => { n++; };
        scheduler.schedule(tick, target);
        scheduler.update(0.1); expect(n).toBe(1);
        scheduler.pauseTarget(target); scheduler.update(0.1); expect(n).toBe(1);
        scheduler.resumeTarget(target); scheduler.setTimeScale(0.5);
        let seen = 0; scheduler.unscheduleAllForTarget(target);
        scheduler.schedule((dt) => { seen = dt; }, target);
        scheduler.update(0.2); expect(seen).toBeCloseTo(0.1);
        scheduler.unscheduleAllForTarget(target); scheduler.update(0.2); expect(n).toBe(1);
    });

    it('calls update on a scheduled target, lowest priority first', () => {
        const scheduler = new Scheduler();
        const order: string[] = [];
        scheduler.scheduleUpdate({ update: () => order.push('late') }, 5);
        scheduler.scheduleUpdate({ update: () => order.push('early') }, -5);
        scheduler.update(0.016);
        expect(order).toEqual(['early', 'late']);
    });

    it('reports the frame delta to scripts', () => {
        reportFrame(0.033);
        expect(director.getDeltaTime()).toBeCloseTo(0.033);
    });
});

describe('Asset', () => {
    it('keeps a count of its holders', () => {
        const a = new Asset('x');
        expect(a.addRef()).toBe(a);
        a.addRef();
        expect(a.refCount).toBe(2);
        a.decRef();
        expect(a.refCount).toBe(1);
        a.decRef(); a.decRef();
        expect(a.refCount).toBe(0);
    });

    it('is loaded by uuid, from the manifest listing', async () => {
        setResourceManifest({ resources: { 'prefab/bullet': { path: 'bullet.esprefab', kind: 'prefab', uuid: 'abc-123' } } });
        providePrefab('bullet.esprefab', { ref: 'bullet.esprefab', scene: { version: 4, name: 'bullet', entities: [] } as never, rootId: 0, missing: [], release() {} });
        const loaded = await new Promise<{ err: Error | null; result: unknown }>((resolve) =>
            assetManager.loadAny({ uuid: 'abc-123' }, (err: Error | null, result: unknown) => resolve({ err, result })));
        expect(loaded.err).toBeNull();
        expect(loaded.result).toBeInstanceOf(Prefab);
        const missing = await new Promise<Error | null>((resolve) => assetManager.loadAny('nope', (err: Error | null) => resolve(err)));
        expect(missing?.message).toMatch(/uuid nope/);
    });
});

describe('a directory with a file the layer cannot load', () => {
    it('loads the rest: a directory of configs holds a readme too', async () => {
        setResourceManifest({
            resources: {
                'cfg/rules': { path: 'rules.esprefab', kind: 'prefab' },
                'cfg/README': { path: '', kind: 'md' },
            },
        });
        providePrefab('rules.esprefab', { ref: 'rules.esprefab', scene: { version: 4, name: 'rules', entities: [] } as never, rootId: 0, missing: [], release() {} });
        const result = await new Promise<{ err: Error | null; assets: unknown[] }>((resolve) =>
            resources.loadDir('cfg', (err: Error | null, assets: unknown[]) => resolve({ err, assets })));
        expect(result.err).toBeNull();
        expect(result.assets).toHaveLength(1);
        // named for its file, as a script keys what it loads
        expect((result.assets[0] as { name: string }).name).toBe('rules');
    });
});

describe('Component.EventHandler', () => {
    it('is the class scripts construct handlers with', () => {
        const handler = new Component.EventHandler();
        handler.handler = 'onTap';
        expect(handler).toBeInstanceOf(EventHandler);
        expect(handler.handler).toBe('onTap');
    });
});
