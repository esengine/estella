// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-source-flag.test.ts
 * @brief   Starting and stopping a sound through the component — the flag
 *          contract an FSM hook, a graph node and the inspector all write.
 *
 *          Held here: that raising the flag sounds the clip and lowering it
 *          stops the voice, and the two ways such a switch goes wrong — a voice
 *          that ends and starts itself over forever, and a sound nothing can
 *          reach any more once its source is switched off, re-clipped or
 *          un-clipped.
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

/** A voice whose end the test decides, the way a real one ends on its own. */
function voice(): AudioHandle & { isPlaying: boolean } {
    return {
        id: 1, stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
        setVolume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
        isPlaying: true, currentTime: 0, duration: 1,
    };
}

/** An app with the plugin built and two clips already resident. */
async function appWithClips() {
    const app = App.new();
    app.addPlugin(new AudioPlugin());
    const audio = app.getResource(Audio);
    await audio.preload('boom.wav');
    await audio.preload('ping.wav');
    return app;
}

let voices: ReturnType<typeof voice>[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    voices = [];
    (backend.play as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const v = voice();
        voices.push(v);
        return v;
    });
});

describe('the AudioSource playing flag', () => {
    it('sounds a source that was never playOnAwake, and silences it again', async () => {
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playing: true });

        await app.tick(1 / 60);
        expect(backend.play).toHaveBeenCalledTimes(1);

        app.world.update(e, AudioSource, d => { d.playing = false; });
        await app.tick(1 / 60);
        expect(voices[0]!.stop).toHaveBeenCalledTimes(1);
    });

    it('lowers the flag and latches finished when the clip ends by itself', async () => {
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playing: true });
        await app.tick(1 / 60);

        voices[0]!.isPlaying = false;
        await app.tick(1 / 60);

        const source = app.world.get(e, AudioSource);
        expect(source.playing).toBe(false);
        expect(source.finished).toBe(true);
    });

    it('does not start the clip over once it has ended', async () => {
        // The failure this exists for: retiring the handle in one place and
        // reading the flag in another leaves a raised flag with no voice, and
        // the next frame plays the sound again — forever, once a frame.
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playing: true });
        await app.tick(1 / 60);
        voices[0]!.isPlaying = false;

        for (let i = 0; i < 5; i++) await app.tick(1 / 60);

        expect(backend.play).toHaveBeenCalledTimes(1);
    });

    it('plays it again when the flag is raised after it finished', async () => {
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playing: true });
        await app.tick(1 / 60);
        voices[0]!.isPlaying = false;
        await app.tick(1 / 60);

        app.world.update(e, AudioSource, d => { d.playing = true; });
        await app.tick(1 / 60);

        expect(backend.play).toHaveBeenCalledTimes(2);
        // The latch describes the LAST play, so a replay clears it — otherwise
        // `audio.finished` answers yes about a sound that is currently going.
        expect(app.world.get(e, AudioSource).finished).toBe(false);
    });

    it('keeps a looping voice playing, with nothing to latch', async () => {
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playing: true, loop: true });

        for (let i = 0; i < 5; i++) await app.tick(1 / 60);

        expect(backend.play).toHaveBeenCalledTimes(1);
        expect(app.world.get(e, AudioSource).playing).toBe(true);
        expect(app.world.get(e, AudioSource).finished).toBe(false);
    });

    it('drops the voice in flight when the source names a different clip', async () => {
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playing: true });
        await app.tick(1 / 60);

        app.world.update(e, AudioSource, d => { d.clip = 'ping.wav'; });
        await app.tick(1 / 60);

        // One AudioSource playing a second sound is what a character with a hurt
        // clip and a death clip is: the voice is a play OF a clip, not of the
        // source, so the old one goes and the new one starts.
        expect(voices[0]!.stop).toHaveBeenCalledTimes(1);
        expect(backend.play).toHaveBeenCalledTimes(2);
    });

    it('silences a source that is switched off', async () => {
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playing: true, loop: true });
        await app.tick(1 / 60);

        app.world.update(e, AudioSource, d => { d.enabled = false; });
        await app.tick(1 / 60);

        // A dropped handle would leave the loop sounding with nothing able to
        // reach it.
        expect(voices[0]!.stop).toHaveBeenCalledTimes(1);
    });

    it('silences a source whose clip is taken away', async () => {
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playing: true, loop: true });
        await app.tick(1 / 60);

        app.world.update(e, AudioSource, d => { d.clip = ''; });
        await app.tick(1 / 60);

        // A source with no clip is skipped entirely, so the voice has to be
        // stopped where it is noticed missing — forgetting the handle is how a
        // loop outlives everything that could ever reach it.
        expect(voices[0]!.stop).toHaveBeenCalledTimes(1);
    });

    it('raises the flag once for playOnAwake, and leaves it lowered after', async () => {
        const app = await appWithClips();
        const e = app.world.spawn();
        app.world.insert(e, AudioSource, { clip: 'boom.wav', playOnAwake: true });

        await app.tick(1 / 60);
        expect(app.world.get(e, AudioSource).playing).toBe(true);
        expect(backend.play).toHaveBeenCalledTimes(1);

        voices[0]!.isPlaying = false;
        for (let i = 0; i < 3; i++) await app.tick(1 / 60);

        expect(app.world.get(e, AudioSource).playing).toBe(false);
        expect(backend.play).toHaveBeenCalledTimes(1);
    });
});
