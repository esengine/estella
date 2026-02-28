import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebAudioBackend } from '../src/audio/WebAudioBackend';

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
        decodeAudioData: vi.fn(),
        resume: vi.fn().mockResolvedValue(undefined),
        suspend: vi.fn(),
        close: vi.fn(),
    };

    mockCtx.createGain.mockImplementation(() => createMockGainNode(mockCtx));
    mockCtx.createStereoPanner.mockImplementation(() => createMockPannerNode());
    mockCtx.createBufferSource.mockImplementation(() => createMockBufferSource());

    (globalThis as any).AudioContext = vi.fn().mockImplementation(() => mockCtx);
    (globalThis as any).__mockAudioContext = mockCtx;
}

async function initAndLoadBuffer(backend: WebAudioBackend): Promise<{ bufferHandle: any; mockCtx: any }> {
    await backend.initialize();
    const mockCtx = (globalThis as any).__mockAudioContext;
    const mockAudioBuffer = { duration: 1.0 };
    mockCtx.decodeAudioData.mockResolvedValue(mockAudioBuffer);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }));
    const bufferHandle = await backend.loadBuffer('sfx.mp3');
    return { bufferHandle, mockCtx };
}

describe('WebAudioBackend', () => {
    let backend: WebAudioBackend;

    beforeEach(() => {
        setupMockAudioContext();
        backend = new WebAudioBackend();
    });

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
        it('should fetch and decode audio data', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;

            const mockArrayBuffer = new ArrayBuffer(8);
            const mockAudioBuffer = { duration: 2.5, length: 44100 };
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
            }));
            mockCtx.decodeAudioData.mockResolvedValue(mockAudioBuffer);

            const handle = await backend.loadBuffer('test.mp3');
            expect(handle.id).toBeGreaterThan(0);
            expect(handle.duration).toBe(2.5);
            expect(fetch).toHaveBeenCalledWith('test.mp3');
        });

        it('should throw on fetch failure', async () => {
            await backend.initialize();
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
            }));
            await expect(backend.loadBuffer('missing.mp3')).rejects.toThrow('Failed to load audio: missing.mp3 (404)');
        });

        it('should deduplicate concurrent loads for the same URL', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.decodeAudioData.mockResolvedValue({ duration: 1.0 });
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
            }));

            const [h1, h2] = await Promise.all([
                backend.loadBuffer('dup.mp3'),
                backend.loadBuffer('dup.mp3'),
            ]);
            expect(h1.id).toBe(h2.id);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should return cached handle for already loaded URL', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.decodeAudioData.mockResolvedValue({ duration: 2.0 });
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
            }));

            const h1 = await backend.loadBuffer('cached.mp3');
            const h2 = await backend.loadBuffer('cached.mp3');
            expect(h1.id).toBe(h2.id);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should throw if not initialized', async () => {
            await expect(backend.loadBuffer('test.mp3')).rejects.toThrow('AudioContext not initialized');
        });
    });

    describe('play', () => {
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
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
            }));

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
