// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-encoded-clips.test.ts
 * @brief   What the exporter's encoding did to a clip reaches the backend that plays it.
 *
 *          A WAV becomes an MP3 when a game is packaged, and an MP3 decodes with silence before its sound and after
 *          it. Held here: that the exporter's note of how long a clip really is travels from the packaged config
 *          through the audio API to the backend's load, by the path the clip is played by, and what a backend makes
 *          of it.
 */
import { describe, it, expect, vi } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import { applyAudioProjectConfig, parseAudioProjectConfig } from '../src/audio/AudioProjectConfig';
import { clipSpan, type PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';

function backendOf() {
    const loads: [string, unknown][] = [];
    const backend = {
        name: 'Mock', mixer: null, isReady: true, delivery: 'url',
        initialize: vi.fn().mockResolvedValue(undefined), ensureResumed: vi.fn().mockResolvedValue(undefined),
        loadBuffer: vi.fn(async (src: string, options: unknown) => { loads.push([src, options]); return { id: loads.length, duration: 1 }; }),
        loadBufferFromData: vi.fn(), unloadBuffer: vi.fn(), play: vi.fn(), suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
    } as unknown as PlatformAudioBackend;
    return { backend, loads };
}

describe('a clip the exporter re-encoded', () => {
    it('is loaded with what the encoding did to it, by the path it is played by', async () => {
        const { backend, loads } = backendOf();
        const audio = new AudioAPI(backend);
        audio.setEncodedClips({ 'assets/music/theme.wav': { seconds: 53.3, lead: 0.02506 } });
        audio.setLoadTypes({ 'assets/music/theme.wav': 'decompress' });
        await audio.preload('assets/music/theme.wav');
        await audio.preload('assets/sfx/plain.ogg');
        expect(loads).toEqual([
            ['assets/music/theme.wav', { loadType: 'decompress', trim: { seconds: 53.3, lead: 0.02506 } }],
            ['assets/sfx/plain.ogg', undefined],
        ]);
    });

    it('is read from the packaged config and applied, and what is not a length is left out', () => {
        const config = parseAudioProjectConfig({ encoded: {
            'a.wav': { seconds: 2, lead: 0.025 }, 'bad.wav': { seconds: -1, lead: 0.025 }, 'worse.wav': 'long', 'odd.wav': { seconds: 2, lead: 3 },
        } });
        expect(config.encoded).toEqual({ 'a.wav': { seconds: 2, lead: 0.025 } });
        const { backend } = backendOf();
        const audio = new AudioAPI(backend);
        const set = vi.spyOn(audio, 'setEncodedClips');
        applyAudioProjectConfig(audio, config);
        expect(set).toHaveBeenCalledWith({ 'a.wav': { seconds: 2, lead: 0.025 } });
        // A project played from its own files has none, and nothing is asked of the API.
        set.mockClear();
        applyAudioProjectConfig(audio, parseAudioProjectConfig({}));
        expect(set).not.toHaveBeenCalled();
    });

    it('lies between its lead and its real end in what a decoder made, unless the decoder took the lead off', () => {
        const trim = { seconds: 2, lead: 0.025 };
        // The decoder left the silence in: 2.06 s came back for a clip of 2.
        expect(clipSpan(trim, 2.06)).toEqual({ lead: 0.025, end: 2.025 });
        // It took the lead off and left what follows the sound: the clip begins at nothing and is over at 2.
        expect(clipSpan(trim, 2.01)).toEqual({ lead: 0, end: 2 });
        // It took both off.
        expect(clipSpan(trim, 2)).toEqual({ lead: 0, end: 2 });
        // A clip cut short by the decoder is not said to be longer than what there is.
        expect(clipSpan(trim, 1.5)).toEqual({ lead: 0, end: 1.5 });
        expect(clipSpan(undefined, 2.06)).toBeNull();
    });
});
