// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  soundRender.ts — a sound source worked out into samples, and the samples as a `.wav`.
 *
 *        Every layer is rendered on its own, placed in time, and summed; then what the source says of the whole (a
 *        filter, an echo, a place, a level) is applied to the sum. Nothing depends on the machine: no random number is
 *        drawn that is not seeded, and the arithmetic is plain doubles.
 *
 *        What makes a made sound pass for a real one is mostly here, and it is not more kinds of wave. A bang is several
 *        bands of noise that die at different rates, the high ones first, behind a spike a fifth of a millisecond wide;
 *        a breaking thing is hundreds of small rings scattered in time and pitch; a place is a wash whose top dies before
 *        its bottom, after a handful of distinct first echoes. A layer of noise through one filter with one decay has
 *        none of that and is heard at once as a machine.
 */
import { fft } from './fft';
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
    layers: { id?: string; source: string; from: number; to: number; peak: number; strikes?: number }[];
    notes: string[];
}

const TAU = Math.PI * 2;
/** The level white noise has here, which a band of it is brought back to. */
const NOISE_LEVEL = 1 / Math.sqrt(3);

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
    return curve[curve.length - 1]![1];
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
    constructor(private readonly type: SoundFilter['type'], private readonly q: number, private readonly rate: number, private readonly gainDb = 0) {}

    tune(freq: number): void {
        const f = Math.max(20, Math.min(this.rate * 0.45, freq));
        if (Math.abs(f - this.last) < 0.01) return;
        this.last = f;
        const w = (TAU * f) / this.rate;
        const [cos, alpha] = [Math.cos(w), Math.sin(w) / (2 * this.q)];
        let a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
        let b0: number, b1: number, b2: number;
        switch (this.type) {
            case 'lowpass': [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]; break;
            case 'highpass': [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]; break;
            case 'bandpass': [b0, b1, b2] = [alpha, 0, -alpha]; break;
            case 'peak': {
                const lift = Math.pow(10, this.gainDb / 40);
                [b0, b1, b2] = [1 + alpha * lift, -2 * cos, 1 - alpha * lift];
                [a0, a1, a2] = [1 + alpha / lift, -2 * cos, 1 - alpha / lift];
                break;
            }
            default: [b0, b1, b2] = [1, -2 * cos, 1];
        }
        [this.b0, this.b1, this.b2, this.a1, this.a2] = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    }

    run(x: number): number {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        // Plain assignments: this runs once a sample for every filter of every note, and a list built to be taken apart again
        // was a quarter of the time a piece of music took to make.
        this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
        return y;
    }
}

const rmsOf = (a: Float32Array): number => { let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / Math.max(1, a.length)); };

/** @p count samples of a noise layer's own sound, before its loudness is shaped: its colour, and its band at the level of the whole. */
function noiseBody(layer: SoundLayer, count: number, rate: number, seed: number, pitch: number): Float32Array {
    const random = noiseOf(seed);
    const out = new Float32Array(count);
    // Pink and brown are white put through a few poles; these are their memories.
    let [p0, p1, p2, brown] = [0, 0, 0, 0];
    for (let n = 0; n < count; n++) {
        const white = random();
        if (layer.color === 'pink') {
            p0 = 0.99765 * p0 + white * 0.099046;
            p1 = 0.963 * p1 + white * 0.2965164;
            p2 = 0.57 * p2 + white * 1.0526913;
            out[n] = (p0 + p1 + p2 + white * 0.1848) * 0.25;
        } else if (layer.color === 'brown') {
            brown = (brown + white * 0.02) / 1.02;
            out[n] = brown * 3.5;
        } else out[n] = white;
    }
    if (layer.band) {
        // Cut to the band, then brought back up: what is left of noise after two filters is faint, and a band that
        // had to be turned up by guess would never balance against the others.
        const [high, low] = [new Biquad('highpass', 0.7, rate), new Biquad('lowpass', 0.7, rate)];
        high.tune(layer.band[0] * pitch);
        low.tune(layer.band[1] * pitch);
        // Run in a little first, so the filters are not still starting when the sound is.
        for (let n = 0; n < 64; n++) low.run(high.run(random()));
        for (let n = 0; n < count; n++) out[n] = low.run(high.run(out[n]!));
        const level = rmsOf(out);
        if (level > 1e-9) for (let n = 0; n < count; n++) out[n]! *= NOISE_LEVEL / level;
    }
    return out;
}

