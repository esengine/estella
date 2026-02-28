import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WeChatAudioBackend } from '../src/audio/WeChatAudioBackend';

function createMockInnerAudioContext() {
    return {
        src: '',
        startTime: 0,
        autoplay: false,
        loop: false,
        obeyMuteSwitch: true,
        volume: 1.0,
        playbackRate: 1.0,
        duration: 0,
        currentTime: 0,
        paused: false,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        destroy: vi.fn(),
        onEnded: vi.fn(),
        offEnded: vi.fn(),
        onError: vi.fn(),
    };
}

describe('WeChatAudioBackend', () => {
    let backend: WeChatAudioBackend;

    beforeEach(() => {
        (globalThis as any).wx = {
            createInnerAudioContext: vi.fn().mockImplementation(createMockInnerAudioContext),
        };
        backend = new WeChatAudioBackend();
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
