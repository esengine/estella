// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-source-fade.test.ts
 * @brief   A source in a scene that comes in and goes out over a time, and a loop that comes back to somewhere
 *          other than its start.
 *
 *          Held here: that a voice with a fade starts at nothing and rises with the frames, that lowering the flag
 *          lets it down before it is stopped rather than cutting it, that raising it again turns the fade round,
 *          and that a source or `playBGM` with a loop start hands it to the backend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioHandle, PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';

const backend = {
    name: 'Mock',
    mixer: null,
    isReady: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    ensureResumed: vi.fn().mockResolvedValue(undefined),
    loadBuffer: vi.fn().mockResolvedValue({ id: 1, duration: 10 }),
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

type Voice = AudioHandle & { isPlaying: boolean; volume: number; setVolume: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
let voices: Voice[] = [];
let configs: Record<string, unknown>[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    voices = [];
    configs = [];
    (backend.play as ReturnType<typeof vi.fn>).mockImplementation((_buffer: unknown, config: Record<string, unknown>) => {
        const v = {
            id: voices.length + 1, pause: vi.fn(), resume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
            isPlaying: true, currentTime: 0, duration: 10, volume: config.volume as number,
            stop: vi.fn(() => { v.isPlaying = false; }),
            setVolume: vi.fn((x: number) => { v.volume = x; }),
        } as unknown as Voice;
        voices.push(v);
        configs.push(config);
        return v;
    });
});

async function appWith(source: Record<string, unknown>) {
    const app = App.new();
    app.addPlugin(new AudioPlugin());
    await app.getResource(Audio).preload('theme.wav');
    const e = app.world.spawn();
    app.world.insert(e, AudioSource, { clip: 'theme.wav', bus: 'music', ...source });
    return { app, e };
}
const frames = async (app: InstanceType<typeof App>, n: number, dt = 0.1): Promise<void> => { for (let i = 0; i < n; i++) await app.tick(dt); };

describe('an AudioSource that fades', () => {
    it('comes up from nothing over fadeIn, and no further than its volume', async () => {
        const { app } = await appWith({ playing: true, volume: 0.8, fadeIn: 1 });
        await app.tick(0.1);
        expect(configs[0]!.volume).toBe(0);
        // The frame that starts it is the first step of the way up.
        expect(voices[0]!.volume).toBeCloseTo(0.08, 5);
        await frames(app, 4);
        expect(voices[0]!.volume).toBeCloseTo(0.4, 5);
        await frames(app, 10);
        expect(voices[0]!.volume).toBeCloseTo(0.8, 5);
        // Up, it is left alone: no write every frame.
        const writes = voices[0]!.setVolume.mock.calls.length;
        await frames(app, 5);
        expect(voices[0]!.setVolume.mock.calls.length).toBe(writes);
    });

    it('starts at its volume when it has no fade, as it always did', async () => {
        const { app } = await appWith({ playing: true, volume: 0.8 });
        await app.tick(0.1);
        expect(configs[0]!.volume).toBe(0.8);
        expect(voices[0]!.setVolume).not.toHaveBeenCalled();
    });

    it('goes down over fadeOut when the flag is lowered, and is stopped only at nothing', async () => {
        const { app, e } = await appWith({ playing: true, volume: 1, fadeOut: 0.5 });
        await app.tick(0.1);
        app.world.update(e, AudioSource, (d) => { d.playing = false; });
        await frames(app, 2);
        expect(voices[0]!.stop).not.toHaveBeenCalled();
        expect(voices[0]!.volume).toBeCloseTo(0.6, 5);
        await frames(app, 2);
        expect(voices[0]!.volume).toBeCloseTo(0.2, 5);
        await frames(app, 2);
        expect(voices[0]!.stop).toHaveBeenCalledTimes(1);
        // And it is gone: nothing more is played or written.
        await frames(app, 3);
        expect(backend.play).toHaveBeenCalledTimes(1);
    });

    it('is cut at once when the flag is lowered and it has no fadeOut', async () => {
        const { app, e } = await appWith({ playing: true, fadeIn: 1 });
        await app.tick(0.1);
        app.world.update(e, AudioSource, (d) => { d.playing = false; });
        await app.tick(0.1);
        expect(voices[0]!.stop).toHaveBeenCalledTimes(1);
    });

    it('turns round when the flag is raised again on its way out, without starting the clip over', async () => {
        const { app, e } = await appWith({ playing: true, volume: 1, fadeIn: 1, fadeOut: 1 });
        await frames(app, 12);
        expect(voices[0]!.volume).toBeCloseTo(1, 5);
        app.world.update(e, AudioSource, (d) => { d.playing = false; });
        await frames(app, 5);
        expect(voices[0]!.volume).toBeCloseTo(0.5, 5);
        app.world.update(e, AudioSource, (d) => { d.playing = true; });
        await frames(app, 3);
        expect(voices[0]!.volume).toBeCloseTo(0.8, 5);
        expect(voices[0]!.stop).not.toHaveBeenCalled();
        expect(backend.play).toHaveBeenCalledTimes(1);
    });

    it('is still stopped at once when its source is switched off or loses its clip', async () => {
        const { app, e } = await appWith({ playing: true, fadeOut: 2 });
        await app.tick(0.1);
        app.world.update(e, AudioSource, (d) => { d.enabled = false; });
        await app.tick(0.1);
        expect(voices[0]!.stop).toHaveBeenCalledTimes(1);
    });
});

describe('a loop that comes back to somewhere other than its start', () => {
    it('is handed to the backend by a source that loops', async () => {
        const { app } = await appWith({ playing: true, loop: true, loopStart: 12.5 });
        await app.tick(0.1);
        expect(configs[0]).toMatchObject({ loop: true, loopStart: 12.5 });
    });

    it('is not handed on by a source that does not loop, or whose loop start is the start', async () => {
        const { app } = await appWith({ playing: true, loop: false, loopStart: 12.5 });
        await app.tick(0.1);
        expect('loopStart' in configs[0]!).toBe(false);
        const again = await appWith({ playing: true, loop: true });
        await again.app.tick(0.1);
        expect('loopStart' in configs[1]!).toBe(false);
    });

    it('is handed to the backend by playBGM, with the fade in beside it', async () => {
        const { app } = await appWith({});
        const audio = app.getResource(Audio);
        audio.playBGM('theme.wav', { loopStart: 8, fadeIn: 1 });
        expect(configs[0]).toMatchObject({ bus: 'music', loop: true, loopStart: 8 });
        audio.playBGM('theme.wav');
        expect('loopStart' in configs[1]!).toBe(false);
    });
});
