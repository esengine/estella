// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The mini-game adapter's ad/share family surface over a fake host
 *        global: the load/show retry dance, onClose → completed semantics
 *        (including the host that grants a reward without saying so), and
 *        capability probing on a vendor without ads.
 */
import { describe, it, expect } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameProfile, MiniGameRewardedVideoAd, MiniGameShareOptions } from '../src/platform/minigame/api';

function fakeRewarded(behavior: {
    showFailsUntilLoaded?: boolean;
    closeRes?: { isEnded: boolean } | undefined;
}): MiniGameRewardedVideoAd & { loads: number; shows: number; close(): void } {
    let closeCb: ((res?: { isEnded: boolean }) => void) | null = null;
    let loaded = !behavior.showFailsUntilLoaded;
    const ad = {
        loads: 0,
        shows: 0,
        load() { ad.loads++; loaded = true; return Promise.resolve(); },
        show() {
            ad.shows++;
            if (!loaded) return Promise.reject(new Error('no fill'));
            // The host closes the ad later; the test drives it via close().
            return Promise.resolve();
        },
        close() { closeCb?.(behavior.closeRes); },
        onLoad() {}, offLoad() {},
        onError() {}, offError() {},
        onClose(cb: (res?: { isEnded: boolean }) => void) { closeCb = cb; },
        offClose() { closeCb = null; },
    };
    return ad;
}

function adapterOver(globalPatch: Partial<MiniGameGlobal>): MiniGamePlatformAdapter {
    // The adapter touches only what a test exercises; the rest can be absent.
    const profile: MiniGameProfile = {
        id: 'wechat',
        hostLabel: 'Test',
        global: { getSystemInfoSync: () => ({ pixelRatio: 1, screenWidth: 1, screenHeight: 1, platform: 'devtools', language: 'zh_CN' }), ...globalPatch } as unknown as MiniGameGlobal,
    };
    return new MiniGamePlatformAdapter(profile);
}

describe('mini-game rewarded ads', () => {
    it('resolves completed=true when the host reports isEnded', async () => {
        const ad = fakeRewarded({ closeRes: { isEnded: true } });
        const adapter = adapterOver({ createRewardedVideoAd: () => ad });
        const unit = adapter.createRewardedAd('u')!;
        const shown = unit.show();
        ad.close();
        await expect(shown).resolves.toEqual({ completed: true });
    });

    it('resolves completed=false only on an explicit abandoned video', async () => {
        const ad = fakeRewarded({ closeRes: { isEnded: false } });
        const adapter = adapterOver({ createRewardedVideoAd: () => ad });
        const shown = adapter.createRewardedAd('u')!.show();
        ad.close();
        await expect(shown).resolves.toEqual({ completed: false });
    });

    it('treats a host that omits the close record as completed', async () => {
        const ad = fakeRewarded({ closeRes: undefined });
        const adapter = adapterOver({ createRewardedVideoAd: () => ad });
        const shown = adapter.createRewardedAd('u')!.show();
        ad.close();
        await expect(shown).resolves.toEqual({ completed: true });
    });

    it('retries the documented dance once: show → load → show', async () => {
        const ad = fakeRewarded({ showFailsUntilLoaded: true, closeRes: { isEnded: true } });
        const adapter = adapterOver({ createRewardedVideoAd: () => ad });
        const shown = adapter.createRewardedAd('u')!.show();
        // First show rejects (no fill) → load() → second show succeeds → host closes.
        await new Promise((r) => setTimeout(r, 0));
        ad.close();
        await expect(shown).resolves.toEqual({ completed: true });
        expect(ad.loads).toBe(1);
        expect(ad.shows).toBe(2);
    });

    it('answers null on a vendor without an ad API', () => {
        const adapter = adapterOver({});
        expect(adapter.createRewardedAd('u')).toBeNull();
    });
});

describe('mini-game share', () => {
    it('routes the card to the host share sheet', () => {
        const sent: MiniGameShareOptions[] = [];
        const adapter = adapterOver({ shareAppMessage: (o: MiniGameShareOptions) => { sent.push(o); } });
        adapter.share({ title: 'hi', query: 'room=7' });
        expect(sent).toEqual([{ title: 'hi', query: 'room=7' }]);
    });

    it('asks the passive provider at share time', () => {
        let provider: (() => MiniGameShareOptions) | null = null;
        const adapter = adapterOver({ onShareAppMessage: (cb: () => MiniGameShareOptions) => { provider = cb; } });
        let title = 'before';
        adapter.onShareRequest(() => ({ title }));
        title = 'after';
        expect(provider!().title).toBe('after');
    });
});
