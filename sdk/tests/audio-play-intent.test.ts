// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, expect, it, vi } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import type { AudioBufferHandle, AudioHandle, PlatformAudioBackend, PlayConfig } from '../src/audio/PlatformAudioBackend';

const loads = new Map<string, (buffer: AudioBufferHandle) => void>();
function voice(id: number): AudioHandle {
    let playing = true;
    return {
        id, stop: vi.fn(() => { playing = false; }), pause: vi.fn(() => { playing = false; }),
        resume: vi.fn(() => { playing = true; }),
        setVolume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
        get isPlaying() { return playing; }, currentTime: 0, duration: 1,
    };
}
function create() {
    let nextVoice = 0;
    const backend = {
        name: 'intent-test', delivery: 'bytes', mixer: null, isReady: true,
        initialize: vi.fn(async () => {}), ensureResumed: vi.fn(async () => {}),
        loadBuffer: vi.fn((url: string) => new Promise<AudioBufferHandle>(resolve => { loads.set(url, resolve); })),
        loadBufferFromData: vi.fn(async () => ({ id: 1, duration: 1 })),
        unloadBuffer: vi.fn(), play: vi.fn((_buffer: AudioBufferHandle, _config: PlayConfig) => voice(++nextVoice)),
        suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
    } satisfies PlatformAudioBackend;
    return { backend, audio: new AudioAPI(backend) };
}
beforeEach(() => loads.clear());
async function finish(audio: AudioAPI, url: string, id: number) {
    loads.get(url)!({ id, duration: 1 });
    await vi.waitFor(() => expect(audio.getBufferHandle(url)?.id).toBe(id));
}

it.each(['old-first', 'new-first'] as const)('only starts the latest BGM request when loads finish %s', async order => {
    const { audio, backend } = create();
    audio.playBGM('old.wav');
    audio.playBGM('new.wav');
    if (order === 'old-first') { await finish(audio, 'old.wav', 1); await finish(audio, 'new.wav', 2); }
    else { await finish(audio, 'new.wav', 2); await finish(audio, 'old.wav', 1); }
    expect(backend.play).toHaveBeenCalledTimes(1);
    expect(backend.play).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), expect.objectContaining({ bus: 'music' }));
});

it.each(['stopBGM', 'stopAll'] as const)('%s cancels a BGM request before it has a voice', async stop => {
    const { audio, backend } = create();
    audio.playBGM('pending.wav');
    audio[stop]();
    await finish(audio, 'pending.wav', 1);
    expect(backend.play).not.toHaveBeenCalled();
});

it('keeps a cached BGM ahead of an earlier pending request', async () => {
    const { audio, backend } = create();
    await audio.preloadFromData('ready.wav', new ArrayBuffer(8));
    audio.playBGM('pending.wav');
    audio.playBGM('ready.wav');
    await finish(audio, 'pending.wav', 9);
    expect(backend.play).toHaveBeenCalledTimes(1);
    expect(backend.play.mock.calls[0][0].id).toBe(1);
});

it.each([false, true])('an immediate stop ends outgoing BGM while repeated fade requests remain idempotent (repeat=%s)', async repeat => {
    const { audio, backend } = create();
    await audio.preloadFromData('ready.wav', new ArrayBuffer(8));
    audio.playBGM('ready.wav');
    const handle = backend.play.mock.results[0].value;
    audio.stopBGM(1);
    if (repeat) {
        audio.stopBGM(1);
        expect(handle.isPlaying).toBe(true);
    }
    audio.stopBGM();
    expect(handle.isPlaying).toBe(false);
    expect(handle.stop).toHaveBeenCalledOnce();
});

it('stopAll stops every owned voice, retires paused handles and keeps the device reusable', async () => {
    const { audio, backend } = create();
    await audio.preloadFromData('ready.wav', new ArrayBuffer(8));
    const effect = audio.playSFX('ready.wav');
    effect.pause();
    audio.playBuffer({ id: 2, duration: 1 }, { bus: 'voice' });
    audio.playBGM('ready.wav');
    audio.playBGM('ready.wav', { crossFade: 1 });
    const handles = backend.play.mock.results.map(result => result.value);
    audio.stopAll();
    expect(handles.every(handle => !handle.isPlaying)).toBe(true);
    for (const handle of handles) expect(handle.stop).toHaveBeenCalledOnce();
    effect.resume();
    expect(handles[0].resume).not.toHaveBeenCalled();
    expect(backend.dispose).not.toHaveBeenCalled();
    expect(audio.getBufferHandle('ready.wav')).toBeDefined();
    expect(audio.playSFX('ready.wav').isPlaying).toBe(true);
});

it('stopAll cancels pending effect and track starts while retaining their loaded buffers', async () => {
    const { audio, backend } = create();
    const effect = audio.playSFX('effect.wav');
    const track = audio.playTrack('track.wav');
    audio.stopAll();
    await finish(audio, 'effect.wav', 1);
    await finish(audio, 'track.wav', 2);
    expect(await track).toBeNull();
    effect.resume();
    expect(backend.play).not.toHaveBeenCalled();
    expect(audio.getBufferStats().bufferCount).toBe(2);
    expect(audio.playSFX('effect.wav').isPlaying).toBe(true);
});

