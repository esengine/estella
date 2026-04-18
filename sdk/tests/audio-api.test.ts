import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import type { PlatformAudioBackend, AudioHandle, AudioBufferHandle, PlayConfig } from '../src/audio/PlatformAudioBackend';
import type { AudioMixer } from '../src/audio/AudioMixer';
import type { AudioBus } from '../src/audio/AudioBus';

function createMockHandle(overrides: Partial<AudioHandle> = {}): AudioHandle {
    return {
        id: 1,
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        setVolume: vi.fn(),
        setPan: vi.fn(),
        setLoop: vi.fn(),
        setPlaybackRate: vi.fn(),
        isPlaying: true,
        currentTime: 0,
        duration: 1.0,
        ...overrides,
    };
}

function createMockBus(name: string): AudioBus {
    return {
        name,
        volume: 1.0,
        muted: false,
        node: {} as GainNode,
        connect: vi.fn(),
        addChild: vi.fn(),
    } as unknown as AudioBus;
}

function createMockBackend(): PlatformAudioBackend {
    return {
        name: 'MockBackend',
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureResumed: vi.fn().mockResolvedValue(undefined),
        loadBuffer: vi.fn().mockResolvedValue({ id: 1, duration: 2.0 }),
        unloadBuffer: vi.fn(),
        play: vi.fn().mockReturnValue(createMockHandle()),
        suspend: vi.fn(),
        resume: vi.fn(),
        dispose: vi.fn(),
    };
}

function createMockMixer(): AudioMixer {
    const masterBus = createMockBus('master');
    const musicBus = createMockBus('music');
    const sfxBus = createMockBus('sfx');
    const uiBus = createMockBus('ui');
    const voiceBus = createMockBus('voice');

    return {
        master: masterBus,
        music: musicBus,
        sfx: sfxBus,
        ui: uiBus,
        voice: voiceBus,
        getBus: vi.fn((name: string) => {
            const map: Record<string, AudioBus> = { master: masterBus, music: musicBus, sfx: sfxBus, ui: uiBus, voice: voiceBus };
            return map[name];
        }),
        createBus: vi.fn(),
    } as unknown as AudioMixer;
}

