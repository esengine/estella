// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-music-layers.test.ts
 * @brief   A piece of music played as its layers: begun together, each with a level of its own.
 *
 *          Held here: that every layer is asked of the backend under one token (which is what a backend starts on one
 *          sample), that a layer's level moves with the frames and reaches the voice, that the layers are the music
 *          for everything that starts, stops and replaces music, and that where they cannot be kept in step the whole
 *          piece plays in their place rather than layers that drift.
 */
import { describe, it, expect, vi } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import type { AudioHandle, PlatformAudioBackend, PlayConfig } from '../src/audio/PlatformAudioBackend';

type Voice = AudioHandle & { isPlaying: boolean; volume: number; url: string; config: PlayConfig; stop: ReturnType<typeof vi.fn> };

function audioOf(delivery: 'bytes' | 'url' = 'bytes', streamed: string[] = []) {
    const urls = new Map<number, string>();
    const voices: Voice[] = [];
    const backend = {
        name: 'Mock', mixer: null, isReady: true, delivery,
        initialize: vi.fn().mockResolvedValue(undefined), ensureResumed: vi.fn().mockResolvedValue(undefined),
        loadBuffer: vi.fn(async (src: string) => { const id = urls.size + 1; urls.set(id, src); return { id, duration: 8, ...(streamed.includes(src) ? { streamed: true } : {}) }; }),
        loadBufferFromData: vi.fn(), unloadBuffer: vi.fn(), suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
        play: vi.fn((buffer: { id: number }, config: PlayConfig) => {
            const v = {
                id: voices.length + 1, pause: vi.fn(), resume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
                isPlaying: true, currentTime: 0, duration: 8, volume: config.volume ?? 1, url: urls.get(buffer.id)!, config,
                stop: vi.fn(() => { v.isPlaying = false; }), setVolume: vi.fn((x: number) => { v.volume = x; }),
            } as unknown as Voice;
            voices.push(v);
            return v;
        }),
    } as unknown as PlatformAudioBackend;
    const audio = new AudioAPI(backend);
    const of = (url: string): Voice => voices.filter((v) => v.url === url).at(-1)!;
    return { audio, voices, of };
}
const STEMS = { drums: 'a_drums.wav', bass: 'a_bass.wav', lead: 'a_lead.wav' };
const loaded = async (audio: AudioAPI, ...more: string[]): Promise<void> => { await audio.preloadAll([...Object.values(STEMS), ...more]); };
const frames = (audio: AudioAPI, n: number, dt = 0.1): void => { for (let i = 0; i < n; i++) audio.updateFades(dt); };

