import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioBus, type AudioBusConfig } from '../src/audio/AudioBus';

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

describe('AudioBus', () => {
    let context: AudioContext;

    beforeEach(() => {
        context = createMockAudioContext();
    });

    it('should create with default volume 1.0', () => {
        const bus = new AudioBus(context, { name: 'test' });
        expect(bus.name).toBe('test');
        expect(bus.volume).toBe(1.0);
        expect(bus.muted).toBe(false);
    });

    it('should create with custom volume', () => {
        const bus = new AudioBus(context, { name: 'music', volume: 0.8 });
        expect(bus.volume).toBe(0.8);
    });

    it('should create muted', () => {
        const bus = new AudioBus(context, { name: 'test', muted: true });
        expect(bus.muted).toBe(true);
    });

    it('should expose the internal GainNode', () => {
        const bus = new AudioBus(context, { name: 'test' });
        expect(bus.node).toBeDefined();
        expect(bus.node.gain).toBeDefined();
    });

    describe('volume', () => {
        it('should set volume and update gain', () => {
            const bus = new AudioBus(context, { name: 'test' });
            bus.volume = 0.5;
            expect(bus.volume).toBe(0.5);
            expect(bus.node.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, 0, 0.015);
        });

        it('should clamp volume to 0-1', () => {
            const bus = new AudioBus(context, { name: 'test' });
            bus.volume = -0.5;
            expect(bus.volume).toBe(0);
            bus.volume = 1.5;
            expect(bus.volume).toBe(1);
        });

        it('should not update gain when muted', () => {
            const bus = new AudioBus(context, { name: 'test', muted: true });
            bus.volume = 0.5;
            expect(bus.volume).toBe(0.5);
            expect(bus.node.gain.setTargetAtTime).not.toHaveBeenCalled();
        });
    });

    describe('mute', () => {
        it('should mute by setting gain to 0', () => {
            const bus = new AudioBus(context, { name: 'test', volume: 0.8 });
            bus.muted = true;
            expect(bus.muted).toBe(true);
            expect(bus.node.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, 0.015);
        });

        it('should unmute by restoring volume', () => {
            const bus = new AudioBus(context, { name: 'test', volume: 0.8 });
            bus.muted = true;
            bus.muted = false;
            expect(bus.node.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 0, 0.015);
        });
    });

    describe('connect', () => {
        it('should connect to another AudioBus', () => {
            const busA = new AudioBus(context, { name: 'a' });
            const busB = new AudioBus(context, { name: 'b' });
            busA.connect(busB);
            expect(busA.node.connect).toHaveBeenCalledWith(busB.node);
        });

        it('should connect to a raw AudioNode', () => {
            const bus = new AudioBus(context, { name: 'test' });
            const dest = {} as AudioNode;
            bus.connect(dest);
            expect(bus.node.connect).toHaveBeenCalledWith(dest);
        });
    });

    describe('addChild', () => {
        it('should connect child to parent', () => {
            const parent = new AudioBus(context, { name: 'parent' });
            const child = new AudioBus(context, { name: 'child' });
            parent.addChild(child);
            expect(child.node.connect).toHaveBeenCalledWith(parent.node);
        });
    });
});
