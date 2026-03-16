import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlugin, audioPlugin } from '../src/audio/AudioPlugin';
import { Audio } from '../src/audio/Audio';
import type { AudioHandle, AudioBufferHandle, PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';
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
    const masterBus = createMockBus('master');
    const musicBus = createMockBus('music');
    const sfxBus = createMockBus('sfx');
    const mixer = {
        master: masterBus,
        music: musicBus,
        sfx: sfxBus,
        ui: createMockBus('ui'),
        voice: createMockBus('voice'),
        getBus: vi.fn((name: string) => {
            const map: Record<string, AudioBus> = { master: masterBus, music: musicBus, sfx: sfxBus };
            return map[name] ?? sfxBus;
        }),
        createBus: vi.fn(),
    } as unknown as AudioMixer;

    return {
        name: 'MockBackend',
        mixer,
        isReady: true,
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureResumed: vi.fn().mockResolvedValue(undefined),
        loadBuffer: vi.fn().mockResolvedValue({ id: 1, duration: 2.0 }),
        unloadBuffer: vi.fn(),
        play: vi.fn().mockReturnValue(createMockHandle()),
        suspend: vi.fn(),
        resume: vi.fn(),
        dispose: vi.fn(),
    } as unknown as PlatformAudioBackend;
}

describe('AudioPlugin', () => {
    it('should be exported as singleton', () => {
        expect(audioPlugin).toBeInstanceOf(AudioPlugin);
    });

    it('should have name "AudioPlugin"', () => {
        expect(audioPlugin.name).toBe('audio');
    });

    it('should have a build method', () => {
        expect(typeof audioPlugin.build).toBe('function');
    });

    it('should accept config options', () => {
        const plugin = new AudioPlugin({
            initialPoolSize: 32,
            masterVolume: 0.8,
            musicVolume: 0.5,
            sfxVolume: 0.9,
        });
        expect(plugin.name).toBe('audio');
    });

    it('should call Audio.dispose on cleanup', () => {
        const disposeSpy = vi.spyOn(Audio, 'dispose').mockImplementation(() => {});
        const plugin = new AudioPlugin();
        plugin.cleanup();
        expect(disposeSpy).toHaveBeenCalled();
        disposeSpy.mockRestore();
    });

    describe('stopAllSources', () => {
        it('should stop all active handles and clear the map', () => {
            const plugin = new AudioPlugin();
            const handle1 = createMockHandle({ id: 1 });
            const handle2 = createMockHandle({ id: 2 });

            const handles = new Map<number, AudioHandle>();
            handles.set(10, handle1);
            handles.set(20, handle2);
            (plugin as any).activeSourceHandles_ = handles;

            plugin.stopAllSources();

            expect(handle1.stop).toHaveBeenCalled();
            expect(handle2.stop).toHaveBeenCalled();
            expect(handles.size).toBe(0);
        });

        it('should clear playedEntities so playOnAwake can retrigger', () => {
            const plugin = new AudioPlugin();
            const played = new Set<number>([10, 20]);
            (plugin as any).playedEntities_ = played;
            (plugin as any).activeSourceHandles_ = new Map();

            plugin.stopAllSources();

            expect(played.size).toBe(0);
        });

        it('should be safe to call when not built', () => {
            const plugin = new AudioPlugin();
            expect(() => plugin.stopAllSources()).not.toThrow();
        });
    });

    describe('cleanup', () => {
        it('should call stopAllSources then Audio.dispose', () => {
            const plugin = new AudioPlugin();
            const stopSpy = vi.spyOn(plugin, 'stopAllSources');
            const disposeSpy = vi.spyOn(Audio, 'dispose').mockImplementation(() => {});

            plugin.cleanup();

            expect(stopSpy).toHaveBeenCalled();
            expect(disposeSpy).toHaveBeenCalled();
            const stopOrder = stopSpy.mock.invocationCallOrder[0];
            const disposeOrder = disposeSpy.mock.invocationCallOrder[0];
            expect(stopOrder).toBeLessThan(disposeOrder);

            stopSpy.mockRestore();
            disposeSpy.mockRestore();
        });
    });
});

describe('Audio.stopAll', () => {
    let backend: PlatformAudioBackend;

    beforeEach(() => {
        backend = createMockBackend();
        Audio.init(backend, backend.mixer);
    });

    it('should stop BGM without disposing backend', async () => {
        await Audio.preload('bgm.mp3');
        const bgmHandle = createMockHandle();
        (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(bgmHandle);
        Audio.playBGM('bgm.mp3');

        Audio.stopAll();

        expect(bgmHandle.stop).toHaveBeenCalled();
        expect(backend.dispose).not.toHaveBeenCalled();
        expect(Audio.getBufferHandle('bgm.mp3')).toBeDefined();
    });

    it('should allow playing new BGM after stopAll', async () => {
        await Audio.preload('bgm.mp3');
        const firstHandle = createMockHandle();
        (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(firstHandle);
        Audio.playBGM('bgm.mp3');
        Audio.stopAll();

        const secondHandle = createMockHandle();
        (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(secondHandle);
        Audio.playBGM('bgm.mp3');

        expect(backend.play).toHaveBeenCalledTimes(2);
    });

    it('should be safe to call when no audio is playing', () => {
        expect(() => Audio.stopAll()).not.toThrow();
    });
});
