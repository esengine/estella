// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Lifecycle on a mini-game host that is not WeChat.
 *
 * Every mini-game runs with a `document` stub (wxgame-pre.js) that has no
 * addEventListener, so the web path must never be taken from one; the host's
 * own onShow/onHide drive it, whichever vendor it is.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { App } from '../src/app/app';
import { LifecyclePlugin } from '../src/ecs/lifecycle';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame/api';

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
