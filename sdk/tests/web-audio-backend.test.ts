// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebAudioBackend } from '../src/audio/WebAudioBackend';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';

function createMockGainNode(context: any): any {
    return {
        gain: { value: 1.0, setTargetAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        context,
    };
}

function createMockPannerNode(): any {
    return {
        pan: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
    };
}

function createMockAnalyserNode(): any {
    return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        connect: vi.fn(),
        disconnect: vi.fn(),
        getByteFrequencyData: vi.fn(),
    };
}

function createMockBufferSource(): any {
    const source: any = {
        buffer: null,
        loop: false,
        playbackRate: { value: 1.0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
    };
    return source;
}

function setupMockAudioContext(): void {
    const mockCtx: any = {
        state: 'running',
        currentTime: 0,
        destination: {},
        createGain: vi.fn(),
        createStereoPanner: vi.fn(),
        createBufferSource: vi.fn(),
        createAnalyser: vi.fn(),
        decodeAudioData: vi.fn(),
        resume: vi.fn().mockResolvedValue(undefined),
        suspend: vi.fn(),
        close: vi.fn(),
    };

    mockCtx.createGain.mockImplementation(() => createMockGainNode(mockCtx));
    mockCtx.createStereoPanner.mockImplementation(() => createMockPannerNode());
    mockCtx.createBufferSource.mockImplementation(() => createMockBufferSource());
    mockCtx.createAnalyser.mockImplementation(() => createMockAnalyserNode());

    (globalThis as any).AudioContext = vi.fn().mockImplementation(() => mockCtx);
    (globalThis as any).__mockAudioContext = mockCtx;
}

function setupMockPlatform(): void {
    const mockPlatform = {
        name: 'web' as const,
        readFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        fetch: vi.fn(),
        readTextFile: vi.fn(),
        fileExists: vi.fn(),
        loadImagePixels: vi.fn(),
        instantiateWasm: vi.fn(),
        createCanvas: vi.fn(),
        now: vi.fn(),
        createImage: vi.fn(),
        bindInputEvents: vi.fn(),
        createAudioBackend: vi.fn(),
    } as unknown as PlatformAdapter;
    setPlatform(mockPlatform);
    (globalThis as any).__mockPlatform = mockPlatform;
}

async function initAndLoadBuffer(backend: WebAudioBackend): Promise<{ bufferHandle: any; mockCtx: any }> {
    await backend.initialize();
    const mockCtx = (globalThis as any).__mockAudioContext;
    const mockAudioBuffer = { duration: 1.0 };
    mockCtx.decodeAudioData.mockResolvedValue(mockAudioBuffer);
    const bufferHandle = await backend.loadBuffer('sfx.mp3');
    return { bufferHandle, mockCtx };
}

describe('WebAudioBackend', () => {
    let backend: WebAudioBackend;

    beforeEach(() => {
        setupMockAudioContext();
        setupMockPlatform();
        backend = new WebAudioBackend();
    });

    afterEach(() => backend.dispose());

    it('should have name "WebAudio"', () => {
        expect(backend.name).toBe('WebAudio');
    });

    describe('initialize', () => {
        it('should create AudioContext', async () => {
            await backend.initialize();
            expect(globalThis.AudioContext).toHaveBeenCalled();
        });

        it('should set up auto-resume listeners when suspended', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended';

            const addEventSpy = vi.spyOn(document, 'addEventListener');
            await backend.initialize();

            expect(addEventSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
            expect(addEventSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
            expect(addEventSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
            addEventSpy.mockRestore();
        });

        it('should remove all resume listeners after first interaction', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended';

            const handlers: Record<string, Function> = {};
            const addSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type: string, handler: any) => {
                handlers[type] = handler;
            });
            const removeSpy = vi.spyOn(document, 'removeEventListener');

            await backend.initialize();

            handlers['touchstart']();

            expect(mockCtx.resume).toHaveBeenCalled();
            expect(removeSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
            expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
            expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

            addSpy.mockRestore();
            removeSpy.mockRestore();
        });

        it('should tap the master bus with a configured analyser', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            expect(mockCtx.createAnalyser).toHaveBeenCalledTimes(1);

            const analyser = mockCtx.createAnalyser.mock.results[0].value;
            expect(analyser.fftSize).toBe(128);
            expect(analyser.smoothingTimeConstant).toBe(0.7);
            // The master OUTPUT gain connects INTO the analyser (a side-branch
            // sink). A bus creates input/duck/gain in order, so master's output
            // is the third gain the context vended.
            const masterOut = mockCtx.createGain.mock.results[2].value;
            expect(masterOut.connect).toHaveBeenCalledWith(analyser);
        });
    });

    describe('getFrequencyData', () => {
        it('returns false before initialize and after dispose', () => {
            const out = new Uint8Array(64);
            expect(backend.getFrequencyData(out)).toBe(false);
        });

        it('fills the buffer from the analyser once initialized', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            const analyser = mockCtx.createAnalyser.mock.results[0].value;

            const out = new Uint8Array(64);
            expect(backend.getFrequencyData(out)).toBe(true);
            expect(analyser.getByteFrequencyData).toHaveBeenCalledWith(out);

            backend.dispose();
            expect(backend.getFrequencyData(out)).toBe(false);
        });
    });

    describe('ensureResumed', () => {
        it('should resume if suspended', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended';
            await backend.ensureResumed();
            expect(mockCtx.resume).toHaveBeenCalled();
        });

        it('should not resume if already running', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'running';
            mockCtx.resume.mockClear();
            await backend.ensureResumed();
            expect(mockCtx.resume).not.toHaveBeenCalled();
        });
    });

    describe('loadBuffer', () => {
        it.each(['read', 'decode'] as const)('rejects an old %s after the AudioContext is replaced', async stage => {
            await backend.initialize();
            const ctx = (globalThis as any).__mockAudioContext;
            const platform = (globalThis as any).__mockPlatform;
            let finish!: (value: unknown) => void;
            if (stage === 'read') platform.readFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
            else ctx.decodeAudioData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
            const pending = stage === 'read'
                ? backend.loadBuffer('restart.wav')
                : backend.loadBufferFromData('restart.wav', new ArrayBuffer(8));
            await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
            backend.dispose();
            // This mock deliberately reuses the context object. A session
            // generation, rather than object identity alone, must reject it.
            await backend.initialize();
            ctx.decodeAudioData.mockResolvedValue({ duration: 2, length: 16, numberOfChannels: 1 });
            const current = await backend.loadBufferFromData('restart.wav', new ArrayBuffer(16));
            const calls = ctx.decodeAudioData.mock.calls.length;
            const rejection = expect(pending).rejects.toThrow('AudioContext changed');
            finish(stage === 'read' ? new ArrayBuffer(8) : { duration: 1, length: 8, numberOfChannels: 1 });
            await rejection;
            expect(ctx.decodeAudioData).toHaveBeenCalledTimes(calls);
            expect((await backend.loadBuffer('restart.wav')).id).toBe(current.id);
            backend.unloadBuffer(current);
            const retained = Object.values(backend).filter(value => value instanceof Map)
                .reduce((count, map) => count + map.size, 0);
            expect(retained).toBe(0);
        });

        it('does not republish a decoded buffer after disposal without reinitialization', async () => {
            await backend.initialize();
            const ctx = (globalThis as any).__mockAudioContext;
            let finish!: (value: unknown) => void;
            ctx.decodeAudioData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
            const pending = backend.loadBufferFromData('disposed.wav', new ArrayBuffer(8));
            await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
            backend.dispose();
            const rejection = expect(pending).rejects.toThrow('AudioContext changed');
            finish({ duration: 1, length: 8, numberOfChannels: 1 });
            await rejection;
            const retained = Object.values(backend).filter(value => value instanceof Map)
                .reduce((count, map) => count + map.size, 0);
            expect(retained).toBe(0);
        });

        it.each([false, true])('retires source metadata after buffer release (invalidate=%s)', async invalidate => {
            await backend.initialize();
            const ctx = (globalThis as any).__mockAudioContext;
            ctx.decodeAudioData.mockResolvedValue({ duration: 1, length: 8, numberOfChannels: 1 });
            for (let i = 0; i < 2000; i++) {
                const url = `scene-${i}/sound.wav`;
                const handle = await backend.loadBuffer(url);
                backend.unloadBuffer(handle);
                if (invalidate) backend.invalidateSource(url);
            }
            const retained = Object.values(backend).filter(value => value instanceof Map)
                .reduce((count, map) => count + map.size, 0);
            expect(retained).toBe(0);
        });

        it('does not retain metadata for failed source loads', async () => {
            await backend.initialize();
            const platform = (globalThis as any).__mockPlatform;
            platform.readFile.mockRejectedValue(new Error('missing file'));
            for (let i = 0; i < 25; i++) {
                await expect(backend.loadBuffer(`missing-${i}.wav`)).rejects.toThrow('missing file');
            }
            const retained = Object.values(backend).filter(value => value instanceof Map)
                .reduce((count, map) => count + map.size, 0);
            expect(retained).toBe(0);
        });

        it.each(['old-first', 'new-first'] as const)('keeps the current URL load when an invalidated read finishes %s', async order => {
            await backend.initialize();
            const ctx = (globalThis as any).__mockAudioContext;
            const platform = (globalThis as any).__mockPlatform;
            const finish: Array<(data: ArrayBuffer) => void> = [];
            platform.readFile.mockImplementation(() => new Promise<ArrayBuffer>(resolve => finish.push(resolve)));
            ctx.decodeAudioData.mockImplementation(async (data: ArrayBuffer) => ({
                duration: data.byteLength / 8, length: data.byteLength, numberOfChannels: 1,
            }));
            const old = backend.loadBuffer('edited.wav');
            backend.invalidateSource('edited.wav');
            const current = backend.loadBuffer('edited.wav');
            expect(platform.readFile).toHaveBeenCalledTimes(2);
            let stale, fresh;
            if (order === 'old-first') {
                finish[0](new ArrayBuffer(8)); stale = await old;
                const joined = backend.loadBuffer('edited.wav');
                expect(platform.readFile).toHaveBeenCalledTimes(2);
                finish[1](new ArrayBuffer(16)); fresh = await current;
                expect((await joined).id).toBe(fresh.id);
            } else {
                finish[1](new ArrayBuffer(16)); fresh = await current;
                finish[0](new ArrayBuffer(8)); stale = await old;
            }
            expect(stale.duration).toBe(1);
            expect(fresh.duration).toBe(2);
            backend.unloadBuffer(stale);
            expect((await backend.loadBuffer('edited.wav')).id).toBe(fresh.id);
            expect(platform.readFile).toHaveBeenCalledTimes(2);
        });

        it('should load via platform readFile and decode audio data', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            const mockPlatform = (globalThis as any).__mockPlatform;

            const mockArrayBuffer = new ArrayBuffer(8);
            const mockAudioBuffer = { duration: 2.5, length: 44100 };
            mockPlatform.readFile.mockResolvedValue(mockArrayBuffer);
            mockCtx.decodeAudioData.mockResolvedValue(mockAudioBuffer);

            const handle = await backend.loadBuffer('test.mp3');
            expect(handle.id).toBeGreaterThan(0);
            expect(handle.duration).toBe(2.5);
            expect(mockPlatform.readFile).toHaveBeenCalledWith('test.mp3');
        });

        it('should throw on readFile failure', async () => {
            await backend.initialize();
            const mockPlatform = (globalThis as any).__mockPlatform;
            mockPlatform.readFile.mockRejectedValue(new Error('Failed to read file: missing.mp3 (404)'));
            await expect(backend.loadBuffer('missing.mp3')).rejects.toThrow('Failed to read file: missing.mp3 (404)');
        });

        it('should deduplicate concurrent loads for the same URL', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            const mockPlatform = (globalThis as any).__mockPlatform;
            mockCtx.decodeAudioData.mockResolvedValue({ duration: 1.0 });

            const [h1, h2] = await Promise.all([
                backend.loadBuffer('dup.mp3'),
                backend.loadBuffer('dup.mp3'),
            ]);
            expect(h1.id).toBe(h2.id);
            expect(mockPlatform.readFile).toHaveBeenCalledTimes(1);
        });

        it('should return cached handle for already loaded URL', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            const mockPlatform = (globalThis as any).__mockPlatform;
            mockCtx.decodeAudioData.mockResolvedValue({ duration: 2.0 });

            const h1 = await backend.loadBuffer('cached.mp3');
            const h2 = await backend.loadBuffer('cached.mp3');
            expect(h1.id).toBe(h2.id);
            expect(mockPlatform.readFile).toHaveBeenCalledTimes(1);
        });

        it('should throw if not initialized', async () => {
            await expect(backend.loadBuffer('test.mp3')).rejects.toThrow('AudioContext not initialized');
        });
    });

    describe('play', () => {
        it.each(['stop', 'ended', 'paused-stop'])('terminal %s handles release runtime ownership and preserve scalar metadata', async kind => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, {});
            const source = mockCtx.createBufferSource.mock.results.at(-1).value;
            const ended = source.onended;
            const onEnd = vi.fn();
            handle.onEnd = onEnd;
            if (kind === 'ended') ended();
            else { if (kind === 'paused-stop') handle.pause(); handle.stop(); }
            backend.unloadBuffer(bufferHandle);
            expect(handle.isPlaying).toBe(false);
            expect(handle.currentTime).toBe(0);
            expect(handle.duration).toBe(1);
            expect(source.onended).toBeNull();
            for (const field of ['buffer_', 'source_', 'context_', 'pool_', 'poolNode_']) {
                expect((handle as any)[field], field).toBeNull();
            }
            expect(() => {handle.pause();handle.resume();handle.stop();handle.setLoop(true);
                handle.setPlaybackRate(2);handle.setVolume(.4);handle.setPan(.3);}).not.toThrow();
            ended();
            expect(onEnd).toHaveBeenCalledTimes(kind === 'ended' ? 1 : 0);
            expect((backend as any).pool_.activeCount).toBe(0);
        });
        it.each(['stopped', 'ended'])('a %s handle cannot change gain or pan of a reused pool node', async kind => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const old = backend.play(bufferHandle, {});
            const first = mockCtx.createBufferSource.mock.results.at(-1).value;
            const gain = first.connect.mock.calls[0][0];
            const panner = gain.connect.mock.calls[0][0];
            if (kind === 'stopped') old.stop(); else first.onended();
            backend.play(bufferHandle, { volume: .7, pan: .3 });
            const next = mockCtx.createBufferSource.mock.results.at(-1).value;
            expect(next.connect.mock.calls[0][0]).toBe(gain);
            old.setVolume(.1); old.setPan(-.9);
            expect(gain.gain.value).toBe(.7); expect(panner.pan.value).toBe(.3);
        });
        it('should create source, connect to bus, and start', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const audioHandle = backend.play(bufferHandle, { volume: 0.8, bus: 'sfx' });

            expect(audioHandle.id).toBeGreaterThan(0);
            expect(mockCtx.createBufferSource).toHaveBeenCalled();
        });

        it('should throw for unknown buffer', async () => {
            await backend.initialize();
            expect(() => backend.play({ id: 999, duration: 0 }, {})).toThrow('Buffer 999 not found');
        });

        it('should not fire onEnd when stop is called explicitly', async () => {
            const { bufferHandle } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, {});

            const onEndSpy = vi.fn();
            handle.onEnd = onEndSpy;
            handle.stop();

            expect(onEndSpy).not.toHaveBeenCalled();
        });

        it('should not double-release pool on stop when onended fires', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);

            const sources: any[] = [];
            mockCtx.createBufferSource.mockImplementation(() => {
                const src = createMockBufferSource();
                sources.push(src);
                return src;
            });

            const handle = backend.play(bufferHandle, {});
            handle.stop();

            const source = sources[sources.length - 1];
            if (source.onended) {
                source.onended();
            }

            expect(handle.isPlaying).toBe(false);
        });
    });

    describe('pause/resume', () => {
        it('a retired source completion cannot end a resumed voice', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const h = backend.play(bufferHandle, {});
            const oldSource = mockCtx.createBufferSource.mock.results.at(-1).value;
            const completed = oldSource.onended;
            mockCtx.currentTime = .25; h.pause(); h.resume(); completed();
            expect(h.isPlaying).toBe(true);
        });
        it('rate changes keep the accumulated position continuous', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, {});
            mockCtx.currentTime = .25;
            expect(handle.currentTime).toBeCloseTo(.25);
            handle.setPlaybackRate(2);
            expect(handle.currentTime).toBeCloseTo(.25);
            mockCtx.currentTime = .5;
            expect(handle.currentTime).toBeCloseTo(.75);
            handle.setPlaybackRate(.5);
            expect(handle.currentTime).toBeCloseTo(.75);
            mockCtx.currentTime = .75;
            expect(handle.currentTime).toBeCloseTo(.875);
        });

        it('pause and resume use the position accumulated across rate changes', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, {});
            mockCtx.currentTime = .25; handle.setPlaybackRate(2);
            mockCtx.currentTime = .5; handle.pause();
            expect(handle.currentTime).toBeCloseTo(.75);
            handle.setPlaybackRate(.5);
            mockCtx.currentTime = 10; handle.resume();
            const source = mockCtx.createBufferSource.mock.results.at(-1).value;
            expect(source.start).toHaveBeenCalledWith(0, expect.closeTo(.75, 5));
            expect(source.playbackRate.value).toBe(.5);
            mockCtx.currentTime = 10.25;
            expect(handle.currentTime).toBeCloseTo(.875);
        });

        describe('a clip the exporter re-encoded', () => {
            // Two seconds of sound that came back from the decoder with a fortieth of a second of silence before it and some after.
            const trim = { seconds: 2, lead: 0.025 };
            const loaded = async (decoded: number) => {
                await backend.initialize();
                const mockCtx = (globalThis as any).__mockAudioContext;
                mockCtx.decodeAudioData.mockResolvedValue({ duration: decoded });
                return { mockCtx, handle: await backend.loadBuffer('theme.mp3', { trim }) };
            };

            it('is as long as it was made, not as long as the decoder left it', async () => {
                expect((await loaded(2.06)).handle.duration).toBeCloseTo(2, 9);
            });

            it('is begun past the silence before it, and stopped where it ends', async () => {
                const { mockCtx, handle } = await loaded(2.06);
                const voice = backend.play(handle, {});
                const source = mockCtx.createBufferSource.mock.results.at(-1).value;
                expect(source.start).toHaveBeenCalledWith(0, expect.closeTo(0.025, 9), expect.closeTo(2, 9));
                expect(source.loopStart).toBeUndefined();
                // Time is counted from where the clip begins.
                mockCtx.currentTime = 0.5;
                expect(voice.currentTime).toBeCloseTo(0.5, 9);
                expect(voice.duration).toBeCloseTo(2, 9);
                backend.play(handle, { startOffset: 0.5 });
                expect(mockCtx.createBufferSource.mock.results.at(-1).value.start).toHaveBeenCalledWith(0, expect.closeTo(0.525, 9), expect.closeTo(1.5, 9));
            });

            it('goes round between its real start and its real end, so a loop made seamless stays so', async () => {
                const { mockCtx, handle } = await loaded(2.06);
                const voice = backend.play(handle, { loop: true });
                const source = mockCtx.createBufferSource.mock.results.at(-1).value;
                expect([source.loop, source.loopStart, source.loopEnd]).toEqual([true, expect.closeTo(0.025, 9), expect.closeTo(2.025, 9)]);
                expect(source.start).toHaveBeenCalledWith(0, expect.closeTo(0.025, 9));
                // Five seconds in it has been round twice and is one second into the third time.
                mockCtx.currentTime = 5; voice.pause();
                expect(voice.currentTime).toBeCloseTo(1, 6);
                voice.resume();
                const next = mockCtx.createBufferSource.mock.results.at(-1).value;
                expect(next.start).toHaveBeenCalledWith(0, expect.closeTo(1.025, 6));
                expect([next.loopStart, next.loopEnd]).toEqual([expect.closeTo(0.025, 9), expect.closeTo(2.025, 9)]);
                // With an introduction, the loop start is counted from the clip's own beginning.
                backend.play(handle, { loop: true, loopStart: 0.8 });
                const led = mockCtx.createBufferSource.mock.results.at(-1).value;
                expect([led.loopStart, led.loopEnd]).toEqual([expect.closeTo(0.825, 9), expect.closeTo(2.025, 9)]);
            });

            it('is not trimmed twice where the decoder took the silence off itself', async () => {
                const { mockCtx, handle } = await loaded(2.0);
                backend.play(handle, { loop: true });
                const source = mockCtx.createBufferSource.mock.results.at(-1).value;
                expect(source.start).toHaveBeenCalledWith(0, 0);
                // The whole buffer is the clip: there is no part of it to go round.
                expect(source.loopStart).toBeUndefined();
                expect(handle.duration).toBeCloseTo(2, 9);
            });
        });

        it('a loop with a loop start goes round from there, and a pause knows where in the round it is', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, { loop: true, loopStart: .4 });
            const source = mockCtx.createBufferSource.mock.results.at(-1).value;
            expect([source.loop, source.loopStart, source.loopEnd]).toEqual([true, .4, 1]);
            // 2.3 s in: once through the second it lasts, then round its last 0.6 s twice and a tenth more.
            mockCtx.currentTime = 2.3; handle.pause();
            expect(handle.currentTime).toBeCloseTo(.5);
            handle.resume();
            const next = mockCtx.createBufferSource.mock.results.at(-1).value;
            expect(next.start).toHaveBeenCalledWith(0, expect.closeTo(.5, 5));
            expect([next.loop, next.loopStart, next.loopEnd]).toEqual([true, .4, 1]);
        });

        it('a loop start means nothing without a loop, or past the end of the clip', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            for (const config of [{ loopStart: .4 }, { loop: true, loopStart: 3 }, { loop: true }]) {
                backend.play(bufferHandle, config);
                expect(mockCtx.createBufferSource.mock.results.at(-1).value.loopStart).toBeUndefined();
            }
        });

        it('looping pause wraps the accumulated position after a rate change', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, { loop: true });
            mockCtx.currentTime = .25; handle.setPlaybackRate(2);
            mockCtx.currentTime = 1.25; handle.pause();
            expect(handle.currentTime).toBeCloseTo(.25);
            handle.resume();
            const source = mockCtx.createBufferSource.mock.results.at(-1).value;
            expect(source.start).toHaveBeenCalledWith(0, expect.closeTo(.25, 5));
        });

        it('a rejected backend rate change leaves position tracking intact', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, {});
            const source = mockCtx.createBufferSource.mock.results.at(-1).value;
            Object.defineProperty(source.playbackRate, 'value', { get: () => 1,
                set: () => { throw new Error('rate rejected'); } });
            mockCtx.currentTime = .25;
            expect(() => handle.setPlaybackRate(2)).toThrow('rate rejected');
            mockCtx.currentTime = .5;
            expect(handle.currentTime).toBeCloseTo(.5);
        });

        it('should pause by stopping source and track position', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);

            const sources: any[] = [];
            mockCtx.createBufferSource.mockImplementation(() => {
                const src = createMockBufferSource();
                sources.push(src);
                return src;
            });

            const handle = backend.play(bufferHandle, {});
            mockCtx.currentTime = 0.5;
            handle.pause();

            expect(handle.isPlaying).toBe(false);
            expect(handle.currentTime).toBeCloseTo(0.5);
        });

        it('should resume by creating new source from paused position', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);

            const sources: any[] = [];
            mockCtx.createBufferSource.mockImplementation(() => {
                const src = createMockBufferSource();
                sources.push(src);
                return src;
            });

            const handle = backend.play(bufferHandle, {});
            mockCtx.currentTime = 0.5;
            handle.pause();
            handle.resume();

            expect(handle.isPlaying).toBe(true);
            expect(sources.length).toBeGreaterThanOrEqual(2);
            const resumedSource = sources[sources.length - 1];
            expect(resumedSource.start).toHaveBeenCalledWith(0, expect.closeTo(0.5, 2));
        });

        it('should preserve playback rate across pause/resume', async () => {
            const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);

            const sources: any[] = [];
            mockCtx.createBufferSource.mockImplementation(() => {
                const src = createMockBufferSource();
                sources.push(src);
                return src;
            });

            const handle = backend.play(bufferHandle, { playbackRate: 1.5 });
            handle.pause();
            handle.resume();

            const resumedSource = sources[sources.length - 1];
            expect(resumedSource.playbackRate.value).toBe(1.5);
        });

        it('should not pause if already paused', async () => {
            const { bufferHandle } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, {});
            handle.pause();
            handle.pause();
            expect(handle.isPlaying).toBe(false);
        });

        it('should not resume if already playing', async () => {
            const { bufferHandle } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, {});
            handle.resume();
            expect(handle.isPlaying).toBe(true);
        });

        it('should not pause or resume after stop', async () => {
            const { bufferHandle } = await initAndLoadBuffer(backend);
            const handle = backend.play(bufferHandle, {});
            handle.stop();
            handle.pause();
            handle.resume();
            expect(handle.isPlaying).toBe(false);
        });
    });

    describe('unloadBuffer', () => {
        it('should remove buffer from cache', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.decodeAudioData.mockResolvedValue({ duration: 1.0 });

            const handle = await backend.loadBuffer('test.mp3');
            backend.unloadBuffer(handle);
            expect(() => backend.play(handle, {})).toThrow();
        });
    });

    describe('suspend/resume backend', () => {
        it('should suspend AudioContext', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            backend.suspend();
            expect(mockCtx.suspend).toHaveBeenCalled();
        });

        it('should resume AudioContext', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            backend.resume();
            expect(mockCtx.resume).toHaveBeenCalled();
        });
    });

    describe('explicit suspension versus autoplay unlock', () => {
        for (const event of ['keydown', 'mousedown', 'touchstart']) {
            it(`keeps the device suspended through ${event} until explicit resume`, async () => {
                const mockCtx = (globalThis as any).__mockAudioContext;
                mockCtx.state = 'suspended';
                await backend.initialize(); backend.suspend();
                document.dispatchEvent(new Event(event));
                expect(mockCtx.resume).not.toHaveBeenCalled();
                backend.resume(); expect(mockCtx.resume).toHaveBeenCalledTimes(1);
                mockCtx.resume.mockClear();
                document.dispatchEvent(new Event(event));
                expect(mockCtx.resume).toHaveBeenCalledTimes(1);
                mockCtx.resume.mockClear();
                document.dispatchEvent(new Event(event));
                expect(mockCtx.resume).not.toHaveBeenCalled();
            });
        }
        it('a late resume cannot reopen the device after a newer suspend request', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended';
            let finish!: () => void;
            mockCtx.resume.mockImplementation(() => new Promise<void>(resolve => { finish = () => { mockCtx.state = 'running'; resolve(); }; }));
            mockCtx.suspend.mockImplementation(async () => { mockCtx.state = 'suspended'; });
            await backend.initialize(); backend.resume(); backend.suspend();
            finish(); await new Promise(resolve => setTimeout(resolve, 0));
            expect(mockCtx.state).toBe('suspended'); expect(mockCtx.suspend).toHaveBeenCalledTimes(2);
        });
        it('a late suspend cannot silence the device after a newer resume request', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            let finish!: () => void;
            mockCtx.suspend.mockImplementation(() => new Promise<void>(resolve => { finish = () => { mockCtx.state = 'suspended'; resolve(); }; }));
            mockCtx.resume.mockImplementation(async () => { mockCtx.state = 'running'; });
            await backend.initialize(); backend.suspend(); backend.resume();
            finish(); await new Promise(resolve => setTimeout(resolve, 0));
            expect(mockCtx.state).toBe('running'); expect(mockCtx.resume).toHaveBeenCalledTimes(2);
        });
        it('a disposed context settling late cannot issue another device transition', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended';
            let finish!: () => void;
            mockCtx.resume.mockImplementation(() => new Promise<void>(resolve => { finish = () => { mockCtx.state = 'running'; resolve(); }; }));
            await backend.initialize(); backend.resume(); backend.suspend(); backend.dispose();
            const count = mockCtx.suspend.mock.calls.length;
            finish(); await new Promise(resolve => setTimeout(resolve, 0));
            expect(mockCtx.suspend).toHaveBeenCalledTimes(count);
        });
        it('preserves ensureResumed rejection when the browser rejects playback', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended'; mockCtx.resume.mockRejectedValue(new Error('playback denied'));
            await backend.initialize();
            await expect(backend.ensureResumed()).rejects.toThrow('playback denied');
            expect(mockCtx.resume).toHaveBeenCalledTimes(1);
        });
        it('does not loop when a current resume settles without unlocking the device', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended';
            await backend.initialize(); backend.resume();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(mockCtx.resume).toHaveBeenCalledTimes(1);
        });
        it('ensureResumed cannot bypass a fullscreen takeover suspension', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended';
            await backend.initialize(); backend.suspend();
            await backend.ensureResumed(); expect(mockCtx.resume).not.toHaveBeenCalled();
            backend.resume(); mockCtx.resume.mockClear();
            await backend.ensureResumed(); expect(mockCtx.resume).toHaveBeenCalledTimes(1);
        });
    });

    it('returns a pooled node when source startup fails repeatedly', async () => {
        const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
        const pool = (backend as any).pool_;
        const capacity = pool.capacity;
        const sources: any[] = [];
        mockCtx.createBufferSource.mockImplementation(() => {
            const source = createMockBufferSource();sources.push(source);
            source.start.mockImplementation(() => { throw new RangeError('negative offset'); });return source;
        });
        for (let i = 0; i < 40; i++) expect(() => backend.play(bufferHandle, { startOffset: -1 })).toThrow('negative offset');
        expect(pool.activeCount).toBe(0);expect(pool.capacity).toBe(capacity);
        for (const source of sources) { expect(source.disconnect).toHaveBeenCalled();expect(source.onended).toBeNull(); }
        mockCtx.createBufferSource.mockImplementation(createMockBufferSource);
        const voice = backend.play(bufferHandle, {});expect(pool.activeCount).toBe(1);
        voice.stop();expect(pool.activeCount).toBe(0);expect(pool.capacity).toBe(capacity);
    });

    it('keeps a failed resume paused and retries from the same offset', async () => {
        const { bufferHandle, mockCtx } = await initAndLoadBuffer(backend);
        const voice = backend.play(bufferHandle, {});mockCtx.currentTime = .25;voice.pause();
        const rejected = createMockBufferSource();rejected.start.mockImplementation(() => { throw new Error('resume rejected'); });
        mockCtx.createBufferSource.mockReturnValueOnce(rejected);
        expect(() => voice.resume()).toThrow('resume rejected');expect(voice.isPlaying).toBe(false);
        expect(voice.currentTime).toBeCloseTo(.25);expect(rejected.disconnect).toHaveBeenCalled();expect(rejected.onended).toBeNull();
        mockCtx.currentTime = 10;voice.resume();expect(voice.isPlaying).toBe(true);
        const accepted = mockCtx.createBufferSource.mock.results.at(-1).value;
        expect(accepted.start).toHaveBeenCalledWith(0, .25);
        voice.stop();expect((backend as any).pool_.activeCount).toBe(0);
    });

    describe('dispose', () => {
        it('should close AudioContext and clear state', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            backend.dispose();
            expect(mockCtx.close).toHaveBeenCalled();
        });

        it('should remove resume listeners on dispose', async () => {
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.state = 'suspended';

            const removeSpy = vi.spyOn(document, 'removeEventListener');
            await backend.initialize();
            backend.dispose();

            expect(removeSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
            expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
            expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
            removeSpy.mockRestore();
        });
    });
});