it('starts both video tracks when they finish loading together over the cache budget', async () => {
    const { audio, backend } = create();
    audio.setBufferBudget(32);
    const urls = ['video/intro.esv.m4a', 'video/credits.esv.m4a'];
    const tracks = urls.map(url => audio.playTrack(url, { bus: 'video' }));
    urls.forEach((url, i) => loads.get(url)!({ id: i + 1, duration: 3, bytes: 64 }));

    const voices = await Promise.all(tracks);
    expect(backend.play.mock.calls.map(([buffer, config]) => [buffer.id, config.bus])).toEqual([[1, 'video'], [2, 'video']]);
    expect(audio.getBufferStats().bufferBytes).toBe(64);
    expect(audio.trimBufferCache()).toBe(1);
    expect(voices.map(v => v?.isPlaying)).toEqual([true, true]);
});

it.each([0, 32])('keeps a waiting video track through its last asset release and a memory trim (budget %s)', async budget => {
    const { audio } = create();
    const url = 'video/intro.esv.m4a';
    audio.setBufferBudget(budget);
    await audio.preloadFromData(url, new ArrayBuffer(8));
    expect(audio.retainBuffer(url)).toBe(true);
    const track = audio.playTrack(url);
    audio.releaseBuffer(url);

    expect(audio.getBufferStats().evictableCount).toBe(0);
    expect(audio.trimBufferCache()).toBe(0);
    expect((await track)?.isPlaying).toBe(true);
    expect(audio.trimBufferCache()).toBe(budget === 0 ? 0 : 1);
    expect(audio.getBufferStats().bufferCount).toBe(0);
});

it.each(['video', 'effect'])('an invalidated %s start cannot play or evict a freshly preloaded replacement', async kind => {
    const { audio, backend } = create();
    const url = 'changed.wav';
    audio.setBufferBudget(0);
    const start = kind === 'video' ? audio.playTrack(url) : audio.playSFX(url);
    const finishOld = loads.get(url)!;
    expect(audio.invalidateBuffer(url)).toBe(true);
    await audio.preloadFromData(url, new ArrayBuffer(8));
    const replacement = audio.getBufferHandle(url);
    expect(replacement).toBeDefined();
    finishOld({ id: 9, duration: 1 });
    await start;
    await vi.waitFor(() => expect(backend.unloadBuffer).toHaveBeenCalledWith({ id: 9, duration: 1 }));
    expect(backend.play).not.toHaveBeenCalled();
    expect(audio.getBufferHandle(url)).toBe(replacement);
    expect(audio.trimBufferCache()).toBe(1);
});

it('does not send a new buffer voice to a disposed device', () => {
    const { audio, backend } = create();
    audio.dispose();
    expect(audio.playBuffer({ id: 1, duration: 1 }).isPlaying).toBe(false);
    expect(backend.play).not.toHaveBeenCalled();
});

it('stopping a loading effect prevents backend allocation and later resume', async () => {
    const { audio, backend } = create();
    const handle = audio.playSFX('loading.wav');
    handle.stop();
    handle.resume();
    await finish(audio, 'loading.wav', 1);
    expect(backend.play).not.toHaveBeenCalled();
    expect(handle.isPlaying).toBe(false);
});

it('applies deferred controls at startup and exposes the resolved identity and completion callback', async () => {
    const { audio, backend } = create(), ended = vi.fn();
    const handle = audio.playSFX('loading.wav', { volume: 0.9, pitch: 1.1 });
    handle.setVolume(0.2);
    handle.setPan(-0.5);
    handle.setLoop(true);
    handle.setPlaybackRate(0.8);
    handle.onEnd = ended;
    await finish(audio, 'loading.wav', 1);
    const raw = backend.play.mock.results[0].value;
    expect(backend.play).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ volume: 0.2, pan: -0.5, loop: true, playbackRate: 0.8 }));
    expect(handle.id).toBe(raw.id);
    raw.onEnd?.();
    expect(ended).toHaveBeenCalledOnce();
    expect(handle.onEnd).toBe(ended);
    handle.setVolume(0.4);
    expect(raw.setVolume).toHaveBeenLastCalledWith(0.4);
});

it.each([false, true])('remembers pending pause/resume intent (resume before loading=%s)', async resumeBefore => {
    const { audio, backend } = create();
    audio.setSFXVolume(0.5);
    const handle = audio.playSFX('loading.wav', { volume: 0.8 });
    handle.pause();
    if (resumeBefore) handle.resume();
    await finish(audio, 'loading.wav', 1);
    const raw = backend.play.mock.results[0].value;
    expect(handle.isPlaying).toBe(resumeBefore);
    if (!resumeBefore) {
        expect(backend.play.mock.calls[0][1].volume).toBe(0);
        expect(raw.setVolume).toHaveBeenLastCalledWith(0.4);
        handle.resume();
        expect(handle.isPlaying).toBe(true);
    } else {
        expect(backend.play.mock.calls[0][1].volume).toBe(0.4);
        expect(raw.pause).not.toHaveBeenCalled();
    }
});
