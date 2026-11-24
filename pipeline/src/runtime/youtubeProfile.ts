// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AdProvider } from 'esengine';
import { createAsyncStorage } from './asyncStorage';

export interface YouTubeSdk {
    IN_PLAYABLES_ENV: boolean;
    game: { firstFrameReady(): void; gameReady(): void; loadData(): Promise<string>; saveData(data: string): Promise<void> };
    system: {
        isAudioEnabled(): boolean;
        onAudioEnabledChange(callback: (enabled: boolean) => void): () => void;
        onPause(callback: () => void): () => void;
        onResume(callback: () => void): () => void;
    };
    ads: { requestInterstitialAd(): Promise<void>; requestRewardedAd(rewardId: string): Promise<boolean> };
    engagement: { sendScore(score: { value: number }): Promise<void> };
}

export function initializeYouTube(sdk: YouTubeSdk | undefined, warn: (message: string, error?: unknown) => void, loadTimeoutMs = 10000) {
    const active = sdk?.IN_PLAYABLES_ENV === true;
    let disposed = false, paused = false, muted = true, firstFrame = false, ready = false;
    const pauseListeners = new Set<(paused: boolean) => void>(), muteListeners = new Set<(muted: boolean) => void>();
    const waiters = new Set<{ resolve(): void; reject(error: Error): void }>(), cleanup: Array<() => void> = [];
    const requireActive = () => { if (!active || disposed) throw new Error('YouTube host service unavailable; no local fallback was written'); };
    const notify = <T>(listeners: Set<(value: T) => void>, value: T) => {
        for (const callback of [...listeners]) {
            try {
                callback(value);
            } catch (error) {
                warn('[YouTube] Host policy listener failed', error);
            }
        }
    };
    const waitActive = (): Promise<void> => {
        if (disposed) return Promise.reject(new Error('YouTube session disposed'));
        if (!paused) return Promise.resolve();
        return new Promise((resolve, reject) => { waiters.add({ resolve, reject }); });
    };
    const emitMute = () => notify(muteListeners, muted || paused);
    const storage = createAsyncStorage({
        async load() {
            requireActive(); await waitActive();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try { return await Promise.race([sdk!.game.loadData(), new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('YouTube cloud loading timed out')), loadTimeoutMs);
            })]); } finally { if (timer !== undefined) clearTimeout(timer); }
        },
        async save(data) {
            requireActive();
            // Pause is the SDK's short eviction-save window, with a smaller keepalive allowance.
            if (paused && new TextEncoder().encode(data).byteLength > 64 * 1024) throw new Error('YouTube pause save exceeds 64 KiB');
            await sdk!.game.saveData(data);
        },
    }, { maxBytes: 3 * 1024 * 1024 - 1, autoSave: true, warn: error => warn('[YouTube] Save failed; progress remains pending', error) });
    if (!active) warn('[YouTube] Outside Playables environment; host ads, scores and cloud saving disabled');
    else {
        try { muted = !sdk!.system.isAudioEnabled(); } catch (error) { warn('[YouTube] Initial audio policy unavailable; muted', error); }
        cleanup.push(sdk!.system.onAudioEnabledChange(enabled => {
            if (!disposed) {
                muted = !enabled;
                emitMute();
            }
        }));
        cleanup.push(sdk!.system.onPause(() => {
            if (disposed || paused) return; paused = true;
            emitMute(); notify(pauseListeners, true);
            if (storage.dirty) void storage.adapter.flushStorage!().catch(error => warn('[YouTube] Pause save failed', error));
        }));
        cleanup.push(sdk!.system.onResume(() => {
            if (disposed || !paused) return; paused = false;
            emitMute(); notify(pauseListeners, false);
            for (const waiter of waiters) waiter.resolve(); waiters.clear();
        }));
    }
    const unit = <T>(show: () => Promise<T>) => {
        let destroyed = false;
        return {
            async preload() { requireActive(); if (destroyed) throw new Error('YouTube ad unit destroyed'); },
            async show() { requireActive(); if (destroyed) throw new Error('YouTube ad unit destroyed'); await waitActive(); requireActive(); if (destroyed) throw new Error('YouTube ad unit destroyed'); return show(); },
            destroy() { destroyed = true; },
        };
    };
    const provider: AdProvider | null = active ? {
        createRewardedAd: id => unit(async () => ({ completed: (await sdk!.ads.requestRewardedAd(id)) === true })),
        createInterstitialAd: () => unit(() => sdk!.ads.requestInterstitialAd()),
    } : null;
    return {
        provider, storage: storage.adapter, waitActive,
        async load() {
            try {
                await storage.load();
            } catch (error) {
                warn('[YouTube] Load failed; existing progress was preserved', error);
            }
            await waitActive();
        },
        onAudioMute(callback: (muted: boolean) => void) {
            muteListeners.add(callback);
            callback(active && (muted || paused));
            return () => {
                muteListeners.delete(callback);
            };
        },
        onPause(callback: (paused: boolean) => void) {
            pauseListeners.add(callback);
            callback(paused);
            return () => {
                pauseListeners.delete(callback);
            };
        },
        submitScore: active ? async (score: number) => {
            if (!Number.isSafeInteger(score)) throw new Error('YouTube scores must be safe integers');
            await waitActive(); requireActive(); await sdk!.engagement.sendScore({ value: score });
        } : undefined,
        firstFrameReady() {
            if (firstFrame || disposed || !sdk) return;
            sdk.game.firstFrameReady(); firstFrame = true;
        },
        async gameReady() {
            await waitActive();
            if (ready || disposed || !sdk) return;
            if (!firstFrame) throw new Error('YouTube firstFrameReady must precede gameReady');
            sdk.game.gameReady(); ready = true;
        },
        dispose() {
            if (disposed) return; disposed = true;
            for (const off of cleanup) {
                try { off(); } catch (error) { warn('[YouTube] Host subscription cleanup failed', error); }
            }
            cleanup.length = 0;
            for (const waiter of waiters) waiter.reject(new Error('YouTube session disposed')); waiters.clear();
            pauseListeners.clear(); muteListeners.clear();
        },
    };
}