/** A recording a layer plays: its samples and the rate they were made at. */
export interface SoundRecording { rate: number; channels: readonly Float32Array[] }

/** @p count samples of a recording, its two sides as one, played at @p speed from @p from seconds in. Past its end is silence. */
function recordingBody(recording: SoundRecording, count: number, rate: number, speed: number, from: number): Float32Array {
    const out = new Float32Array(count);
    const [l, r] = [recording.channels[0]!, recording.channels[1] ?? recording.channels[0]!];
    const step = (speed * recording.rate) / rate;
    const start = from * recording.rate;
    for (let n = 0; n < count; n++) {
        const p = start + n * step;
        const i = Math.floor(p);
        if (i + 1 >= l.length) break;
        const t = p - i;
        out[n] = ((l[i]! + r[i]!) * (1 - t) + (l[i + 1]! + r[i + 1]!) * t) / 2;
    }
    return out;
}

/** One striking of a layer: its samples from its own start, at @p pitch times its written pitch. */
function strike(layer: SoundLayer, seconds: number, rate: number, pitch: number, seed: number, recording: SoundRecording | null = null): Float32Array {
    const count = Math.max(1, Math.round(seconds * rate));
    const out = new Float32Array(count);
    const filters = (layer.filters ?? []).map((f) => ({ run: new Biquad(f.type, f.q ?? 0.7, rate, f.gain ?? 0), freq: f.freq }));
    // The fades that only stop a click are never most of a short layer: a strike two milliseconds long keeps its front.
    const [attack, release] = [layer.attack ?? (layer.source === 'impulse' ? 0 : Math.min(0.002, seconds * 0.1)), layer.release ?? Math.min(0.01, seconds * 0.25)];
    const drive = layer.drive ?? 0;
    const push = 1 + drive * 14;
    const pushed = Math.tanh(push);
    // What is made ahead of the loop: a noise, or a recording played at its speed.
    const noise = layer.source === 'noise' ? noiseBody(layer, count, rate, seed, pitch)
        : layer.source === 'sample' ? recordingBody(recording!, count, rate, (layer.speed ?? 1) * pitch, layer.from ?? 0) : null;
    // A spike: up in one sample and down over its width, as the air does in front of a bang.
    const spike = layer.source === 'impulse' ? (layer.width ?? 0.0002) * rate : 0;
    let [phase, bend] = [0, 0];

    for (let n = 0; n < count; n++) {
        const t = n / rate;
        let v: number;
        if (noise) v = noise[n]!;
        else if (layer.source === 'impulse') {
            const b = n / spike;
            v = b < 10 ? (1 - b) * Math.exp(-b) : 0;
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
            // The corner is read every 16 samples: often enough for a sweep, seldom enough to cost little. A noise struck
            // at another pitch has no pitch of its own to move, so its filters move instead.
            if ((n & 15) === 0) f.run.tune(curveAt(f.freq, t, 1000, true) * (noise ? pitch : 1));
            v = f.run.run(v);
        }
        if (drive > 0) v = Math.tanh(v * push) / pushed;
        let level = curveAt(layer.gain, t, 1, false);
        if (layer.decay) {
            const fast = Math.exp(-t / layer.decay);
            level *= layer.tail ? fast * (1 - layer.tail.mix) + Math.exp(-t / layer.tail.decay) * layer.tail.mix : fast;
        }
        if (layer.tremolo) level *= 1 - layer.tremolo.depth * (0.5 + 0.5 * Math.sin(TAU * layer.tremolo.rate * t));
        if (attack > 0 && t < attack) level *= t / attack;
        const left = seconds - t;
        if (release > 0 && left < release) level *= Math.max(0, left / release);
        out[n] = v * level;
    }
    return out;
}