describe('AudioAPI', () => {
    let backend: PlatformAudioBackend;
    let mixer: AudioMixer;
    let audio: AudioAPI;

    beforeEach(() => {
        backend = createMockBackend();
        mixer = createMockMixer();
        audio = new AudioAPI(backend, mixer);
    });

    describe('preload', () => {
        it('should load buffer via backend', async () => {
            await audio.preload('sfx.mp3');
            expect(backend.loadBuffer).toHaveBeenCalledWith('sfx.mp3');
        });

        it('should not reload already cached buffer', async () => {
            await audio.preload('sfx.mp3');
            await audio.preload('sfx.mp3');
            expect(backend.loadBuffer).toHaveBeenCalledTimes(1);
        });
    });

    describe('preloadAll', () => {
        it('should load multiple buffers in parallel', async () => {
            await audio.preloadAll(['a.mp3', 'b.mp3', 'c.mp3']);
            expect(backend.loadBuffer).toHaveBeenCalledTimes(3);
        });
    });

    describe('playSFX', () => {
        it('should play from cached buffer', async () => {
            await audio.preload('click.mp3');
            const handle = audio.playSFX('click.mp3', { volume: 0.5 });
            expect(backend.play).toHaveBeenCalledWith(
                { id: 1, duration: 2.0 },
                expect.objectContaining({ bus: 'sfx', volume: 0.5 })
            );
        });

        it('should return deferred handle for uncached buffer', () => {
            const handle = audio.playSFX('uncached.mp3');
            expect(handle.id).toBe(-1);
            expect(handle.isPlaying).toBe(false);
        });

        it('should delegate deferred handle methods after resolve', async () => {
            await audio.preload('deferred.mp3');
            const mockHandle = createMockHandle({ id: 42 });
            (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(mockHandle);

            const handle = audio.playSFX('deferred.mp3');
            handle.stop();
            expect(mockHandle.stop).toHaveBeenCalled();
        });
    });

    describe('playBGM', () => {
        it('should play as looping music', async () => {
            await audio.preload('bgm.mp3');
            audio.playBGM('bgm.mp3');
            expect(backend.play).toHaveBeenCalledWith(
                { id: 1, duration: 2.0 },
                expect.objectContaining({ bus: 'music', loop: true })
            );
        });

        it('should stop previous BGM', async () => {
            await audio.preload('bgm1.mp3');
            const firstHandle = createMockHandle();
            (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(firstHandle);
            audio.playBGM('bgm1.mp3');

            const secondHandle = createMockHandle();
            (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(secondHandle);
            audio.playBGM('bgm1.mp3');

            expect(firstHandle.stop).toHaveBeenCalled();
        });
    });

    describe('stopBGM', () => {
        it('should stop current BGM', async () => {
            await audio.preload('bgm.mp3');
            const mockHandle = createMockHandle();
            (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(mockHandle);
            audio.playBGM('bgm.mp3');
            audio.stopBGM();
            expect(mockHandle.stop).toHaveBeenCalled();
        });

        it('should do nothing if no BGM playing', () => {
            expect(() => audio.stopBGM()).not.toThrow();
        });
    });

    describe('volume controls', () => {
        it('should set master volume', () => {
            audio.setMasterVolume(0.5);
            expect(mixer.master.volume).toBe(0.5);
        });

        it('should set music volume', () => {
            audio.setMusicVolume(0.3);
            expect(mixer.music.volume).toBe(0.3);
        });

        it('should set sfx volume', () => {
            audio.setSFXVolume(0.7);
            expect(mixer.sfx.volume).toBe(0.7);
        });

        it('should set ui volume', () => {
            audio.setUIVolume(0.6);
            expect(mixer.ui.volume).toBe(0.6);
        });
    });

    describe('muteBus', () => {
        it('should mute specified bus', () => {
            audio.muteBus('sfx', true);
            expect(mixer.getBus).toHaveBeenCalledWith('sfx');
        });
    });

    describe('dispose', () => {
        it('should stop BGM and dispose backend', async () => {
            await audio.preload('bgm.mp3');
            const mockHandle = createMockHandle();
            (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(mockHandle);
            audio.playBGM('bgm.mp3');

            audio.dispose();

            expect(mockHandle.stop).toHaveBeenCalled();
            expect(backend.unloadBuffer).toHaveBeenCalled();
            expect(backend.dispose).toHaveBeenCalled();
        });

        it('should clear buffer cache', async () => {
            await audio.preload('sfx.mp3');
            audio.dispose();
            expect(audio.getBufferHandle('sfx.mp3')).toBeUndefined();
        });

        it('should prevent in-flight preloads from playing after dispose', async () => {
            let resolveLoad!: (v: any) => void;
            (backend.loadBuffer as ReturnType<typeof vi.fn>).mockReturnValue(
                new Promise(r => { resolveLoad = r; })
            );

            audio.playSFX('slow.mp3');
            audio.dispose();

            resolveLoad({ id: 99, duration: 1.0 });
            await new Promise(r => setTimeout(r, 0));

            expect(backend.play).not.toHaveBeenCalledWith(
                expect.objectContaining({ id: 99 }),
                expect.anything()
            );
        });
    });

    describe('isolation', () => {
        it('two AudioAPI instances keep independent buffer caches', async () => {
            const backend2 = createMockBackend();
            const audio2 = new AudioAPI(backend2, createMockMixer());

            await audio.preload('a.mp3');
            expect(backend.loadBuffer).toHaveBeenCalledTimes(1);
            expect(backend2.loadBuffer).not.toHaveBeenCalled();

            await audio2.preload('a.mp3');
            expect(backend2.loadBuffer).toHaveBeenCalledTimes(1);
        });
    });
});
