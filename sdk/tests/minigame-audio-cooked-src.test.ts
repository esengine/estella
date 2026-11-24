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
    const created: Array<{ src: string; startTime: number; play: ReturnType<typeof vi.fn> }> = [];
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
    it('keeps each reference’s encoder lead and length when two paths resolve to one packaged file', async () => {
        const { g, created } = createHost();
        const audio = new AudioAPI(new MiniGameAudioBackend(g as never, 'WeChat'));
        audio.setRefResolver(() => COOKED);
        audio.setEncodedClips({
            'a.wav': { lead: 0.025, seconds: 1.955 },
            'b.wav': { lead: 0.012, seconds: 1.970 },
            'copy.wav': { lead: 0.025, seconds: 1.955 },
        });
        await Promise.all([audio.preload('a.wav'), audio.preloadFromData('b.wav', new ArrayBuffer(0)), audio.preload('copy.wav')]);
        expect(audio.getBufferHandle('a.wav')?.duration).toBe(1.955);
        expect(audio.getBufferHandle('b.wav')?.duration).toBe(1.970);
        expect(audio.getBufferHandle('copy.wav')).toBe(audio.getBufferHandle('a.wav'));
        audio.playSFX('a.wav');
        audio.playSFX('b.wav');
        expect(created.map(ctx => [ctx.src, ctx.startTime])).toEqual([[COOKED, 0.025], [COOKED, 0.012]]);
        audio.dispose();
    });

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
    it('retries a refused package and waits for the staged file even when supplied with bytes', async () => {
        const { g, created } = createHost();
        const audio = new AudioAPI(new MiniGameAudioBackend(g as never, 'WeChat'));
        let open!: () => void;
        const ready = new Promise<void>(resolve => { open = resolve; });
        const prepare = vi.fn().mockRejectedValueOnce(new Error('closed')).mockReturnValue(ready);
        audio.setRefResolver(() => COOKED, undefined, prepare);
        await expect(audio.preload('tap.wav')).rejects.toThrow('closed');
        expect(audio.getBufferHandle('tap.wav')).toBeUndefined();
        const pending = audio.preloadFromData('tap.wav', new ArrayBuffer(8));
        expect(prepare.mock.calls).toEqual([[COOKED], [COOKED]]);
        expect(audio.getBufferHandle('tap.wav')).toBeUndefined();
        open();
        await pending;
        audio.playSFX('tap.wav');
        expect(created[0].src).toBe(COOKED);
        audio.dispose();
    });

    it('preloads the clip without reading bytes it cannot use', async () => {
        const { g, created } = createHost();
        const audio = new AudioAPI(new MiniGameAudioBackend(g as never, 'WeChat'));
        audio.setRefResolver((ref) => (ref === 'audio/tap.wav' ? COOKED : ref));
        const loadBinary = vi.fn(async () => new ArrayBuffer(8));
        const ctx = {
            getAudio: () => audio,
            catalog: { getBuildPath: (p: string) => (p === 'audio/tap.wav' ? COOKED : p) },
            backend: { resolveUrl: (p: string) => p },
            loadBinary,
        } as unknown as LoadContext;

        const result = await new AudioAssetLoader(() => audio).load('audio/tap.wav', ctx);

        expect(result.bufferId).toBe('audio/tap.wav'); // addressed by the AUTHORED path
        expect(loadBinary).not.toHaveBeenCalled();
        audio.playSFX('audio/tap.wav');
        expect(created[0].src).toBe(COOKED);
    });
});