/** @p a and @p b laid over one another at every offset: what a sound becomes in a place whose answer to a click is @p b. */
export function convolve(a: Float32Array, b: Float32Array, keep: number): Float32Array {
    let size = 1;
    while (size < a.length + b.length) size <<= 1;
    const [ar, ai, br, bi] = [new Float64Array(size), new Float64Array(size), new Float64Array(size), new Float64Array(size)];
    ar.set(a); br.set(b);
    fft(ar, ai); fft(br, bi);
    for (let k = 0; k < size; k++) {
        const [re, im] = [ar[k]! * br[k]! - ai[k]! * bi[k]!, ar[k]! * bi[k]! + ai[k]! * br[k]!];
        // Back the same way: the transform of the conjugate, conjugated and shared out.
        ar[k] = re; ai[k] = -im;
    }
    fft(ar, ai);
    const out = new Float32Array(keep);
    for (let n = 0; n < keep; n++) out[n] = ar[n]! / size;
    return out;
}

/**
 * What a place answers to one click, for one ear. A room: noise in three bands that each die at their own rate, the
 * top in half the time of the bottom, coming up over a hundredth of a second, with thirty-odd distinct first echoes
 * ahead of it. Open ground: a few slaps off far walls, each duller than the last, and a long faint tail.
 */
