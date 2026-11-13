// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MiniGameAudioBackend } from '../src/audio/MiniGameAudioBackend';
import { AudioAPI } from '../src/audio/Audio';

function createMockInnerAudioContext() {
    const ctx = {
        src: '',
        startTime: 0,
        autoplay: false,
        loop: false,
        obeyMuteSwitch: true,
        volume: 1.0,
        playbackRate: 1.0,
        duration: 0,
        currentTime: 0,
        paused: true,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        destroy: vi.fn(),
        onEnded: vi.fn(),
        offEnded: vi.fn(),
        onError: vi.fn(),
    };
    ctx.play.mockImplementation(() => { ctx.paused = false; });
    ctx.pause.mockImplementation(() => { ctx.paused = true; });
    ctx.stop.mockImplementation(() => { ctx.paused = true; });
    ctx.destroy.mockImplementation(() => { ctx.paused = true; });
    return ctx;
}

describe('MiniGameAudioBackend', () => {
    let backend: MiniGameAudioBackend;

    beforeEach(() => {
        // The backend reads the host global it is HANDED — no ambient `wx`.
        const g = {
            createInnerAudioContext: vi.fn().mockImplementation(createMockInnerAudioContext),
        };
        (globalThis as any).wx = g;
        backend = new MiniGameAudioBackend(g as any, 'WeChat');
    });

    it('should have name "WeChat"', () => {
        expect(backend.name).toBe('WeChat');
    });

    describe('initialize', () => {
        it('should resolve without error', async () => {
            await expect(backend.initialize()).resolves.toBeUndefined();
        });
    });

    describe('loadBuffer', () => {
        it('should store URL and return handle', async () => {
            const handle = await backend.loadBuffer('audio/bgm.mp3');
            expect(handle.id).toBeGreaterThan(0);
            expect(handle.duration).toBe(0);
        });
    });

    describe('unloadBuffer', () => {
        it('should remove URL from cache', async () => {
            const handle = await backend.loadBuffer('audio/bgm.mp3');
            backend.unloadBuffer(handle);
            expect(() => backend.play(handle, {})).toThrow();
        });
    });

    describe('stop', () => {
        it.each(['stop', 'end', 'dispose'])('a handle retired by %s ignores writes and reports no playback', async kind => {
            const buffer = await backend.loadBuffer('a.mp3'), handle = backend.play(buffer, {});
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            if (kind === 'stop') handle.stop();
            else if (kind === 'end') ctx.onEnded.mock.calls[0][0]();
            else backend.dispose();
            ctx.paused = false; ctx.currentTime = 7;
            const volume = ctx.volume, loop = ctx.loop, rate = ctx.playbackRate;
            ctx.play.mockClear(); ctx.pause.mockClear();
            handle.pause(); handle.resume(); handle.setVolume(.2); handle.setLoop(true); handle.setPlaybackRate(2); handle.stop();
            expect(ctx.play).not.toHaveBeenCalled(); expect(ctx.pause).not.toHaveBeenCalled();
            expect([ctx.volume, ctx.loop, ctx.playbackRate]).toEqual([volume, loop, rate]);
            expect(handle.isPlaying).toBe(false); expect(handle.currentTime).toBe(0);
            expect(ctx.destroy).toHaveBeenCalledOnce();
        });
        it('a loop with a loop start is sent back there when it ends, and is not left to the host to loop', async () => {
            const buffer = await backend.loadBuffer('a.mp3'), handle = backend.play(buffer, { loop: true, loopStart: 12 });
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            // The host's own loop only knows the start of the file.
            expect(ctx.loop).toBe(false);
            handle.onEnd = vi.fn();
            const plays = ctx.play.mock.calls.length;
            ctx.onEnded.mock.calls[0][0]();
            expect(ctx.startTime).toBe(12);
            expect(ctx.play.mock.calls.length).toBe(plays + 1);
            expect(handle.onEnd).not.toHaveBeenCalled(); expect(ctx.destroy).not.toHaveBeenCalled();
            // Told to stop looping, its next end is its last.
            handle.setLoop(false); ctx.onEnded.mock.calls[0][0]();
            expect(handle.onEnd).toHaveBeenCalledOnce(); expect(ctx.destroy).toHaveBeenCalledOnce();
        });
        it('natural completion is terminal before callbacks run and is delivered only once', async () => {
            const buffer = await backend.loadBuffer('a.mp3'), handle = backend.play(buffer, {});
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            handle.onEnd = vi.fn(() => { expect(handle.isPlaying).toBe(false); expect(ctx.destroy).toHaveBeenCalledOnce(); });
            const ended = ctx.onEnded.mock.calls[0][0]; ended(); ended();
            expect(handle.onEnd).toHaveBeenCalledOnce(); expect(ctx.destroy).toHaveBeenCalledOnce();
        });
        it('a throwing completion callback cannot leave a live context behind', async () => {
            const buffer = await backend.loadBuffer('a.mp3'), handle = backend.play(buffer, {});
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            handle.onEnd = () => { throw Error('callback failed'); };
            const ended = ctx.onEnded.mock.calls[0][0];
            expect(() => ended()).toThrow('callback failed');
            expect(ctx.destroy).toHaveBeenCalledOnce(); expect(handle.isPlaying).toBe(false);
            expect(() => ended()).not.toThrow(); backend.dispose(); expect(ctx.destroy).toHaveBeenCalledOnce();
        });
        it('a loop notification does not retire a playing looping context', async () => {
            const buffer = await backend.loadBuffer('a.mp3'), handle = backend.play(buffer, { loop: true });
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            handle.onEnd = vi.fn(); ctx.onEnded.mock.calls[0][0]();
            expect(handle.isPlaying).toBe(true); expect(handle.onEnd).not.toHaveBeenCalled();
            expect(ctx.destroy).not.toHaveBeenCalled(); handle.stop(); expect(ctx.destroy).toHaveBeenCalledOnce();
        });
        it('is idempotent — never destroys the InnerAudioContext twice', async () => {
            const handle = await backend.loadBuffer('audio/sfx.mp3');
            const audioHandle = backend.play(handle, {});
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            audioHandle.stop();
            audioHandle.stop(); // double stop (or a stop after the sound ended on its own)
            expect(ctx.destroy).toHaveBeenCalledTimes(1);
        });
    });

    describe('play', () => {
        it('should create InnerAudioContext and configure it', async () => {
            const handle = await backend.loadBuffer('audio/sfx.mp3');
            const audioHandle = backend.play(handle, {
                volume: 0.7,
                loop: true,
                playbackRate: 1.5,
                startOffset: 2.0,
            });

            const wx = (globalThis as any).wx;
            expect(wx.createInnerAudioContext).toHaveBeenCalled();
            expect(audioHandle.id).toBeGreaterThan(0);
        });

        it('should throw for unknown buffer', () => {
            expect(() => backend.play({ id: 999, duration: 0 }, {})).toThrow('Buffer 999 not found');
        });
    });

    describe('suspend/resume', () => {
        it('keeps device-paused voices logically playing for source and budget tracking', async () => {
            const audio = new AudioAPI(backend, null), buffer = await backend.loadBuffer('a.mp3');
            audio.setMaxVoices(1);
            const voice = audio.playBuffer(buffer, { priority: 9, volume: .8 });
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results[0].value;
            audio.suspend();
            expect(ctx.paused).toBe(true); expect(voice.isPlaying).toBe(true);
            audio.setSFXVolume(.5);
            expect(audio.playBuffer(buffer, { priority: 1 }).isPlaying).toBe(false);
            audio.resume(); audio.setSFXVolume(.25);
            expect(ctx.volume).toBeCloseTo(.2); expect(ctx.play).toHaveBeenCalledTimes(2);
        });
        it('defers a new voice until device resume', async () => {
            const buffer = await backend.loadBuffer('a.mp3'); backend.suspend();
            const voice = backend.play(buffer, {});
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results[0].value;
            expect(ctx.play).not.toHaveBeenCalled(); expect(voice.isPlaying).toBe(true);
            backend.resume(); expect(ctx.play).toHaveBeenCalledOnce();
        });
        it('a manual pause during device suspension withdraws automatic resume', async () => {
            const buffer = await backend.loadBuffer('a.mp3'), voice = backend.play(buffer, {});
            backend.suspend(); voice.pause(); backend.resume();
            expect(voice.isPlaying).toBe(false);
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results[0].value;
            expect(ctx.play).toHaveBeenCalledOnce();
        });
        it('a manual resume during device suspension queues playback', async () => {
            const buffer = await backend.loadBuffer('a.mp3'), voice = backend.play(buffer, {});
            voice.pause(); backend.suspend(); voice.resume();
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results[0].value;
            expect(ctx.paused).toBe(true); expect(ctx.play).toHaveBeenCalledOnce();
            backend.resume(); expect(voice.isPlaying).toBe(true); expect(ctx.play).toHaveBeenCalledTimes(2);
        });
        it('a host playback callback can withdraw another queued voice before it resumes', async () => {
            const buffer = await backend.loadBuffer('a.mp3');
            backend.play(buffer, {}); const second = backend.play(buffer, {}); backend.suspend();
            const contexts = (globalThis as any).wx.createInnerAudioContext.mock.results;
            contexts[0].value.play.mockImplementation(() => { contexts[0].value.paused = false; second.pause(); });
            backend.resume();
            expect(second.isPlaying).toBe(false); expect(contexts[1].value.play).toHaveBeenCalledOnce();
        });
        it('stopping a suspended managed voice frees its budget and prevents later playback', async () => {
            const audio = new AudioAPI(backend, null), buffer = await backend.loadBuffer('a.mp3');
            audio.setMaxVoices(1); const old = audio.playBuffer(buffer, { priority: 9 });
            audio.suspend(); old.stop();
            const next = audio.playBuffer(buffer, { priority: 1 });
            audio.resume(); expect(old.isPlaying).toBe(false); expect(next.isPlaying).toBe(true);
            const contexts = (globalThis as any).wx.createInnerAudioContext.mock.results;
            expect(contexts[0].value.play).toHaveBeenCalledOnce(); expect(contexts[1].value.play).toHaveBeenCalledOnce();
        });
        it('resumes device-paused voices while preserving a manually paused voice', async () => {
            const buffer = await backend.loadBuffer('a.mp3');
            const manual = backend.play(buffer, {}), active = backend.play(buffer, {});
            manual.pause(); backend.suspend(); backend.resume();
            expect(manual.isPlaying).toBe(false); expect(active.isPlaying).toBe(true);
        });
        it('resume without a device suspension does not restart manually paused voices', async () => {
            const buffer = await backend.loadBuffer('a.mp3');
            const handle = backend.play(buffer, {}); handle.pause(); backend.resume();
            expect(handle.isPlaying).toBe(false);
        });
        it('repeated device suspension retains the original set of playing voices', async () => {
            const buffer = await backend.loadBuffer('a.mp3');
            const handle = backend.play(buffer, {});
            backend.suspend(); backend.suspend(); backend.resume();
            expect(handle.isPlaying).toBe(true);
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            expect(ctx.pause).toHaveBeenCalledOnce(); expect(ctx.play).toHaveBeenCalledTimes(2);
        });
        it.each(['stop', 'end'])('a context retired by %s during suspension is never resumed', async kind => {
            const buffer = await backend.loadBuffer('a.mp3'), handle = backend.play(buffer, {});
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            backend.suspend();
            if (kind === 'stop') handle.stop(); else ctx.onEnded.mock.calls[0][0]();
            backend.resume(); expect(ctx.play).toHaveBeenCalledOnce(); expect(ctx.destroy).toHaveBeenCalledOnce();
        });
        it('disposal discards the device resume set', async () => {
            const buffer = await backend.loadBuffer('a.mp3');
            backend.play(buffer, {}); backend.suspend(); backend.dispose(); backend.resume();
            const ctx = (globalThis as any).wx.createInnerAudioContext.mock.results.at(-1).value;
            expect(ctx.play).toHaveBeenCalledOnce(); expect(ctx.destroy).toHaveBeenCalledOnce();
        });
        it('repeated takeovers reuse live contexts and keep manual pauses intact', async () => {
            const buffer = await backend.loadBuffer('a.mp3');
            const manual = backend.play(buffer, {}), active = backend.play(buffer, {}); manual.pause();
            for (let i = 0; i < 100; i++) { backend.suspend(); backend.resume(); }
            expect(manual.isPlaying).toBe(false); expect(active.isPlaying).toBe(true);
            const host = (globalThis as any).wx;
            expect(host.createInnerAudioContext).toHaveBeenCalledTimes(2);
            expect(host.createInnerAudioContext.mock.results[0].value.play).toHaveBeenCalledOnce();
            expect(host.createInnerAudioContext.mock.results[1].value.play).toHaveBeenCalledTimes(101);
        });
        it('should pause all active contexts on suspend', async () => {
            const h1 = await backend.loadBuffer('a.mp3');
            const h2 = await backend.loadBuffer('b.mp3');
            backend.play(h1, {});
            backend.play(h2, {});

            backend.suspend();
            const wx = (globalThis as any).wx;
            const calls = wx.createInnerAudioContext.mock.results;
            for (const call of calls) {
                expect(call.value.pause).toHaveBeenCalled();
            }
        });
    });

    describe('dispose', () => {
        it('should destroy all contexts', async () => {
            const h = await backend.loadBuffer('a.mp3');
            backend.play(h, {});
            backend.dispose();

            const wx = (globalThis as any).wx;
            const calls = wx.createInnerAudioContext.mock.results;
            for (const call of calls) {
                expect(call.value.destroy).toHaveBeenCalled();
            }
        });
    });
});
