import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioMixer } from '../src/audio/AudioMixer';

function createMockGainNode(context: AudioContext): GainNode {
    const gain = {
        value: 1.0,
        setTargetAtTime: vi.fn(),
    } as unknown as AudioParam;
    return {
        gain,
        connect: vi.fn(),
        disconnect: vi.fn(),
        context,
    } as unknown as GainNode;
}

function createMockAudioContext(): AudioContext {
    const ctx = {
        currentTime: 0,
        createGain: vi.fn(),
        destination: {} as AudioDestinationNode,
    } as unknown as AudioContext;
    (ctx.createGain as ReturnType<typeof vi.fn>).mockImplementation(() => createMockGainNode(ctx));
    return ctx;
}

describe('AudioMixer', () => {
    let context: AudioContext;

    beforeEach(() => {
        context = createMockAudioContext();
    });

    it('should create 5 default buses', () => {
        const mixer = new AudioMixer(context);
        expect(mixer.master).toBeDefined();
        expect(mixer.music).toBeDefined();
        expect(mixer.sfx).toBeDefined();
        expect(mixer.ui).toBeDefined();
        expect(mixer.voice).toBeDefined();
    });

    it('should connect master to destination', () => {
        const mixer = new AudioMixer(context);
        expect(mixer.master.node.connect).toHaveBeenCalledWith(context.destination);
    });

    it('should connect child buses to master', () => {
        const mixer = new AudioMixer(context);
        expect(mixer.music.node.connect).toHaveBeenCalledWith(mixer.master.node);
        expect(mixer.sfx.node.connect).toHaveBeenCalledWith(mixer.master.node);
        expect(mixer.ui.node.connect).toHaveBeenCalledWith(mixer.master.node);
        expect(mixer.voice.node.connect).toHaveBeenCalledWith(mixer.master.node);
    });

    it('should apply custom volumes', () => {
        const mixer = new AudioMixer(context, {
            masterVolume: 0.9,
            musicVolume: 0.5,
            sfxVolume: 0.7,
            uiVolume: 0.6,
            voiceVolume: 0.8,
        });
        expect(mixer.master.volume).toBe(0.9);
        expect(mixer.music.volume).toBe(0.5);
        expect(mixer.sfx.volume).toBe(0.7);
        expect(mixer.ui.volume).toBe(0.6);
        expect(mixer.voice.volume).toBe(0.8);
    });

    it('should use default volumes', () => {
        const mixer = new AudioMixer(context);
        expect(mixer.master.volume).toBe(1.0);
        expect(mixer.music.volume).toBe(0.8);
        expect(mixer.sfx.volume).toBe(1.0);
        expect(mixer.ui.volume).toBe(1.0);
        expect(mixer.voice.volume).toBe(1.0);
    });

    describe('getBus', () => {
        it('should return bus by name', () => {
            const mixer = new AudioMixer(context);
            expect(mixer.getBus('master')).toBe(mixer.master);
            expect(mixer.getBus('music')).toBe(mixer.music);
            expect(mixer.getBus('sfx')).toBe(mixer.sfx);
            expect(mixer.getBus('ui')).toBe(mixer.ui);
            expect(mixer.getBus('voice')).toBe(mixer.voice);
        });

        it('should return undefined for unknown bus', () => {
            const mixer = new AudioMixer(context);
            expect(mixer.getBus('nonexistent')).toBeUndefined();
        });
    });

    describe('createBus', () => {
        it('should create a custom bus connected to master', () => {
            const mixer = new AudioMixer(context);
            const custom = mixer.createBus({ name: 'ambient', volume: 0.6 });
            expect(custom.name).toBe('ambient');
            expect(custom.volume).toBe(0.6);
            expect(custom.node.connect).toHaveBeenCalledWith(mixer.master.node);
        });

        it('should create a custom bus connected to specified parent', () => {
            const mixer = new AudioMixer(context);
            const custom = mixer.createBus({ name: 'ambient', parent: 'sfx' });
            expect(custom.node.connect).toHaveBeenCalledWith(mixer.sfx.node);
        });

        it('should be retrievable via getBus', () => {
            const mixer = new AudioMixer(context);
            const custom = mixer.createBus({ name: 'ambient' });
            expect(mixer.getBus('ambient')).toBe(custom);
        });
    });
});
