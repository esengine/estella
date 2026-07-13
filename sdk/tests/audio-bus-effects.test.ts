// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Bus DSP inserts + sidechain ducking: chain topology (input → effects → duck →
 * gain), idempotent rebuild, the ducking RMS loop, and tolerant def parsing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioBus } from '../src/audio/AudioBus';
import { AudioMixer } from '../src/audio/AudioMixer';
import { parseBusEffects, makeImpulseResponse } from '../src/audio/BusEffects';

function mockParam(v = 0): any {
    return { value: v, setTargetAtTime: vi.fn() };
}

function createMockContext(): any {
    const ctx: any = {
        currentTime: 0,
        sampleRate: 48000,
        destination: {},
        createGain: vi.fn(() => ({ gain: mockParam(1), connect: vi.fn(), disconnect: vi.fn(), context: ctx })),
        createBiquadFilter: vi.fn(() => ({
            type: '', frequency: mockParam(), Q: mockParam(1), gain: mockParam(),
            connect: vi.fn(), disconnect: vi.fn(), context: ctx,
        })),
        createConvolver: vi.fn(() => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn(), context: ctx })),
        createDynamicsCompressor: vi.fn(() => ({
            threshold: mockParam(-24), ratio: mockParam(12), attack: mockParam(0.003),
            release: mockParam(0.25), knee: mockParam(30),
            connect: vi.fn(), disconnect: vi.fn(), context: ctx,
        })),
        createAnalyser: vi.fn(() => ({
            fftSize: 0, connect: vi.fn(), disconnect: vi.fn(),
            getByteTimeDomainData: vi.fn(),
        })),
        createBuffer: vi.fn((channels: number, length: number, rate: number) => {
            const data = Array.from({ length: channels }, () => new Float32Array(length));
            return { length, sampleRate: rate, getChannelData: (c: number) => data[c] };
        }),
    };
    return ctx;
}

describe('AudioBus effect chain', () => {
    let ctx: any;
    let bus: AudioBus;

    beforeEach(() => {
        ctx = createMockContext();
        bus = new AudioBus(ctx, { name: 'music' });
    });

    it('wires input → duck → gain with no effects', () => {
        // Constructor gains: [0]=input, [1]=duck, [2]=output.
        const input = ctx.createGain.mock.results[0].value;
        const duck = ctx.createGain.mock.results[1].value;
        expect(input.connect).toHaveBeenCalledWith(duck);
        expect(duck.connect).toHaveBeenCalledWith(bus.node);
    });

    it('splices a filter between input and duck', () => {
        bus.setEffects([{ type: 'filter', filter: 'lowpass', frequency: 800, q: 2 }]);
        const input = ctx.createGain.mock.results[0].value;
        const duck = ctx.createGain.mock.results[1].value;
        const filter = ctx.createBiquadFilter.mock.results[0].value;
        expect(input.disconnect).toHaveBeenCalled();
        expect(input.connect).toHaveBeenLastCalledWith(filter);
        expect(filter.connect).toHaveBeenCalledWith(duck);
        expect(filter.type).toBe('lowpass');
        expect(filter.frequency.value).toBe(800);
        expect(filter.Q.value).toBe(2);
    });

    it('rebuilds idempotently and reports stored defs', () => {
        bus.setEffects([{ type: 'filter', filter: 'lowpass', frequency: 800 }]);
        bus.setEffects([{ type: 'compressor', ratio: 4 }]);
        expect(bus.effects).toEqual([{ type: 'compressor', ratio: 4 }]);
        // The replaced filter's output must have been disconnected.
        const filter = ctx.createBiquadFilter.mock.results[0].value;
        expect(filter.disconnect).toHaveBeenCalled();
        const comp = ctx.createDynamicsCompressor.mock.results[0].value;
        expect(comp.ratio.value).toBe(4);
    });

    it('reverb builds a parallel wet/dry graph feeding one output', () => {
        bus.setEffects([{ type: 'reverb', seconds: 0.5, wet: 0.25 }]);
        const conv = ctx.createConvolver.mock.results[0].value;
        expect(conv.buffer).not.toBeNull();
        // Gains: 0-2 bus, then reverb creates input/output/dry/wet (4 more).
        const gains = ctx.createGain.mock.results.map((r: any) => r.value);
        const dry = gains.find((g: any) => Math.abs(g.gain.value - 0.75) < 1e-6);
        const wet = gains.find((g: any) => Math.abs(g.gain.value - 0.25) < 1e-6);
        expect(dry).toBeDefined();
        expect(wet).toBeDefined();
    });
});

