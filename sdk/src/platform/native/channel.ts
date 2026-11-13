// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    platform/native/channel.ts
 * @brief   The app's own native code, by name, behind the platform's
 *          {@link PlatformNativeChannel} contract; and ads over it.
 *
 * The host carries text both ways (a method name, JSON in, JSON out) so that it
 * needs no knowledge of what is being said. This is where that text becomes
 * values, and where a reason a call failed becomes an Error that names the call.
 *
 * Ads are the first thing said over the channel rather than a second bridge: an
 * ad SDK is the project's native code like any other, and the engine links none.
 * A project whose Java or Objective-C answers {@link NATIVE_ADS_SHOW} has ads;
 * one that does not has none, and `Ads.available` says so.
 */
import type {
    PlatformInterstitialAd, PlatformNativeChannel, PlatformRewardedAd, PlatformRewardedAdResult,
} from '../types';
import type { NativeChannelBridge } from './bridge';

/** Show one ad. Args `{ kind: 'rewarded' | 'interstitial', unitId }`; answers when
 *  the ad has CLOSED, with `{ completed: boolean }` for a rewarded one. */
export const NATIVE_ADS_SHOW = 'ads.show';
/** Load one ad ahead of showing it. Same args; optional for a handler to answer. */
export const NATIVE_ADS_PRELOAD = 'ads.preload';

function decode(method: string, text: string): unknown {
    if (text === '') return undefined;
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`native "${method}" answered with something that is not JSON: ${text.slice(0, 120)}`);
    }
}

export function createNativeChannel(bridge: NativeChannelBridge): PlatformNativeChannel {
    const listeners = new Map<string, Set<(data: unknown) => void>>();
    let unsubscribe: (() => void) | null = null;

    const dispatch = (name: string, payload: string): void => {
        const set = listeners.get(name);
        if (!set || set.size === 0) return;
        let data: unknown;
        try {
            data = decode(name, payload);
        } catch (error) {
            // One malformed event must not stop the others in the same frame.
            console.error(error);
            return;
        }
        // A copy: a listener may remove itself, or add another, while it runs.
        for (const handler of [...set]) handler(data);
    };

    return {
        has: (method) => bridge.has(method),
        async call(method, args) {
            const text = await bridge.call(method, args === undefined ? 'null' : JSON.stringify(args));
            return decode(method, text);
        },
        on(event, handler) {
            let set = listeners.get(event);
            if (!set) listeners.set(event, set = new Set());
            set.add(handler);
            unsubscribe ??= bridge.subscribe(dispatch);
            return () => {
                set.delete(handler);
                if (set.size === 0) listeners.delete(event);
                if (listeners.size === 0 && unsubscribe) {
                    unsubscribe();
                    unsubscribe = null;
                }
            };
        },
    };
}

/** Whether this app's native code answers for ads at all. */
export function nativeChannelHasAds(channel: PlatformNativeChannel): boolean {
    return channel.has(NATIVE_ADS_SHOW);
}

function preload(channel: PlatformNativeChannel, kind: 'rewarded' | 'interstitial', unitId: string): Promise<void> {
    // Preloading is a courtesy: a handler that only shows loads when asked to show.
    if (!channel.has(NATIVE_ADS_PRELOAD)) return Promise.resolve();
    return channel.call(NATIVE_ADS_PRELOAD, { kind, unitId }).then(() => {});
}

export function createNativeRewardedAd(channel: PlatformNativeChannel, unitId: string): PlatformRewardedAd {
    return {
        preload: () => preload(channel, 'rewarded', unitId),
        async show(): Promise<PlatformRewardedAdResult> {
            const result = await channel.call(NATIVE_ADS_SHOW, { kind: 'rewarded', unitId });
            // The reward is the game's currency: only a handler that SAYS it was
            // earned grants it. A reply with no verdict is a handler that forgot.
            return { completed: (result as { completed?: unknown } | null | undefined)?.completed === true };
        },
        // The unit lives in the app's SDK, which keeps or frees it as it sees fit.
        destroy: () => {},
    };
}

export function createNativeInterstitialAd(channel: PlatformNativeChannel, unitId: string): PlatformInterstitialAd {
    return {
        preload: () => preload(channel, 'interstitial', unitId),
        show: () => channel.call(NATIVE_ADS_SHOW, { kind: 'interstitial', unitId }).then(() => {}),
        destroy: () => {},
    };
}
