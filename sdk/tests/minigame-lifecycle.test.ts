// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Lifecycle on a mini-game host that is not WeChat.
 *
 * Every mini-game runs with a `document` stub (wxgame-pre.js) that has no
 * addEventListener, so the web path must never be taken from one; the host's
 * own onShow/onHide drive it, whichever vendor it is.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { App } from '../src/app/app';
import { Lifecycle, LifecyclePlugin, lifecyclePlugin } from '../src/ecs/lifecycle';
import { Input, inputPlugin } from '../src/input/input';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameKeyEvent, MiniGameProfile, MiniGameTouchEvent } from '../src/platform/minigame/api';

function vendorHost() {
    const shown: Array<() => void> = [];
    const hidden: Array<() => void> = [];
    const g = {
        onShow: (cb: () => void) => { shown.push(cb); },
        onHide: (cb: () => void) => { hidden.push(cb); },
        offShow: (cb: () => void) => { shown.splice(shown.indexOf(cb), 1); },
        offHide: (cb: () => void) => { hidden.splice(hidden.indexOf(cb), 1); },
    } as unknown as MiniGameGlobal;
    const profile = { id: 'qg', hostLabel: 'quick game', global: g } as MiniGameProfile;
    return { adapter: new MiniGamePlatformAdapter(profile), shown, hidden };
}

const realDocument = (globalThis as { document?: unknown }).document;

afterEach(() => {
    (globalThis as { document?: unknown }).document = realDocument;
    setPlatform(webAdapter);
});

describe('lifecycle on a mini-game host that is not WeChat', () => {
    it('starts a new subscription on the next event when a hide callback replaces the game', () => {
        let hide!: () => void;
        const host = { onHide: (listener: () => void) => { hide = listener; } } as MiniGameGlobal;
        const adapter = new MiniGamePlatformAdapter({ id: 'quickgame', hostLabel: 'quick game', global: host });
        const replacement = vi.fn(), closing = vi.fn();
        const off = adapter.onAppHide(() => { stopClosing(); adapter.onAppHide(replacement); off(); });
        const stopClosing = adapter.onAppHide(closing);
        hide();
        expect(closing).not.toHaveBeenCalled();
        expect(replacement).not.toHaveBeenCalled();
        hide();
        expect(replacement).toHaveBeenCalledOnce();
    });

    it('keeps one host listener per legacy event through repeated game replacement', () => {
        const shown: Array<() => void> = [], hidden: Array<() => void> = [];
        const keys: Array<(event: MiniGameKeyEvent) => void> = [];
        const touches = new Set<(event: MiniGameTouchEvent) => void>();
        const host = {
            onShow: (cb: () => void) => shown.push(cb),
            onHide: (cb: () => void) => hidden.push(cb),
            onKeyDown: (cb: (event: MiniGameKeyEvent) => void) => keys.push(cb),
            onTouchStart: (cb: (event: MiniGameTouchEvent) => void) => touches.add(cb),
            offTouchStart: (cb: (event: MiniGameTouchEvent) => void) => touches.delete(cb),
            onTouchMove() {}, offTouchMove() {}, onTouchEnd() {}, offTouchEnd() {},
        } as unknown as MiniGameGlobal;
        const start = () => {
            setPlatform(new MiniGamePlatformAdapter({ id: 'quickgame', hostLabel: 'quick game', global: host }));
            return App.new().addPlugin(inputPlugin).addPlugin(lifecyclePlugin);
        };
        let app = start();
        const oldEvents = vi.fn();
        for (let i = 0; i < 25; ++i) {
            app.getResource(Lifecycle).on(oldEvents);
            const previous = app;
            app = start();
            previous.quit();
        }
        expect([shown.length, hidden.length, keys.length, touches.size]).toEqual([1, 1, 1, 1]);
        hidden[0]();
        expect(app.isPaused()).toBe(true);
        shown[0]();
        expect(app.isPaused()).toBe(false);
        keys[0]({ code: 'KeyW' });
        for (const touch of touches) touch({ changedTouches: [{ identifier: 7, clientX: 8, clientY: 9 }] });
        const input = app.getResource(Input);
        expect(input.isKeyDown('KeyW')).toBe(true);
        expect(input.isMouseButtonDown(0)).toBe(true);
        app.quit();
        hidden[0]();
        keys[0]({ code: 'KeyW' });
        expect(app.isPaused()).toBe(false);
        expect(input.isKeyDown('KeyW')).toBe(false);
        expect(touches.size).toBe(0);
        expect(oldEvents).not.toHaveBeenCalled();
    });

    it('releases a partial host subscription without unsubscribing another App', () => {
        const host = vendorHost(), plugin = new LifecyclePlugin();
        setPlatform(host.adapter);
        const first = App.new().addPlugin(plugin);
        const error = new Error('host rejected hide');
        vi.spyOn(host.adapter, 'onAppHide').mockImplementationOnce(() => { throw error; });
        expect(() => App.new().addPlugin(plugin)).toThrow(error);
        expect([host.shown.length, host.hidden.length]).toEqual([1, 1]);
        host.hidden[0]();
        expect(first.isPaused()).toBe(true);
        first.quit();
        expect([host.shown.length, host.hidden.length]).toEqual([0, 0]);
    });

    it('builds against the document stub and pauses with the host', () => {
        (globalThis as { document?: unknown }).document = {};
        const host = vendorHost();
        setPlatform(host.adapter);
        const app = App.new();
        const plugin = new LifecyclePlugin();
        expect(() => plugin.build(app)).not.toThrow();

        host.hidden.forEach((cb) => cb());
        expect(app.isPaused()).toBe(true);
        host.shown.forEach((cb) => cb());
        expect(app.isPaused()).toBe(false);

        plugin.cleanup();
        expect(host.shown).toEqual([]);
        expect(host.hidden).toEqual([]);
    });
});