describe('music played as its layers', () => {
    it('asks for every layer under one token, round and round on the music bus, each at its own level', async () => {
        const { audio, voices, of } = audioOf();
        await loaded(audio);
        const music = audio.playLayers(STEMS, { volume: 0.8, levels: { lead: 0 }, loopStart: 4 });
        expect(voices.map((v) => v.url)).toEqual(['a_drums.wav', 'a_bass.wav', 'a_lead.wav']);
        // One token for all three: that is what a backend begins on one sample.
        expect(voices[0]!.config.together).toBeTypeOf('object');
        expect(new Set(voices.map((v) => v.config.together)).size).toBe(1);
        for (const v of voices) expect(v.config).toMatchObject({ bus: 'music', loop: true, loopStart: 4 });
        expect([of('a_drums.wav').volume, of('a_lead.wav').volume]).toEqual([0.8, 0]);
        expect([music.layered, music.inStep, music.isPlaying, music.names]).toEqual([true, true, true, ['drums', 'bass', 'lead']]);
        // Another piece is another token.
        audio.playLayers(STEMS);
        expect(voices[3]!.config.together).not.toBe(voices[0]!.config.together);
    });

    it('brings a layer up and down over the seconds asked, with the frames', async () => {
        const { audio, of } = audioOf();
        await loaded(audio);
        const music = audio.playLayers(STEMS, { levels: { lead: 0 } });
        music.setLayer('lead', 1, 2);
        frames(audio, 5);
        expect(music.layerLevel('lead')).toBeCloseTo(0.25, 9);
        expect(of('a_lead.wav').volume).toBeCloseTo(0.25, 9);
        frames(audio, 20);
        expect(of('a_lead.wav').volume).toBe(1);
        // Arrived, it is left alone.
        const writes = (of('a_lead.wav').setVolume as ReturnType<typeof vi.fn>).mock.calls.length;
        frames(audio, 5);
        expect((of('a_lead.wav').setVolume as ReturnType<typeof vi.fn>).mock.calls.length).toBe(writes);
        // Turned round on its way, it goes from where it is; at once when no time is given it.
        music.setLayer('lead', 0, 1);
        frames(audio, 5);
        expect(of('a_lead.wav').volume).toBeCloseTo(0.5, 9);
        music.setLayer('lead', 0.3, 0);
        expect(of('a_lead.wav').volume).toBeCloseTo(0.3, 9);
        // The others were never touched, and a layer that is not one changes nothing.
        expect(of('a_drums.wav').volume).toBe(1);
        music.setLayer('strings', 1);
        expect(music.layerLevel('strings')).toBe(0);
    });

    it('starts where it was last told to be, when it was told before its clips were loaded', async () => {
        const { audio, voices, of } = audioOf();
        const music = audio.playLayers(STEMS);
        expect(voices).toHaveLength(0);
        music.setLayer('drums', 0.2, 3);
        await vi.waitFor(() => expect(voices).toHaveLength(3));
        expect(of('a_drums.wav').volume).toBeCloseTo(0.2, 9);
        expect(new Set(voices.map((v) => v.config.together)).size).toBe(1);
    });

    it('is the music: stopBGM ends it, playBGM takes its place, and it takes the place of what was playing', async () => {
        const { audio, voices, of } = audioOf();
        await loaded(audio, 'other.wav');
        audio.playBGM('other.wav');
        const music = audio.playLayers(STEMS);
        expect(of('other.wav').stop).toHaveBeenCalledTimes(1);
        // Down over a second, every layer, and stopped at nothing.
        audio.stopBGM(1);
        frames(audio, 5);
        expect(of('a_bass.wav').volume).toBeCloseTo(0.5, 9);
        expect(of('a_bass.wav').stop).not.toHaveBeenCalled();
        frames(audio, 6);
        for (const url of Object.values(STEMS)) expect(of(url).stop).toHaveBeenCalledTimes(1);
        expect(music.isPlaying).toBe(false);
        // A single piece after layers stops every layer.
        const second = audio.playLayers(STEMS);
        audio.playBGM('other.wav');
        expect(voices.filter((v) => v.url !== 'other.wav').every((v) => !v.isPlaying)).toBe(true);
        expect(second.isPlaying).toBe(false);
        // And its own stop does not reach the piece that has replaced it.
        second.stop();
        expect(of('other.wav').isPlaying).toBe(true);
    });

    it('comes in over a fade as one piece, each layer to its own level', async () => {
        const { audio, of } = audioOf();
        await loaded(audio);
        audio.playLayers(STEMS, { fadeIn: 1, levels: { bass: 0.5 } });
        expect([of('a_drums.wav').volume, of('a_bass.wav').volume]).toEqual([0, 0]);
        frames(audio, 5);
        expect(of('a_drums.wav').volume).toBeCloseTo(0.5, 9);
        expect(of('a_bass.wav').volume).toBeCloseTo(0.25, 9);
    });

    it('plays the whole piece instead where layers cannot be kept in step', async () => {
        // Every clip a player of its own, as on a mini-game.
        const { audio, voices, of } = audioOf('url');
        await loaded(audio, 'a.wav');
        const music = audio.playLayers(STEMS, { mix: 'a.wav', volume: 0.7, loopStart: 4 });
        expect(voices.map((v) => v.url)).toEqual(['a.wav']);
        expect(of('a.wav').config).toMatchObject({ bus: 'music', loop: true, loopStart: 4, volume: 0.7 });
        expect([music.layered, music.inStep, music.isPlaying]).toEqual([false, false, true]);
        // There are no layers to move.
        music.setLayer('lead', 0, 0);
        expect(of('a.wav').volume).toBe(0.7);
        music.stop();
        expect(of('a.wav').stop).toHaveBeenCalledTimes(1);
    });

    it('does the same where one of the layers is played from its compressed file', async () => {
        const { audio, voices } = audioOf('bytes', ['a_bass.wav']);
        await loaded(audio, 'a.wav');
        const music = audio.playLayers(STEMS, { mix: 'a.wav' });
        expect(voices.map((v) => v.url)).toEqual(['a.wav']);
        expect(music.layered).toBe(false);
    });

    it('starts them one after another, and says they are not in step, where there is no whole piece to play', async () => {
        const { audio, voices } = audioOf('url');
        await loaded(audio);
        const music = audio.playLayers(STEMS);
        expect(voices).toHaveLength(3);
        expect([music.layered, music.inStep]).toEqual([true, false]);
    });
});
