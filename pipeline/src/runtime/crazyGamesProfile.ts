// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AdProvider, PlatformAdapter } from 'esengine';

export interface CrazyGamesData {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
export interface CrazyGamesSdk {
    init(): Promise<void>;
    user?: { submitScore(payload: { score: number; encryptedScore: string }): void | Promise<void> };
    ad: { requestAd(type: 'rewarded' | 'midgame', callbacks: {
        adStarted(): void; adFinished(): void; adError(error: unknown): void;
    }): void };
    data: CrazyGamesData;
    game: {
        loadingStart(): void; loadingStop(): void;
        settings: { muteAudio?: boolean };
        addSettingsChangeListener(listener: (settings: { muteAudio?: boolean }) => void): void;
        removeSettingsChangeListener(listener: (settings: { muteAudio?: boolean }) => void): void;
    };
}

export function crazyGamesAdProvider(sdk: CrazyGamesSdk): AdProvider {
    const unit = <T>(type: 'rewarded' | 'midgame', finish: () => T) => {
        let destroyed = false;
        return {
            preload: async () => { if (destroyed) throw new Error('CrazyGames ad unit destroyed'); },
            show: () => new Promise<T>((resolve, reject) => {
                if (destroyed) { reject(new Error('CrazyGames ad unit destroyed')); return; }
                let settled = false;
                const fail = (error: unknown) => {
                    if (settled) return; settled = true;
                    reject(error instanceof Error ? error : new Error('CrazyGames ad request failed'));
                };
                try {
                    sdk.ad.requestAd(type, {
                        adStarted() {}, // The existing Ads service already holds the takeover.
                        adFinished() {
                            if (!settled) {
                                settled = true;
                                resolve(finish());
                            }
                        },
                        adError: fail,
                    });
                } catch (error) { fail(error); }
            }),
            destroy() { destroyed = true; },
        };
    };
    return {
        createRewardedAd: () => unit('rewarded', () => ({ completed: true })),
        createInterstitialAd: () => unit('midgame', () => undefined),
    };
}

export const CRAZYGAMES_STORAGE_KEY = 'estella.storage.v1';

/** Official HTML5 wire format: random 12-byte IV followed by AES-GCM ciphertext/tag. */
export async function encryptCrazyGamesScore(score: number, encryptionKey: string, crypto: Crypto = globalThis.crypto): Promise<string> {
    if (!Number.isFinite(score)) throw new Error('Score must be finite');
    if (!/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(encryptionKey)) throw new Error('CrazyGames score encryption key must encode 32 bytes');
    const bytes = Uint8Array.from(atob(encryptionKey), char => char.charCodeAt(0));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(score)));
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv); combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
}
type StorageAdapter = Pick<PlatformAdapter, 'getStorageItem' | 'setStorageItem' | 'removeStorageItem' | 'clearStorage'>;

/** One engine-owned envelope supports prefix clearing without deleting other SDK data. */
export function crazyGamesStorage(data: CrazyGamesData | undefined): StorageAdapter {
    const requireData = (): CrazyGamesData => {
        if (!data) throw new Error('CrazyGames storage unavailable; no local fallback was written');
        return data;
    };
    const read = (): Record<string, string> => {
        const raw = requireData().getItem(CRAZYGAMES_STORAGE_KEY);
        const parsed: unknown = raw === null ? {} : JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            || Object.values(parsed).some(value => typeof value !== 'string')) {
            throw new Error('Invalid CrazyGames engine storage envelope');
        }
        return Object.assign(Object.create(null) as Record<string, string>, parsed);
    };
    const write = (values: Record<string, string>): void => {
        const value = JSON.stringify(values);
        if (new TextEncoder().encode(value).length + CRAZYGAMES_STORAGE_KEY.length > 1_000_000) {
            throw new Error('CrazyGames engine storage envelope exceeds 1 MB');
        }
        requireData().setItem(CRAZYGAMES_STORAGE_KEY, value);
    };
    return {
        getStorageItem(key) { return read()[key] ?? null; },
        setStorageItem(key, value) { const values = read(); values[key] = value; write(values); },
        removeStorageItem(key) { const values = read(); delete values[key]; write(values); },
        clearStorage(prefix) {
            const values = read();
            for (const key of Object.keys(values)) if (key.startsWith(prefix)) delete values[key];
            write(values);
        },
    };
}

export async function initializeCrazyGames(
    sdk: CrazyGamesSdk | undefined, warn: (message: string, error?: unknown) => void, timeoutMs = 10000, scoreKey?: string,
) {
    let initialized = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!sdk) warn('[CrazyGames] SDK unavailable; continuing without ads or SDK storage');
    else {
        try {
            await Promise.race([sdk.init(), new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('CrazyGames initialization timed out')), timeoutMs);
            })]);
            initialized = true;
            sdk.game.loadingStart();
        } catch (error) { warn('[CrazyGames] Initialization/loading notification failed', error); }
        finally { if (timer !== undefined) clearTimeout(timer); }
    }
    let loaded = false;
    return {
        provider: initialized && sdk ? crazyGamesAdProvider(sdk) : null,
        storage: crazyGamesStorage(initialized ? sdk?.data : undefined),
        submitScore: initialized && sdk?.user?.submitScore && scoreKey && globalThis.crypto?.subtle
            ? async (score: number): Promise<void> => {
                const encryptedScore = await encryptCrazyGamesScore(score, scoreKey);
                await sdk.user!.submitScore({ score, encryptedScore });
            } : undefined,
        onAudioMute(callback: (muted: boolean) => void): () => void {
            if (!initialized || !sdk) { callback(false); return () => {}; }
            let active = true;
            const listener = (settings: { muteAudio?: boolean }) => { if (active) callback(settings.muteAudio === true); };
            listener(sdk.game.settings);
            try { sdk.game.addSettingsChangeListener(listener); }
            catch (error) { warn('[CrazyGames] Settings listener unavailable', error); }
            return () => {
                active = false;
                try { sdk.game.removeSettingsChangeListener(listener); }
                catch (error) { warn('[CrazyGames] Settings listener cleanup failed', error); }
            };
        },
        loaded() {
            if (loaded || !initialized || !sdk) return;
            loaded = true;
            try { sdk.game.loadingStop(); } catch (error) { warn('[CrazyGames] Loading notification failed', error); }
        },
    };
}
