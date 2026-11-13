// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  soundRender.ts — a sound source worked out into samples, and the samples as a `.wav`.
 *
 *        Every layer is rendered on its own, placed in time, and summed; then what the source says of the whole (a
 *        filter, an echo, a room, a level) is applied to the sum. Nothing depends on the machine: no random number is
 *        drawn that is not seeded, and the arithmetic is plain doubles.
 */
import type { SoundCurve, SoundFilter, SoundLayer, SoundSource } from './soundSource';

export interface RenderedSound {
    rate: number;
    /** One for a sound with nothing off-centre, two otherwise: left, right. */
    channels: Float32Array[];
    seconds: number;
    /** The loudest moment, 0..1, after everything. */
    peak: number;
    /** The level over the whole, as the square root of the mean square. */
    rms: number;
    /** Where each layer sounds and how loud it is on its own, before the sum. */
    layers: { id?: string; source: string; from: number; to: number; peak: number }[];
    notes: string[];
}

const TAU = Math.PI * 2;

/** A curve read at @p t seconds: straight between its points, or along the ratio between them for a pitch. */
function curveAt(curve: SoundCurve | undefined, t: number, fallback: number, ratio: boolean): number {
    if (curve === undefined) return fallback;
    if (typeof curve === 'number') return curve;
    if (t <= curve[0]![0]) return curve[0]![1];
    for (let i = 1; i < curve.length; i++) {
        const [t1, v1] = curve[i]!;
        if (t > t1) continue;
        const [t0, v0] = curve[i - 1]!;
        const w = (t - t0) / (t1 - t0);
        // A pitch glides by ratio: halfway from 200 to 800 Hz is 400, as the ear has it.
        return ratio && v0 > 0 && v1 > 0 ? v0 * Math.pow(v1 / v0, w) : v0 + (v1 - v0) * w;
    }
    return curve.at(-1)![1];
}

/** The same numbers for the same seed, -1..1. */
function noiseOf(seed: number): () => number {
    let s = (seed * 2654435761 + 0x9e3779b9) >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
    };
}

/** What a sharp step would alias as, taken out of the two samples beside it. */
function polyBlep(phase: number, step: number): number {
    if (phase < step) { const t = phase / step; return t + t - t * t - 1; }
    if (phase > 1 - step) { const t = (phase - 1) / step; return t * t + t + t + 1; }
    return 0;
}

/** A two-pole filter whose corner may move: the coefficients are worked out again as it does. */
class Biquad {
    private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
    private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
    private last = -1;
    constructor(private readonly type: SoundFilter['type'], private readonly q: number, private readonly rate: number) {}

