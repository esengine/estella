// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ads.ts
 * @brief   Rewarded / interstitial ads as an engine service.
 *
 * The platform supplies the ad (wx/tt on mini-game hosts, the mock provider in
 * the editor and in tests); this layer supplies what every game otherwise
 * hand-rolls around `wx.createRewardedVideoAd` and usually gets subtly wrong:
 * the game CLOCK pauses while an ad covers the screen (a rewarded video must
 * not cost the player their run) and the audio DEVICE suspends without touching
 * any volume the user set — both restored however the ad ends, including in
 * error paths. `showRewarded` resolves with whether the reward was earned.
 */
import { defineResource } from '../ecs/resource';
import { platformCreateRewardedAd, platformCreateInterstitialAd, platformCanCreateAds } from '../platform';
import type { PlatformRewardedAd, PlatformInterstitialAd, PlatformRewardedAdResult } from '../platform/types';
import { log } from '../util/logger';

/**
 * A drop-in ad source for hosts that have none: the editor's play mode, unit
 * tests, a web dev build. `create*` mirrors the platform factories so one seam
 * serves both; {@link createMockAdProvider} is the standard implementation.
 */
export interface AdProvider {
    createRewardedAd(adUnitId: string): PlatformRewardedAd;
    createInterstitialAd(adUnitId: string): PlatformInterstitialAd;
}

export interface MockAdProviderOptions {
    /** How long the pretend ad stays "on screen" (ms). Default 600 — long
     *  enough that a broken pause/resume would be seen, short enough to iterate. */
    durationMs?: number;
    /** What `showRewarded` reports. Default true; set false to exercise the
     *  player-abandoned path. */
    completed?: boolean;
}

/** The mock ad source: resolves after a short pretend playback. The pause /
 *  audio-suspend ceremony still runs for real, so the editor exercises the
 *  exact frames a device would. */
export function createMockAdProvider(options: MockAdProviderOptions = {}): AdProvider {
    const duration = options.durationMs ?? 600;
    const completed = options.completed ?? true;
    const wait = (): Promise<void> => new Promise((r) => setTimeout(r, duration));
    return {
        createRewardedAd: (adUnitId) => ({
            preload: () => Promise.resolve(),
            show: async () => {
                log.info('services', `mock rewarded ad "${adUnitId}" (${duration}ms, completed=${completed})`);
                await wait();
                return { completed };
            },
            destroy: () => {},
        }),
        createInterstitialAd: (adUnitId) => ({
            preload: () => Promise.resolve(),
            show: async () => {
                log.info('services', `mock interstitial ad "${adUnitId}" (${duration}ms)`);
                await wait();
            },
            destroy: () => {},
        }),
    };
}

/** What the ads service asks of the app around a fullscreen takeover. Injected
 *  so the service stays a pure orchestration (and the tests stay honest). */
export interface AdsHost {
    setPaused(paused: boolean): void;
    isPaused(): boolean;
    suspendAudio(): void;
    resumeAudio(): void;
}

export class AdsAPI {
    private readonly host_: AdsHost;
    private provider_: AdProvider | null = null;
    private readonly rewarded_ = new Map<string, PlatformRewardedAd>();
    private readonly interstitials_ = new Map<string, PlatformInterstitialAd>();
    private showing_ = false;

    constructor(host: AdsHost) {
        this.host_ = host;
    }

    /** Whether SOME ad source exists here — the platform's or an installed
     *  provider. False is what a menu reads to hide its "watch ad" button. */
    get available(): boolean {
        return this.provider_ !== null || platformCanCreateAds();
    }

    /** True while an ad covers the game (the clock is paused, audio suspended). */
    get showing(): boolean {
        return this.showing_;
    }

    /**
     * Install (or clear with null) an {@link AdProvider} that answers INSTEAD of
     * the platform. The editor's play mode installs the mock; a native shell
     * with a mediation SDK installs a real one. Clearing drops cached units.
     */
    setProvider(provider: AdProvider | null): void {
        this.provider_ = provider;
        this.dropCachedUnits_();
    }

    /** Warm a rewarded unit so `showRewarded` has a fill ready. Best-effort:
     *  a preload failure only means show() pays the load. */
    preloadRewarded(adUnitId: string): Promise<void> {
        const ad = this.rewardedUnit_(adUnitId);
        return ad ? ad.preload().catch(() => {}) : Promise.resolve();
    }

    /**
     * Show a rewarded video and resolve with whether the reward was earned —
     * after the ad closed and the game is running again. Rejects when this
     * platform has no ad source (check {@link available} first) or the host
     * genuinely has no fill; the game state is restored in every path.
     */
    showRewarded(adUnitId: string): Promise<PlatformRewardedAdResult> {
        const ad = this.rewardedUnit_(adUnitId);
        if (!ad) return Promise.reject(new Error(AdsAPI.NO_SOURCE));
        return this.withTakeover_(() => ad.show());
    }

    /** Show an interstitial; resolves when it closed. Same contract as
     *  {@link showRewarded}, minus the reward. */
    showInterstitial(adUnitId: string): Promise<void> {
        const ad = this.interstitialUnit_(adUnitId);
        if (!ad) return Promise.reject(new Error(AdsAPI.NO_SOURCE));
        return this.withTakeover_(() => ad.show());
    }

    private static readonly NO_SOURCE =
        'no ad source on this platform — check Ads.available, or install a provider (the editor installs a mock in play mode)';

    /** The pause/suspend ceremony around a fullscreen takeover. A game the
     *  DEVELOPER already paused stays paused afterwards — the ceremony restores
     *  the state it found, it does not assert one. */
    private async withTakeover_<T>(show: () => Promise<T>): Promise<T> {
        const wasPaused = this.host_.isPaused();
        this.showing_ = true;
        if (!wasPaused) this.host_.setPaused(true);
        this.host_.suspendAudio();
        try {
            return await show();
        } finally {
            this.showing_ = false;
            this.host_.resumeAudio();
            if (!wasPaused) this.host_.setPaused(false);
        }
    }

    private rewardedUnit_(adUnitId: string): PlatformRewardedAd | null {
        let ad = this.rewarded_.get(adUnitId) ?? null;
        if (!ad) {
            ad = this.provider_?.createRewardedAd(adUnitId) ?? platformCreateRewardedAd(adUnitId);
            if (ad) this.rewarded_.set(adUnitId, ad);
        }
        return ad;
    }

    private interstitialUnit_(adUnitId: string): PlatformInterstitialAd | null {
        let ad = this.interstitials_.get(adUnitId) ?? null;
        if (!ad) {
            ad = this.provider_?.createInterstitialAd(adUnitId) ?? platformCreateInterstitialAd(adUnitId);
            if (ad) this.interstitials_.set(adUnitId, ad);
        }
        return ad;
    }

    private dropCachedUnits_(): void {
        for (const ad of this.rewarded_.values()) ad.destroy();
        for (const ad of this.interstitials_.values()) ad.destroy();
        this.rewarded_.clear();
        this.interstitials_.clear();
    }
}

export const Ads = defineResource<AdsAPI>(null!, 'Ads');
