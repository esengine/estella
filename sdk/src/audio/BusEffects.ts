// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BusEffects.ts
 * @brief   Declarative per-bus DSP inserts — the serializable effect vocabulary
 *          and its WebAudio realization. Defs are pure data (the project audio
 *          config and the editor Mixer speak the same shape); non-WebAudio
 *          backends never see them (AudioAPI gates on a live mixer).
 */

export interface FilterEffectDef {
    type: 'filter';
    filter: 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch';
    frequency: number;
    /** Q factor; meaningful for all but the shelf filters. */
    q?: number;
    /** Boost/cut in dB; meaningful for shelf/peaking filters. */
    gainDb?: number;
}

export interface ReverbEffectDef {
    type: 'reverb';
    /** Impulse length in seconds (tail size). */
    seconds?: number;
    /** Exponential decay rate of the impulse (higher = tighter room). */
    decay?: number;
    /** Wet mix 0..1 (dry is 1 - wet). */
    wet?: number;
}

export interface CompressorEffectDef {
    type: 'compressor';
    thresholdDb?: number;
    ratio?: number;
    attack?: number;
    release?: number;
    kneeDb?: number;
}

export type BusEffectDef = FilterEffectDef | ReverbEffectDef | CompressorEffectDef;

/** A realized effect: a sub-graph with one input and one output node. */
export interface EffectNodes {
    input: AudioNode;
    output: AudioNode;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Procedural impulse response: stereo noise with an exponential decay tail.
 * Good-enough room ambience with zero asset dependencies; a convolution IR
 * asset can slot in later without changing the def shape.
 */
export function makeImpulseResponse(context: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = context.sampleRate;
    const length = Math.max(1, Math.floor(rate * Math.max(0.05, seconds)));
    const buffer = context.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        }
    }
    return buffer;
}

function buildFilter(context: BaseAudioContext, def: FilterEffectDef): EffectNodes {
    const node = context.createBiquadFilter();
    node.type = def.filter;
    node.frequency.value = Math.max(10, def.frequency);
    if (def.q !== undefined) node.Q.value = def.q;
    if (def.gainDb !== undefined) node.gain.value = def.gainDb;
    return { input: node, output: node };
}

function buildReverb(context: BaseAudioContext, def: ReverbEffectDef): EffectNodes {
    const input = context.createGain();
    const output = context.createGain();
    const wet = clamp01(def.wet ?? 0.35);

    const dryGain = context.createGain();
    dryGain.gain.value = 1 - wet;
    input.connect(dryGain);
    dryGain.connect(output);

    const convolver = context.createConvolver();
    convolver.buffer = makeImpulseResponse(context, def.seconds ?? 1.5, def.decay ?? 3.0);
    const wetGain = context.createGain();
    wetGain.gain.value = wet;
    input.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(output);

    return { input, output };
}

function buildCompressor(context: BaseAudioContext, def: CompressorEffectDef): EffectNodes {
    const node = context.createDynamicsCompressor();
    if (def.thresholdDb !== undefined) node.threshold.value = def.thresholdDb;
    if (def.ratio !== undefined) node.ratio.value = Math.max(1, def.ratio);
    if (def.attack !== undefined) node.attack.value = Math.max(0, def.attack);
    if (def.release !== undefined) node.release.value = Math.max(0, def.release);
    if (def.kneeDb !== undefined) node.knee.value = Math.max(0, def.kneeDb);
    return { input: node, output: node };
}

/** Realize one effect def as a WebAudio sub-graph. */
export function buildEffectNodes(context: BaseAudioContext, def: BusEffectDef): EffectNodes {
    switch (def.type) {
        case 'filter': return buildFilter(context, def);
        case 'reverb': return buildReverb(context, def);
        case 'compressor': return buildCompressor(context, def);
    }
}

/** Normalize arbitrary JSON into a valid effect list (tolerant; drops junk). */
export function parseBusEffects(raw: unknown): BusEffectDef[] {
    if (!Array.isArray(raw)) return [];
    const out: BusEffectDef[] = [];
    for (const e of raw) {
        if (!e || typeof e !== 'object') continue;
        const t = (e as { type?: unknown }).type;
        if (t === 'filter') {
            const f = e as FilterEffectDef;
            const kinds = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch'];
            if (!kinds.includes(f.filter) || typeof f.frequency !== 'number') continue;
            out.push({
                type: 'filter', filter: f.filter, frequency: f.frequency,
                ...(typeof f.q === 'number' ? { q: f.q } : {}),
                ...(typeof f.gainDb === 'number' ? { gainDb: f.gainDb } : {}),
            });
        } else if (t === 'reverb') {
            const r = e as ReverbEffectDef;
            out.push({
                type: 'reverb',
                ...(typeof r.seconds === 'number' ? { seconds: r.seconds } : {}),
                ...(typeof r.decay === 'number' ? { decay: r.decay } : {}),
                ...(typeof r.wet === 'number' ? { wet: clamp01(r.wet) } : {}),
            });
        } else if (t === 'compressor') {
            const c = e as CompressorEffectDef;
            out.push({
                type: 'compressor',
                ...(typeof c.thresholdDb === 'number' ? { thresholdDb: c.thresholdDb } : {}),
                ...(typeof c.ratio === 'number' ? { ratio: c.ratio } : {}),
                ...(typeof c.attack === 'number' ? { attack: c.attack } : {}),
                ...(typeof c.release === 'number' ? { release: c.release } : {}),
                ...(typeof c.kneeDb === 'number' ? { kneeDb: c.kneeDb } : {}),
            });
        }
    }
    return out;
}
