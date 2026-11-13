// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-recipe.test.ts
 * @brief   A clip that is a recipe: which paths are one, what makes them, that what is made is the sound its source bakes to, and
 *          that the audio layer hands it to its backend as a file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    audioRecipeCacheKey, audioRecipeStats, hasAudioRecipeMaker, isAudioRecipePath, renderAudioRecipe, setAudioRecipeMaker,
    type AudioRecipeFileReader,
} from '../src/asset/audioRecipe';
import { contentHashHex } from '../src/asset/contentHash';
import { AudioAPI } from '../src/audio/Audio';
import type { PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';
import { getAddressableType } from '../src/assetTypes';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';
import { SOUND_RENDER_REVISION, decodeWav, encodeWav, installAudioRecipes, renderMusic, renderSound, validateMusicSource, validateSoundSource } from '../src/sound';
import { encodeUtf8 } from '../src/util/utf8';

afterEach(() => { setAudioRecipeMaker(null); audioRecipeStats(true); });

/** A project that is a few files by path. */
const project = (files: Record<string, unknown>): AudioRecipeFileReader => async (path) => {
    if (!(path in files)) throw new Error(`there is no file at ${path}`);
    const file = files[path];
    const bytes = file instanceof Uint8Array ? file : encodeUtf8(typeof file === 'string' ? file : JSON.stringify(file));
    return bytes.slice().buffer as ArrayBuffer;
};

const CHIME = { duration: 0.2, layers: [{ source: 'sine', freq: 880, decay: 0.05 }, { source: 'sine', freq: 1320, start: 0.05, decay: 0.05, pan: 0.4 }] };
const TUNE = {
    tempo: 120, key: 'A', scale: 'minor', loop: false,
    instruments: { lead: { layers: [{ source: 'triangle', freq: 440, decay: 0.2 }] } },
    patterns: { a: { bars: 1, div: 2, tracks: { lead: '1 . 3 . 5 . 1\' .' } } },
    song: ['a'],
};

describe('an audio recipe', () => {
    it('is a path that ends in .essound or .esmusic, whatever its case or its query', () => {
        expect(isAudioRecipePath('assets/audio/step.essound')).toBe(true);
        expect(isAudioRecipePath('assets/audio/Theme.ESMUSIC?v=3')).toBe(true);
        expect(isAudioRecipePath('assets/audio/step.wav')).toBe(false);
        expect(isAudioRecipePath('assets/audio/step.essound.wav')).toBe(false);
        // And a clip to whatever loads it.
        expect(getAddressableType('assets/audio/step.essound')).toBe('audio');
        expect(getAddressableType('assets/audio/theme.esmusic')).toBe('audio');
    });

    it('is refused, saying what to import, where nothing makes recipes', async () => {
        expect(hasAudioRecipeMaker()).toBe(false);
        await expect(renderAudioRecipe('a.essound', project({ 'a.essound': CHIME }))).rejects.toThrow(/import 'esengine\/sound'/);
    });

    it('is made into the .wav its source bakes to', async () => {
        installAudioRecipes();
        const wav = await renderAudioRecipe('assets/chime.essound', project({ 'assets/chime.essound': CHIME }));
        const baked = encodeWav(renderSound(validateSoundSource(CHIME)));
        expect(new Uint8Array(wav)).toEqual(baked);
        const read = decodeWav(new Uint8Array(wav));
        expect(read.rate).toBe(44100);
        expect(read.channels.length).toBe(2);
        expect(read.seconds).toBeCloseTo(0.2, 2);
        expect(audioRecipeStats().made).toBe(1);
    });

    it('is a piece of music as much as a sound', async () => {
        installAudioRecipes();
        const wav = await renderAudioRecipe('assets/tune.esmusic', project({ 'assets/tune.esmusic': TUNE }));
        const baked = renderMusic(validateMusicSource(TUNE));
        expect(new Uint8Array(wav)).toEqual(encodeWav({ rate: baked.rate, channels: baked.channels }));
    });

    it('reads the recordings its source plays, and is another clip when one of them changes', async () => {
        installAudioRecipes();
        const tick = encodeWav(renderSound(validateSoundSource({ duration: 0.05, layers: [{ source: 'impulse', width: 0.001 }] })));
        const source = { duration: 0.2, layers: [{ source: 'sample', file: 'assets/tick.wav' }] };
        const wav = await renderAudioRecipe('assets/played.essound', project({ 'assets/played.essound': source, 'assets/tick.wav': tick }));
        expect(decodeWav(new Uint8Array(wav)).peak).toBeGreaterThan(0.1);
        const text = JSON.stringify(source);
        const one = audioRecipeCacheKey(text, new Map([['assets/tick.wav', tick.slice().buffer as ArrayBuffer]]));
        const other = audioRecipeCacheKey(text, new Map([['assets/tick.wav', new Uint8Array([1, 2, 3]).buffer as ArrayBuffer]]));
        expect(one).not.toBe(other);
        expect(one.startsWith(`estella:audio-recipe:${SOUND_RENDER_REVISION}:`)).toBe(true);
    });

    // A clip made by an earlier run is kept under the revision: if the same source comes out as other samples, the revision has
    // to change with it, or the old clip is played for the new. This is the same source, held to the samples it makes today.
    it('comes out as the same samples until SOUND_RENDER_REVISION says otherwise', () => {
        const wav = encodeWav(renderSound(validateSoundSource(CHIME)));
        expect({ revision: SOUND_RENDER_REVISION, bytes: wav.byteLength, digest: contentHashHex(wav) }).toMatchInlineSnapshot(`
          {
            "bytes": 35324,
            "digest": "4083f3064656b38c",
            "revision": "1",
          }
        `);
    });
});

describe('the audio layer', () => {
    it('hands a clip that is a recipe to its backend as the bytes of a .wav', async () => {
        installAudioRecipes();
        const loaded: { src: string; bytes: Uint8Array }[] = [];
        const backend = {
            name: 'test', delivery: 'bytes',
            initialize: async () => {}, ensureResumed: async () => {},
            loadBuffer: vi.fn(async () => { throw new Error('a recipe is not fetched as a recording'); }),
            loadBufferFromData: vi.fn(async (src: string, data: ArrayBuffer) => { loaded.push({ src, bytes: new Uint8Array(data.slice(0)) }); return { id: 1, duration: 0.2 }; }),
            unloadBuffer: () => {}, play: () => ({ id: 1 }), suspend: () => {}, resume: () => {}, dispose: () => {},
        } as unknown as PlatformAudioBackend;
        const files: Record<string, Uint8Array> = { 'assets/chime.essound': encodeUtf8(JSON.stringify(CHIME)) };
        setPlatform({ readFile: async (path: string) => {
            const file = files[path];
            if (!file) throw new Error(`there is no file at ${path}`);
            return file.slice().buffer as ArrayBuffer;
        } } as unknown as PlatformAdapter);
        const audio = new AudioAPI(backend);
        await audio.preload('assets/chime.essound');
        expect(backend.loadBuffer).not.toHaveBeenCalled();
        expect(loaded.length).toBe(1);
        expect(loaded[0]!.bytes).toEqual(encodeWav(renderSound(validateSoundSource(CHIME))));
        expect(audio.getBufferHandle('assets/chime.essound')).toBeTruthy();
    });
});
