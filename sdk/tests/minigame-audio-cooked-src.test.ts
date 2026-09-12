// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    minigame-audio-cooked-src.test.ts
 * @brief   A cooked build renames `tap.wav` to `assets/<hash>.mp3`, and a
 *          mini-game player fetches its source by URL. The path the asset
 *          system preloads by is the AUTHORED one, so the URL handed to the
 *          player must come from the ref resolver — never the cache key.
 */
import { describe, it, expect, vi } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import { MiniGameAudioBackend } from '../src/audio/MiniGameAudioBackend';
import { AudioAssetLoader } from '../src/asset/loaders/AudioAssetLoader';
import type { LoadContext } from '../src/asset/AssetLoader';

function createHost() {
    const created: Array<{ src: string; play: ReturnType<typeof vi.fn> }> = [];
    const g = {
        createInnerAudioContext: () => {
            const ctx = {
                src: '', startTime: 0, autoplay: false, loop: false, obeyMuteSwitch: true,
                volume: 1, playbackRate: 1, duration: 0, currentTime: 0, paused: false,
                play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(), destroy: vi.fn(),
                onEnded: vi.fn(), offEnded: vi.fn(), onError: vi.fn(),
            };
            created.push(ctx);
            return ctx;
        },
    };
    return { g, created };
}

const COOKED = 'assets/6a1f2c.mp3';

describe('mini-game audio plays the cooked file', () => {
    it('preloaded-by-bytes clips still play the resolved URL', async () => {
        const { g, created } = createHost();
        const audio = new AudioAPI(new MiniGameAudioBackend(g as never, 'WeChat'));
        audio.setRefResolver((ref) => (ref === 'audio/tap.wav' ? COOKED : ref));

        // What AudioAssetLoader does for an AudioSource's clip field: fetch the
        // staged bytes, then hand the AUTHORED path over as the cache key.
        await audio.preloadFromData('audio/tap.wav', new ArrayBuffer(8));
        audio.playSFX('audio/tap.wav');

        expect(created).toHaveLength(1);
        expect(created[0].src).toBe(COOKED);
    });

    it('preloading by ref plays the resolved URL', async () => {
        const { g, created } = createHost();
        const audio = new AudioAPI(new MiniGameAudioBackend(g as never, 'WeChat'));
        audio.setRefResolver((ref) => (ref === 'audio/tap.wav' ? COOKED : ref));

        await audio.preload('audio/tap.wav');
        audio.playSFX('audio/tap.wav');

        expect(created).toHaveLength(1);
        expect(created[0].src).toBe(COOKED);
    });
});

describe('AudioAssetLoader on a url-delivery backend', () => {
    it('preloads the clip without reading bytes it cannot use', async () => {
        const { g, created } = createHost();
        const audio = new AudioAPI(new MiniGameAudioBackend(g as never, 'WeChat'));
        audio.setRefResolver((ref) => (ref === 'audio/tap.wav' ? COOKED : ref));
        const loadBinary = vi.fn(async () => new ArrayBuffer(8));
        const ctx = {
            getAudio: () => audio,
            catalog: { getBuildPath: (p: string) => (p === 'audio/tap.wav' ? COOKED : p) },
            loadBinary,
        } as unknown as LoadContext;

        const result = await new AudioAssetLoader(() => audio).load('audio/tap.wav', ctx);

        expect(result.bufferId).toBe('audio/tap.wav'); // addressed by the AUTHORED path
        expect(loadBinary).not.toHaveBeenCalled();
        audio.playSFX('audio/tap.wav');
        expect(created[0].src).toBe(COOKED);
    });
});