export function placeResponse(rate: number, size: number, kind: 'room' | 'open', side: number): Float32Array {
    const random = noiseOf(kind === 'room' ? 6923 + side * 977 : 32324 + side * 977);
    const unit = (): number => random() * 0.5 + 0.5;
    const seconds = kind === 'room' ? 0.35 + size * 2.4 : 0.6 + size * 2.6;
    const count = Math.floor(rate * seconds);
    const out = new Float32Array(count);
    const banded = (low: number | null, high: number | null): Float32Array => {
        const buf = new Float32Array(count);
        const [hp, lp] = [low ? new Biquad('highpass', 0.6, rate) : null, high ? new Biquad('lowpass', 0.6, rate) : null];
        hp?.tune(low!); lp?.tune(high!);
        for (let n = 0; n < count; n++) { let v = random(); if (hp) v = hp.run(v); if (lp) v = lp.run(v); buf[n] = v; }
        const level = rmsOf(buf) || 1;
        for (let n = 0; n < count; n++) buf[n]! /= level;
        return buf;
    };
    if (kind === 'room') {
        // Seconds for each band to fall by sixty decibels.
        const long = 0.25 + size * 1.5;
        const bands: [Float32Array, number, number][] = [[banded(null, 420), 0.45, long], [banded(420, 3000), 1, long * 0.8], [banded(3000, null), 1.6, long * 0.4]];
        for (let n = 0; n < count; n++) {
            const t = n / rate;
            const rise = 1 - Math.exp(-t / 0.014);
            let v = 0;
            for (const [buf, loud, falls] of bands) v += buf[n]! * loud * Math.pow(10, (-3 * t) / falls);
            out[n] = v * rise;
        }
        const wash = rmsOf(out) * Math.sqrt(count);
        const first = new Float32Array(count);
        for (let e = 0; e < 34; e++) {
            const t = (0.0048 + 0.088 * Math.pow((e + unit()) / 34, 1.5)) * (0.45 + size) * (side ? 1.07 : 1);
            const at = Math.floor(t * rate);
            const loud = (random() < 0 ? -1 : 1) * Math.exp(-t / 0.034) * (0.55 + 0.45 * unit());
            // Later echoes have travelled further and are smeared wider.
            const width = 1 + Math.floor(t * 60);
            for (let n = 0; n < width && at + n < count; n++) first[at + n]! += (loud * (1 - n / width)) / Math.sqrt(width);
        }
        const firstLevel = rmsOf(first) * Math.sqrt(count) || 1;
        for (let n = 0; n < count; n++) out[n]! += first[n]! * ((0.78 * wash) / firstLevel);
    } else {
        for (const [t, loud, milliseconds, top] of [[0.094, 0.5, 5, 5200], [0.151, 0.4, 8, 3800], [0.212, 0.31, 12, 2700], [0.289, 0.24, 16, 2000]] as const) {
            const length = Math.floor((rate * milliseconds * 4) / 1000);
            const [lp, hp] = [new Biquad('lowpass', 0.6, rate), new Biquad('highpass', 0.6, rate)];
            lp.tune(top); hp.tune(180);
            const slap = new Float32Array(length);
            for (let n = 0; n < length; n++) slap[n] = hp.run(lp.run(random())) * Math.exp(-n / ((rate * milliseconds) / 1000)) * (1 - Math.exp(-n / (rate * 0.0006)));
            const level = rmsOf(slap) * Math.sqrt(length) || 1;
            const at = Math.floor(rate * t * (0.5 + size) * (1 + 0.1 * random() * 0.5));
            const share = (loud * (0.45 + 0.55 * (side ? 1 - unit() : unit()))) / level;
            for (let n = 0; n < length && at + n < count; n++) out[at + n]! += slap[n]! * share;
        }
        const slaps = rmsOf(out) * Math.sqrt(count) || 1;
        const tail = banded(320, 2300);
        const falls = 1 + size * 2;
        let tailSquares = 0;
        for (let n = 0; n < count; n++) {
            const t = n / rate;
            tail[n] = tail[n]! * Math.pow(10, (-3 * t) / falls) * (1 - Math.exp(-t / 0.11));
            tailSquares += tail[n]! * tail[n]!;
        }
        const tailLevel = Math.sqrt(tailSquares) || 1;
        for (let n = 0; n < count; n++) out[n]! += tail[n]! * ((0.5 * slaps) / tailLevel);
    }
    // Let down at its end, and of one energy whatever its size: `mix` then means the same in a closet and a hall.
    const fade = Math.floor(count * 0.08);
    for (let n = 0; n < fade; n++) out[count - 1 - n]! *= n / fade;
    const energy = rmsOf(out) * Math.sqrt(count) || 1;
    for (let n = 0; n < count; n++) out[n]! /= energy;
    return out;
}

interface Strike { at: number; pitch: number; loud: number; pan: number; seed: number }

/** When a layer is struck, and how: once, again by `repeat`, or many times at random by `scatter`. */
function strikesOf(layer: SoundLayer, start: number, seed: number): Strike[] {
    const pan = layer.pan ?? 0;
    if (layer.scatter) {
        const c = layer.scatter;
        const random = noiseOf(seed + 4409);
        const unit = (): number => random() * 0.5 + 0.5;
        const [p0, p1] = c.pitch ?? [1, 1];
        const [g0, g1] = c.gain ?? [1, 1];
        return Array.from({ length: c.count }, (_, k) => {
            const when = Math.pow(unit(), c.early ?? 1);
            return {
                at: start + c.over * when,
                // Between two pitches by ratio, so there are as many strikes in each octave of the range.
                pitch: p0 * Math.pow(p1 / p0, unit()),
                loud: (g0 + (g1 - g0) * unit()) * (1 - (c.fade ?? 0) * when),
                pan: Math.max(-1, Math.min(1, pan + (c.pan ?? 0) * random())),
                seed: seed + k * 131,
            };
        }).sort((a, b) => a.at - b.at);
    }
    const r = layer.repeat;
    const jitter = noiseOf(seed + 7919);
    const out: Strike[] = [];
    let [at, gap] = [start, r?.every ?? 0];
    for (let k = 0; k < (r?.count ?? 1); k++) {
        out.push({ at: at + (k > 0 && r?.jitter ? jitter() * r.jitter : 0), pitch: Math.pow(r?.pitch ?? 1, k), loud: Math.pow(r?.gain ?? 1, k), pan, seed: seed + k * 131 });
        at += gap;
        // A thing bouncing to rest: each gap shorter than the last.
        gap *= r?.faster ?? 1;
    }
    return out;
}

