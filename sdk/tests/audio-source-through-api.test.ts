// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-source-through-api.test.ts
 * @brief   A scene's sound comes through the same door a scripted one does.
 *
 *          An AudioSource that reached the backend directly was outside
 *          everything the API decides for a voice: the bus gain a backend with
 *          no mixer graph can only get from here (WeChat, a device), and the
 *          voice cap its `priority` is measured against.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioHandle, PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';

const backend = {
    name: 'Mock',
    mixer: null,
    isReady: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    ensureResumed: vi.fn().mockResolvedValue(undefined),
    loadBuffer: vi.fn().mockResolvedValue({ id: 1, duration: 1 }),
    unloadBuffer: vi.fn(),
    play: vi.fn(),
    suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
} as unknown as PlatformAudioBackend;

vi.mock('../src/platform/base', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/platform/base')>()),
    platformCreateAudioBackend: () => backend,
    platformOnMemoryWarning: () => () => {},
}));

const { App } = await import('../src/app/app');
const { AudioPlugin } = await import('../src/audio/AudioPlugin');
const { Audio } = await import('../src/audio/Audio');
const { AudioSource } = await import('../src/audio/AudioComponents');

function playingHandle(): AudioHandle {
    return {
        id: 1, stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
        setVolume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
        isPlaying: true, currentTime: 0, duration: 1,
    };
}

/** An app with the plugin built and one clip already resident. */
async function appWithClip() {
    const app = App.new();
    app.addPlugin(new AudioPlugin());
    const audio = app.getResource(Audio);
    await audio.preload('boom.wav');
    return { app, audio };
}

describe('an AudioSource in the scene', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (backend.play as ReturnType<typeof vi.fn>).mockImplementation(() => playingHandle());
    });

    it('is played through the API, so a soft bus reaches it', async () => {
        const { app, audio } = await appWithClip();
        audio.setSFXVolume(0.5);
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playOnAwake: true, volume: 1 });
        await app.tick(1 / 60);
        expect(backend.play).toHaveBeenCalledTimes(1);
        // 1 (the source's own) x 0.5 (the sfx bus, folded in because there is no
        // mixer graph to apply it). Straight at the backend this was 1.
        expect((backend.play as ReturnType<typeof vi.fn>).mock.calls[0]![1].volume).toBeCloseTo(0.5, 6);
    });

    it('brings in the clip it names, with no preload call beside it', async () => {
        const app = App.new();
        app.addPlugin(new AudioPlugin());
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'unheard.wav', playOnAwake: true, volume: 1 });

        await app.tick(1 / 60);
        // Nothing to play yet — but the frame asked for it rather than giving up.
        expect(backend.play).not.toHaveBeenCalled();
        expect(backend.loadBuffer).toHaveBeenCalledTimes(1);

        await vi.waitFor(() => expect(app.getResource(Audio).getBufferHandle('unheard.wav')).toBeTruthy());
        await app.tick(1 / 60);
        expect(backend.play).toHaveBeenCalledTimes(1);
    });

    it('asks for a loading clip once, not once a frame', async () => {
        // Never resolves: the frames that follow are the ones a slow clip gets.
        (backend.loadBuffer as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));
        const app = App.new();
        app.addPlugin(new AudioPlugin());
        const audio = app.getResource(Audio);
        const preload = vi.spyOn(audio, 'preload');
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'slow.wav', playOnAwake: true });

        for (let i = 0; i < 4; i++) await app.tick(1 / 60);

        // The buffer cache de-dupes the LOAD, so counting backend calls would pass
        // either way; what is being held here is the plugin not asking again.
        expect(preload).toHaveBeenCalledTimes(1);
        expect(backend.play).not.toHaveBeenCalled();
    });

    it('stops asking for a clip that cannot load', async () => {
        (backend.loadBuffer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('404'));
        const app = App.new();
        app.addPlugin(new AudioPlugin());
        const preload = vi.spyOn(app.getResource(Audio), 'preload');
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'missing.wav', playOnAwake: true });

        for (let i = 0; i < 3; i++) await app.tick(1 / 60);
        await vi.waitFor(() => expect(backend.loadBuffer).toHaveBeenCalled());
        for (let i = 0; i < 3; i++) await app.tick(1 / 60);

        // Retrying every frame for the rest of the session is the reason the old
        // code gave up after one look; giving up is not the only way to stop.
        expect(preload).toHaveBeenCalledTimes(1);
        expect(backend.play).not.toHaveBeenCalled();
    });

    it('is counted against the voice cap, at the priority it declares', async () => {
        const { app, audio } = await appWithClip();
        audio.setMaxVoices(1);
        const loud = app.world.spawn();
        app.world.insert(loud, AudioSource, { clip: 'boom.wav', playOnAwake: true, priority: 9 });
        await app.tick(1 / 60);
        const quiet = app.world.spawn();
        app.world.insert(quiet, AudioSource, { clip: 'boom.wav', playOnAwake: true, priority: 1 });
        await app.tick(1 / 60);
        // The second one is worth less than the voice already sounding, so it is
        // refused rather than silencing it.
        expect(backend.play).toHaveBeenCalledTimes(1);
    });
});