    tune(freq: number): void {
        const f = Math.max(20, Math.min(this.rate * 0.45, freq));
        if (Math.abs(f - this.last) < 0.01) return;
        this.last = f;
        const w = (TAU * f) / this.rate;
        const [cos, alpha] = [Math.cos(w), Math.sin(w) / (2 * this.q)];
        const a0 = 1 + alpha;
        let b0: number, b1: number, b2: number;
        switch (this.type) {
            case 'lowpass': [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]; break;
            case 'highpass': [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]; break;
            case 'bandpass': [b0, b1, b2] = [alpha, 0, -alpha]; break;
            default: [b0, b1, b2] = [1, -2 * cos, 1];
        }
        [this.b0, this.b1, this.b2, this.a1, this.a2] = [b0 / a0, b1 / a0, b2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
    }

    run(x: number): number {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        [this.x2, this.x1, this.y2, this.y1] = [this.x1, x, this.y1, y];
        return y;
    }
}

/** One striking of a layer: its samples from its own start, at @p pitch times its written pitch. */
function strike(layer: SoundLayer, seconds: number, rate: number, pitch: number, seed: number): Float32Array {
    const count = Math.max(1, Math.round(seconds * rate));
    const out = new Float32Array(count);
    const random = noiseOf(seed);
    const filters = (layer.filters ?? []).map((f) => ({ run: new Biquad(f.type, f.q ?? 0.7, rate), freq: f.freq }));
    const [attack, release] = [layer.attack ?? 0.002, layer.release ?? 0.01];
    const drive = layer.drive ?? 0;
    const push = 1 + drive * 14;
    const pushed = Math.tanh(push);
    let [phase, bend] = [0, 0];
    // Pink and brown are white put through a few poles; these are their memories.
    let [p0, p1, p2, brown] = [0, 0, 0, 0];

    for (let n = 0; n < count; n++) {
        const t = n / rate;
        let v: number;
        if (layer.source === 'noise') {
            const white = random();
            if (layer.color === 'pink') {
                p0 = 0.99765 * p0 + white * 0.099046;
                p1 = 0.963 * p1 + white * 0.2965164;
                p2 = 0.57 * p2 + white * 1.0526913;
                v = (p0 + p1 + p2 + white * 0.1848) * 0.25;
            } else if (layer.color === 'brown') {
                brown = (brown + white * 0.02) / 1.02;
                v = brown * 3.5;
            } else v = white;
        } else if (layer.source === 'modes') {
            v = 0;
            for (const [hz, loud, dies] of layer.modes!) {
                const f = hz * pitch;
                if (f < rate * 0.48) v += loud * Math.exp(-t / dies) * Math.sin(TAU * f * t);
            }
        } else {
            let hz = curveAt(layer.freq, t, 440, true) * pitch;
            if (layer.vibrato) hz *= Math.pow(2, (layer.vibrato.depth * Math.sin(TAU * layer.vibrato.rate * t)) / 12);
            const step = Math.min(0.49, hz / rate);
            phase += step;
            if (phase >= 1) phase -= Math.floor(phase);
            let at = phase;
            if (layer.fm) {
                bend += step * layer.fm.ratio;
                if (bend >= 1) bend -= Math.floor(bend);
                at = phase + (curveAt(layer.fm.index, t, 0, false) * Math.sin(TAU * bend)) / TAU;
                at -= Math.floor(at);
            }
            switch (layer.source) {
                case 'sine': v = Math.sin(TAU * at); break;
                case 'triangle': v = 1 - 4 * Math.abs(at - 0.5); break;
                case 'saw': v = 2 * at - 1 - (layer.fm ? 0 : polyBlep(at, step)); break;
                default: {
                    const width = layer.width ?? 0.5;
                    v = at < width ? 1 : -1;
                    if (!layer.fm) v += polyBlep(at, step) - polyBlep((at - width + 1) % 1, step);
                }
            }
        }
        for (const f of filters) {
            // The corner is read every 16 samples: often enough for a sweep, seldom enough to cost little.
            if ((n & 15) === 0) f.run.tune(curveAt(f.freq, t, 1000, true));
            v = f.run.run(v);
        }
        if (drive > 0) v = Math.tanh(v * push) / pushed;
        let level = curveAt(layer.gain, t, 1, false);
        if (layer.decay) level *= Math.exp(-t / layer.decay);
        if (layer.tremolo) level *= 1 - layer.tremolo.depth * (0.5 + 0.5 * Math.sin(TAU * layer.tremolo.rate * t));
        if (attack > 0 && t < attack) level *= t / attack;
        const left = seconds - t;
        if (release > 0 && left < release) level *= Math.max(0, left / release);
        out[n] = v * level;
    }
    return out;
}

/** Eight delays and four all-pass loops, as rooms have been faked since the seventies: dense enough to pass for one, cheap enough to run on a sum. */
function room(input: Float32Array, rate: number, size: number, spread: number): Float32Array {
    const scale = rate / 44100;
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), at: 0, damp: 0 }));
    const passes = [556, 441, 341, 225].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), at: 0 }));
    const feedback = 0.7 + size * 0.28;
    const out = new Float32Array(input.length);
    for (let n = 0; n < input.length; n++) {
        const x = input[n]! * 0.015;
        let sum = 0;
        for (const c of combs) {
            const y = c.buf[c.at]!;
            c.damp = y * 0.8 + c.damp * 0.2;
            c.buf[c.at] = x + c.damp * feedback;
            c.at = (c.at + 1) % c.buf.length;
            sum += y;
        }
        for (const p of passes) {
            const y = p.buf[p.at]!;
            p.buf[p.at] = sum + y * 0.5;
            p.at = (p.at + 1) % p.buf.length;
            sum = y - sum;
        }
        out[n] = sum;
    }
    return out;
}