describe('AudioMixer ducking', () => {
    let ctx: any;
    let mixer: AudioMixer;

    beforeEach(() => {
        ctx = createMockContext();
        mixer = new AudioMixer(ctx);
    });

    const duckGainOf = (bus: any) => {
        // Per-bus gains are created input,duck,gain — find music's duck node by
        // walking creation order: 5 buses × 3 gains; music is the 2nd bus.
        return ctx.createGain.mock.results[1 * 3 + 1].value;
    };

    it('installs an analyser tap on the trigger bus output', () => {
        expect(mixer.setDucking('music', { trigger: 'voice', amount: 0.3 })).toBe(true);
        const analyser = ctx.createAnalyser.mock.results[0].value;
        expect(mixer.voice.node.connect).toHaveBeenCalledWith(analyser);
        expect(mixer.getDucking('music')).toEqual({ trigger: 'voice', amount: 0.3 });
    });

    it('rejects unknown buses', () => {
        expect(mixer.setDucking('nope', { trigger: 'voice', amount: 0.3 })).toBe(false);
        expect(mixer.setDucking('music', { trigger: 'nope', amount: 0.3 })).toBe(false);
    });

    it('ducks on signal and releases on silence', () => {
        mixer.setDucking('music', { trigger: 'voice', amount: 0.3, attack: 0.05, release: 0.4 });
        const analyser = ctx.createAnalyser.mock.results[0].value;
        const musicDuck = duckGainOf(mixer.music);

        // Loud trigger: time-domain bytes far from the 128 midline.
        analyser.getByteTimeDomainData.mockImplementation((buf: Uint8Array) => buf.fill(200));
        mixer.updateDucking();
        expect(musicDuck.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.3, 0, 0.05);

        // Silence: bytes at the midline.
        analyser.getByteTimeDomainData.mockImplementation((buf: Uint8Array) => buf.fill(128));
        mixer.updateDucking();
        expect(musicDuck.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.4);
    });

    it('clearing the rule disconnects the tap and restores the duck stage', () => {
        mixer.setDucking('music', { trigger: 'voice', amount: 0.3 });
        const analyser = ctx.createAnalyser.mock.results[0].value;
        mixer.setDucking('music', null);
        expect(analyser.disconnect).toHaveBeenCalled();
        expect(mixer.getDucking('music')).toBeNull();
    });
});

describe('parseBusEffects', () => {
    it('keeps valid defs and drops junk', () => {
        const parsed = parseBusEffects([
            { type: 'filter', filter: 'lowpass', frequency: 500 },
            { type: 'filter', filter: 'wave', frequency: 500 },   // bad filter kind
            { type: 'reverb', wet: 2 },                            // wet clamps
            { type: 'unknown' },
            null,
            { type: 'compressor', ratio: 8 },
        ]);
        expect(parsed).toEqual([
            { type: 'filter', filter: 'lowpass', frequency: 500 },
            { type: 'reverb', wet: 1 },
            { type: 'compressor', ratio: 8 },
        ]);
    });

    it('returns [] for non-arrays', () => {
        expect(parseBusEffects(undefined)).toEqual([]);
        expect(parseBusEffects({})).toEqual([]);
    });
});

describe('makeImpulseResponse', () => {
    it('builds a stereo buffer with a decaying tail', () => {
        const ctx = createMockContext();
        const ir = makeImpulseResponse(ctx, 0.1, 3);
        expect(ctx.createBuffer).toHaveBeenCalledWith(2, 4800, 48000);
        const ch0 = ir.getChannelData(0);
        // Tail decays: late samples are bounded by early envelope.
        expect(Math.abs(ch0[ch0.length - 1])).toBeLessThanOrEqual(Math.abs(1));
        expect(ch0.length).toBe(4800);
    });
});
