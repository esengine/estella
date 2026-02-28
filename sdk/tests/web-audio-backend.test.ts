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

            expect(addEventSpy).toHaveBeenCalledWith('touchstart', expect.any(Function), { once: true });
            expect(addEventSpy).toHaveBeenCalledWith('mousedown', expect.any(Function), { once: true });
            expect(addEventSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { once: true });
            addEventSpy.mockRestore();
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
                arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
            }));
            mockCtx.decodeAudioData.mockResolvedValue(mockAudioBuffer);

            const handle = await backend.loadBuffer('test.mp3');
            expect(handle.id).toBeGreaterThan(0);
            expect(handle.duration).toBe(2.5);
            expect(fetch).toHaveBeenCalledWith('test.mp3');
        });

        it('should throw if not initialized', async () => {
            await expect(backend.loadBuffer('test.mp3')).rejects.toThrow('AudioContext not initialized');
        });
    });

    describe('play', () => {
        it('should create source, connect to bus, and start', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;

            const mockAudioBuffer = { duration: 1.0 };
            mockCtx.decodeAudioData.mockResolvedValue(mockAudioBuffer);
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
            }));

            const bufferHandle = await backend.loadBuffer('sfx.mp3');
            const audioHandle = backend.play(bufferHandle, { volume: 0.8, bus: 'sfx' });

            expect(audioHandle.id).toBeGreaterThan(0);
            expect(mockCtx.createBufferSource).toHaveBeenCalled();
        });

        it('should throw for unknown buffer', async () => {
            await backend.initialize();
            expect(() => backend.play({ id: 999, duration: 0 }, {})).toThrow('Buffer 999 not found');
        });
    });

    describe('unloadBuffer', () => {
        it('should remove buffer from cache', async () => {
            await backend.initialize();
            const mockCtx = (globalThis as any).__mockAudioContext;
            mockCtx.decodeAudioData.mockResolvedValue({ duration: 1.0 });
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
            }));

            const handle = await backend.loadBuffer('test.mp3');
            backend.unloadBuffer(handle);
            expect(() => backend.play(handle, {})).toThrow();
        });
    });

    describe('suspend/resume', () => {
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
    });
});