/** The samples a validated source makes. */
export function renderSound(source: SoundSource): RenderedSound {
    const rate = source.rate ?? 44100;
    const count = Math.max(1, Math.round(source.duration * rate));
    // A loop is rendered a little long and its extra folded back over its start, so the end runs into the beginning.
    const fold = source.loop ? Math.min(Math.round(0.08 * rate), Math.floor(count / 2)) : 0;
    const total = count + fold;
    const [left, right] = [new Float32Array(total), new Float32Array(total)];
    const notes: string[] = [];
    const reports: RenderedSound['layers'] = [];
    let stereo = source.reverb !== undefined;

    source.layers.forEach((layer, index) => {
        if (layer.mute) return;
        const start = layer.start ?? 0;
        const room = total / rate - start;
        const seconds = Math.min(layer.length ?? room, room);
        const where = `layer ${index}${layer.id ? ` "${layer.id}"` : ''}`;
        if (!(seconds > 0)) { notes.push(`${where} starts at the end of the sound and is not heard`); return; }
        if (layer.length !== undefined && layer.length > room + 1e-6 && !layer.repeat) notes.push(`${where} is cut short: it runs ${layer.length} s from ${start} s in a sound of ${source.duration} s`);
        const pan = layer.pan ?? 0;
        if (pan !== 0) stereo = true;
        // Equal power: a sound sent to one side is as loud as one in the middle.
        const [gl, gr] = [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];
        const seed = layer.seed ?? index + 1;
        const jitter = noiseOf(seed + 7919);
        const times = layer.repeat?.count ?? 1;
        let [peak, last] = [0, start];
        for (let k = 0; k < times; k++) {
            const at = start + k * (layer.repeat?.every ?? 0) + (k > 0 && layer.repeat?.jitter ? jitter() * layer.repeat.jitter : 0);
            const from = Math.round(Math.max(0, at) * rate);
            if (from >= total) break;
            // Each striking has its own noise, as no two footsteps are the same grit.
            const hit = strike(layer, Math.min(seconds, (total - from) / rate), rate, Math.pow(layer.repeat?.pitch ?? 1, k), seed + k * 131);
            const loud = Math.pow(layer.repeat?.gain ?? 1, k);
            for (let n = 0; n < hit.length && from + n < total; n++) {
                const v = hit[n]! * loud;
                left[from + n]! += v * gl;
                right[from + n]! += v * gr;
                if (Math.abs(v) > peak) peak = Math.abs(v);
            }
            last = Math.min(total / rate, at + hit.length / rate);
        }
        reports.push({ ...(layer.id ? { id: layer.id } : {}), source: layer.source, from: Math.round(start * 1000) / 1000, to: Math.round(last * 1000) / 1000, peak: Math.round(peak * 1000) / 1000 });
        if (peak < 1e-4) notes.push(`${where} makes no sound: its level is nothing throughout`);
    });

    const channels = stereo ? [left, right] : [left.map((v, i) => (v + right[i]!) * Math.SQRT1_2)];
    for (const [c, channel] of channels.entries()) {
        for (const [key, type] of [['highpass', 'highpass'], ['lowpass', 'lowpass']] as const) {
            if (source[key] === undefined) continue;
            const filter = new Biquad(type, 0.7, rate);
            filter.tune(source[key]!);
            for (let n = 0; n < total; n++) channel[n] = filter.run(channel[n]!);
        }
        if (source.echo) {
            const delay = Math.max(1, Math.round(source.echo.time * rate));
            const [feedback, mix] = [source.echo.feedback ?? 0.35, source.echo.mix ?? 0.3];
            const line = new Float32Array(delay);
            for (let n = 0; n < total; n++) {
                const heard = line[n % delay]!;
                line[n % delay] = channel[n]! + heard * feedback;
                channel[n] = channel[n]! + heard * mix;
            }
        }
        if (source.reverb) {
            const mix = source.reverb.mix ?? 0.25;
            // The two sides are rooms a little different, which is what makes it wide.
            const wet = room(channel, rate, source.reverb.size ?? 0.5, c * 23);
            for (let n = 0; n < total; n++) channel[n] = channel[n]! * (1 - mix * 0.5) + wet[n]! * mix;
        }
    }

    const out = channels.map((channel) => {
        const kept = channel.subarray(0, count).slice();
        if (fold > 0) {
            for (let n = 0; n < fold; n++) {
                const w = n / fold;
                kept[n] = kept[n]! * w + channel[count + n]! * (1 - w);
            }
        } else {
            // A sound that stops on a sample that is not nothing clicks: the last three milliseconds are let down.
            const tail = Math.min(count, Math.round(0.003 * rate));
            for (let n = 0; n < tail; n++) kept[count - 1 - n]! *= n / tail;
        }
        return kept;
    });

    let peak = 0;
    for (const channel of out) for (const v of channel) if (Math.abs(v) > peak) peak = Math.abs(v);
    const target = source.gain ?? 0.9;
    if (source.normalize !== false) {
        if (peak > 1e-6) for (const channel of out) for (let n = 0; n < count; n++) channel[n]! *= target / peak;
        else notes.push('the sound is silent: nothing in it reaches a level that can be heard');
        peak = peak > 1e-6 ? target : 0;
    } else {
        for (const channel of out) for (let n = 0; n < count; n++) channel[n]! *= target / 0.9;
        peak *= target / 0.9;
        if (peak > 1) {
            notes.push(`the layers sum to ${peak.toFixed(2)} times full, and what is past full is cut off flat: lower their gain, or leave normalize on`);
            for (const channel of out) for (let n = 0; n < count; n++) channel[n] = Math.max(-1, Math.min(1, channel[n]!));
            peak = 1;
        }
    }
    let squares = 0;
    for (const channel of out) for (const v of channel) squares += v * v;
    return { rate, channels: out, seconds: count / rate, peak, rms: Math.sqrt(squares / (count * out.length)), layers: reports, notes };
}

/** The samples as a 16-bit PCM `.wav`, which every platform the engine runs on plays. */
export function encodeWav(sound: Pick<RenderedSound, 'rate' | 'channels'>): Uint8Array {
    const [channels, frames] = [sound.channels.length, sound.channels[0]!.length];
    const bytes = new Uint8Array(44 + frames * channels * 2);
    const view = new DataView(bytes.buffer);
    const text = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
    text(0, 'RIFF'); view.setUint32(4, 36 + frames * channels * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, sound.rate, true); view.setUint32(28, sound.rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, frames * channels * 2, true);
    for (let n = 0; n < frames; n++) {
        for (let c = 0; c < channels; c++) {
            const v = Math.max(-1, Math.min(1, sound.channels[c]![n]!));
            view.setInt16(44 + (n * channels + c) * 2, Math.round(v * 32767), true);
        }
    }
    return bytes;
}