/** Where and how an event is struck: what a group hands down to the layers in it. */
interface Placement { offset: number; pitch: number; loud: number; pan: number; seed: number }

/** How a variant of a layer strays from the layer as written. */
interface Stray { pitch: number; loud: number; decay: number; late: number; seed: number }

/**
 * The samples a validated source makes. @p variant 0 is the sound as written; another is the same sound a little
 * unlike it, as a second shot from the same gun is: other noise, and each layer's pitch, loudness, decay and timing
 * off by up to the source's `vary`.
 *
 * @p at is for a sound played as a note: `pitch` times its written pitch, with `seed` for other noise, and `raw`
 * leaving its level as the layers sum to, so that many notes keep their balance against one another.
 */
export function renderSound(source: SoundSource, variant = 0, at: { pitch?: number; seed?: number; raw?: boolean; given?: Readonly<Record<string, SoundRecording>> } = {}): RenderedSound {
    const rate = source.rate ?? 44100;
    const count = Math.max(1, Math.round(source.duration * rate));
    // A loop is rendered a little long and its extra folded back over its start, so the end runs into the beginning.
    const fold = source.loop ? Math.min(Math.round(0.08 * rate), Math.floor(count / 2)) : 0;
    const total = count + fold;
    const [left, right] = [new Float32Array(total), new Float32Array(total)];
    const notes: string[] = [];
    const reports: RenderedSound['layers'] = [];
    let stereo = source.reverb !== undefined;

    const vary = variant > 0 ? source.vary ?? 0.06 : 0;
    const strayRandom = noiseOf(variant * 7717 + 13);
    const strays = new Map<SoundLayer, Stray>();
    const strayOf = (layer: SoundLayer): Stray => {
        let s = strays.get(layer);
        if (!s) {
            s = vary > 0
                ? { pitch: 1 + vary * strayRandom(), loud: 1 + vary * 2 * strayRandom(), decay: 1 + vary * 1.5 * strayRandom(), late: 1 + vary * strayRandom(), seed: variant * 1009 }
                : { pitch: 1, loud: 1, decay: 1, late: 1, seed: 0 };
            strays.set(layer, s);
        }
        return s;
    };

    /** One layer, or a group of them, struck where @p place says. Answers how loud it was and when it ended. */
    const play = (layer: SoundLayer, index: number, where: string, place: Placement, top: boolean): { peak: number; last: number; heard: number; strikes: number } => {
        const stray = strayOf(layer);
        // A layer that comes after the start of its event comes a little sooner or later in another variant.
        const start = place.offset + (layer.start ?? 0) * stray.late;
        const seed = (layer.seed ?? index + 1) + place.seed + stray.seed;
        if (layer.source === 'group') {
            const strikes = strikesOf(layer, start, seed);
            const loud = (typeof layer.gain === 'number' ? layer.gain : 1) * stray.loud;
            let [peak, last, heard] = [0, start, 0];
            for (const s of strikes) {
                if (s.at * rate >= total) continue;
                heard++;
                layer.layers!.forEach((child, j) => {
                    if (child.mute) return;
                    const made = play(child, j, `${where} > layer ${j}${child.id ? ` "${child.id}"` : ''}`,
                        { offset: s.at, pitch: place.pitch * s.pitch, loud: place.loud * s.loud * loud, pan: Math.max(-1, Math.min(1, place.pan + s.pan)), seed: s.seed + j * 977 }, false);
                    peak = Math.max(peak, made.peak);
                    last = Math.max(last, made.last);
                });
            }
            return { peak, last, heard, strikes: strikes.length };
        }
        const space = total / rate - start;
        const recording = layer.source === 'sample' ? at.given?.[layer.file!] ?? null : null;
        if (layer.source === 'sample' && !recording) throw new Error(`${where}: the recording ${layer.file} was not found`);
        // A recording lasts as long as it lasts, at the speed it is played.
        const whole = recording ? Math.max(0.001, (recording.channels[0]!.length / recording.rate - (layer.from ?? 0)) / ((layer.speed ?? 1) * place.pitch * stray.pitch)) : space;
        const seconds = Math.min(layer.length ?? whole, space);
        if (!(seconds > 0)) {
            if (top) notes.push(`${where} starts at the end of the sound and is not heard`);
            return { peak: 0, last: start, heard: 0, strikes: 0 };
        }
        if (top && layer.length !== undefined && layer.length > space + 1e-6 && !layer.repeat && !layer.scatter) notes.push(`${where} is cut short: it runs ${layer.length} s from ${Math.round(start * 1000) / 1000} s in a sound of ${source.duration} s`);
        const wide = layer.source === 'noise' ? layer.wide ?? 0 : 0;
        // The variant's own layer: the same in everything but how long it rings.
        const made = stray.decay !== 1 && layer.decay
            ? { ...layer, decay: layer.decay * stray.decay, ...(layer.tail ? { tail: { ...layer.tail, decay: layer.tail.decay * stray.decay } } : {}) }
            : layer;
        const strikes = strikesOf(layer, start, seed);
        if (wide > 0 || place.pan !== 0 || strikes.some((s) => s.pan !== 0)) stereo = true;
        let [peak, last, heard] = [0, start, 0];
        for (const s of strikes) {
            const from = Math.round(Math.max(0, s.at) * rate);
            if (from >= total) continue;
            heard++;
            const length = Math.min(seconds, (total - from) / rate);
            const pitch = s.pitch * place.pitch * stray.pitch;
            const loud = s.loud * place.loud * stray.loud;
            // Each striking has its own noise, as no two footsteps are the same grit.
            const hit = strike(made, length, rate, pitch, s.seed, recording);
            // The other ear's noise is another noise, by as much as the layer is wide.
            const other = wide > 0 ? strike(made, length, rate, pitch, s.seed + 50021) : null;
            // Equal power: a sound sent to one side is as loud as one in the middle.
            const pan = Math.max(-1, Math.min(1, s.pan + place.pan));
            const [gl, gr] = [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];
            for (let n = 0; n < hit.length && from + n < total; n++) {
                const v = hit[n]! * loud;
                left[from + n]! += v * gl;
                right[from + n]! += (other ? v * (1 - wide) + other[n]! * loud * wide : v) * gr;
                if (Math.abs(v) > peak) peak = Math.abs(v);
            }
            last = Math.max(last, Math.min(total / rate, s.at + hit.length / rate));
        }
        return { peak, last, heard, strikes: strikes.length };
    };

    source.layers.forEach((layer, index) => {
        if (layer.mute) return;
        const where = `layer ${index}${layer.id ? ` "${layer.id}"` : ''}`;
        const made = play(layer, index, where, { offset: 0, pitch: at.pitch ?? 1, loud: 1, pan: 0, seed: at.seed ?? 0 }, true);
        const start = layer.start ?? 0;
        reports.push({
            ...(layer.id ? { id: layer.id } : {}), source: layer.source, from: Math.round(start * 1000) / 1000, to: Math.round(made.last * 1000) / 1000,
            peak: Math.round(made.peak * 1000) / 1000, ...(made.strikes > 1 ? { strikes: made.heard } : {}),
        });
        if (made.heard < made.strikes) notes.push(`${where}: ${made.strikes - made.heard} of its ${made.strikes} strikes fall past the end of the sound and are not heard`);
        if (made.strikes > 0 && made.peak < 1e-4) notes.push(`${where} makes no sound: its level is nothing throughout`);
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
            // The two ears are answered a little differently, which is what makes a place wide.
            const wet = convolve(channel, placeResponse(rate, source.reverb.size ?? 0.5, source.reverb.kind ?? 'room', c), total);
            const mix = source.reverb.mix ?? 0.25;
            for (let n = 0; n < total; n++) channel[n] = channel[n]! + wet[n]! * mix * 3;
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
    if (at.raw) {
        // Left as it sums: whoever plays it as a note sets the level of the whole.
    } else if (source.normalize !== false) {
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
export function encodeWav(sound: { rate: number; channels: readonly Float32Array[] }): Uint8Array {
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

/** Every variant a source asks for, the first being the sound as written. */
export function renderSoundVariants(source: SoundSource, given: Readonly<Record<string, SoundRecording>> = {}): RenderedSound[] {
    return Array.from({ length: source.variants ?? 1 }, (_, k) => renderSound(source, k, { given }));
}

/** A recording as this file's sounds are held, so it can be drawn and measured as they are. */
export function soundFromSamples(rate: number, channels: readonly Float32Array[]): RenderedSound {
    const kept = channels.slice(0, 2).map((c) => Float32Array.from(c));
    let [peak, squares] = [0, 0];
    for (const channel of kept) for (const v of channel) { if (Math.abs(v) > peak) peak = Math.abs(v); squares += v * v; }
    const frames = kept[0]?.length ?? 0;
    return { rate, channels: kept, seconds: frames / rate, peak, rms: Math.sqrt(squares / Math.max(1, frames * kept.length)), layers: [], notes: [] };
}

/** A `.wav` read: PCM of 8, 16, 24 or 32 bits, or 32-bit floats. Throws on anything else, saying what it found. */
export function decodeWav(bytes: Uint8Array): RenderedSound {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (at: number): string => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a .wav: it does not begin RIFF....WAVE');
    let [format, channels, rate, bits] = [0, 0, 0, 0];
    let data: { at: number; size: number } | null = null;
    for (let at = 12; at + 8 <= bytes.length;) {
        const size = view.getUint32(at + 4, true);
        if (tag(at) === 'fmt ') {
            format = view.getUint16(at + 8, true);
            channels = view.getUint16(at + 10, true);
            rate = view.getUint32(at + 12, true);
            bits = view.getUint16(at + 22, true);
            // An extensible header says its real format further in.
            if (format === 0xfffe && size >= 26) format = view.getUint16(at + 32, true);
        } else if (tag(at) === 'data') data = { at: at + 8, size: Math.min(size, bytes.length - at - 8) };
        at += 8 + size + (size & 1);
    }
    if (!data || !channels || !rate) throw new Error('a .wav with no format or no samples in it');
    if (!((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && bits === 32))) throw new Error(`a .wav of a kind not read here (format ${format}, ${bits} bits); PCM of 8 to 32 bits and 32-bit floats are`);
    const step = bits / 8;
    const frames = Math.floor(data.size / (step * channels));
    const out = Array.from({ length: channels }, () => new Float32Array(frames));
    for (let n = 0; n < frames; n++) {
        for (let c = 0; c < channels; c++) {
            const at = data.at + (n * channels + c) * step;
            out[c]![n] = format === 3 ? view.getFloat32(at, true)
                : bits === 8 ? (bytes[at]! - 128) / 128
                : bits === 16 ? view.getInt16(at, true) / 32768
                : bits === 24 ? ((bytes[at]! | (bytes[at + 1]! << 8) | (view.getInt8(at + 2) << 16))) / 8388608
                : view.getInt32(at, true) / 2147483648;
        }
    }
    return soundFromSamples(rate, out);
}
