// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    soundConform.ts
 * @brief   A recording made ready for a game: cut to the part wanted, given fades, brought to one loudness, and made to
 *          loop without a seam.
 *
 * Music and ambience are matched by how loud they sound (integrated loudness, ITU-R BS.1770, in LUFS) so one track does
 * not jump out over the next; an effect is matched by its peak, since a short bang has no loudness worth integrating.
 * Raising a quiet recording to its loudness can push its peaks past full scale; a look-ahead limiter takes them back
 * under the ceiling, and the report says by how much it had to.
 *
 * Pure: samples in, samples and a list of what was done out. Every step it took is named, so a credits line can say what
 * was changed in someone else's work.
 */

/** What a recording is: samples per channel at a rate. */
export interface Recording {
    rate: number;
    channels: Float32Array[];
}

/** What kind of sound it is, which decides what it is brought to by default. */
export type ConformKind = 'music' | 'ambience' | 'effect';

export interface ConformOptions {
    kind: ConformKind;
    /** Seconds into the recording the kept part starts and ends. */
    start?: number;
    end?: number;
    /** Take the silence off its front and back (quieter than `silenceDb`). Default true. */
    trimSilence?: boolean;
    /** How quiet counts as silence, dB below full scale. Default -60. */
    silenceDb?: number;
    /** Seconds of fade at the front and the back. */
    fadeIn?: number;
    fadeOut?: number;
    /** Integrated loudness to bring it to, LUFS. Default -16 for music and ambience; an effect is matched by its peak. */
    loudness?: number;
    /** Highest peak allowed, dB below full scale. Default -1 for music and ambience, -3 for an effect (and its target). */
    peak?: number;
    /** Seconds of its end blended into its start, so it goes round without a seam. 0 = not a loop. */
    loopCrossfade?: number;
    /** Mixed down to one channel. */
    mono?: boolean;
}

/** One step taken, in words a credits line can carry. */
export interface ConformStep {
    step: string;
    detail: string;
}

export interface ConformResult extends Recording {
    steps: ConformStep[];
    /** Loudness and peak before and after. */
    before: SoundLevels;
    after: SoundLevels;
    /** The most the limiter turned a peak down, dB (0 when it did nothing). */
    limitedDb: number;
    /**
     * For a loop: the step where it goes round (last sample to first) over the mean step between neighbouring samples.
     * 1 is as smooth as anywhere else in it; a click is above about 4.
     */
    seamJump?: number;
}

export interface SoundLevels {
    seconds: number;
    /** Integrated loudness, LUFS; -Infinity for silence. */
    lufs: number;
    /** Peak, dB below full scale. */
    peakDb: number;
}

const DEFAULT_LOUDNESS = -16;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;

const db = (level: number): number => (level > 0 ? 20 * Math.log10(level) : -Infinity);
const fromDb = (decibels: number): number => Math.pow(10, decibels / 20);
const round = (v: number, places = 1): number => (Number.isFinite(v) ? Math.round(v * 10 ** places) / 10 ** places : v);

/** Coefficients of one biquad, normalised (a0 = 1). */
interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/**
 * The two stages of the K-weighting BS.1770 measures through, designed for @p rate: a high shelf of about +4 dB above
 * 1.5 kHz (the head) and a high-pass near 38 Hz. At 48 kHz these are the standard's own coefficients.
 */
function kWeighting(rate: number): [Biquad, Biquad] {
    const shelf = (() => {
        const f0 = 1681.974450955533, gain = 3.999843853973347, q = 0.7071752369554196;
        const k = Math.tan(Math.PI * f0 / rate), vh = Math.pow(10, gain / 20), vb = Math.pow(vh, 0.4996667741545416);
        const a0 = 1 + k / q + k * k;
        return { b0: (vh + vb * k / q + k * k) / a0, b1: 2 * (k * k - vh) / a0, b2: (vh - vb * k / q + k * k) / a0, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0 };
    })();
    const highpass = (() => {
        const f0 = 38.13547087602444, q = 0.5003270373238773;
        const k = Math.tan(Math.PI * f0 / rate);
        const a0 = 1 + k / q + k * k;
        return { b0: 1, b1: -2, b2: 1, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0 };
    })();
    return [shelf, highpass];
}

function filter(samples: Float32Array, c: Biquad): Float32Array {
    const out = new Float32Array(samples.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
        const x = samples[i]!;
        const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        out[i] = y;
    }
    return out;
}

/**
 * Integrated loudness, LUFS (ITU-R BS.1770-4): K-weighted, in 400 ms blocks overlapping by three quarters, gated at
 * -70 LUFS and then 10 LU under the mean of what passed. Left and right weigh alike. A recording shorter than one block
 * is measured as one block of what it has.
 */
export function integratedLoudness(sound: Recording): number {
    const [shelf, highpass] = kWeighting(sound.rate);
    const weighted = sound.channels.map((c) => filter(filter(c, shelf), highpass));
    const frames = weighted[0]?.length ?? 0;
    if (frames === 0) return -Infinity;
    const block = Math.max(1, Math.round(0.4 * sound.rate));
    const hop = Math.max(1, Math.round(block / 4));
    const powers: number[] = [];
    for (let start = 0; start + block <= frames || powers.length === 0; start += hop) {
        const end = Math.min(frames, start + block);
        let sum = 0;
        for (const channel of weighted) {
            let s = 0;
            for (let i = start; i < end; i++) s += channel[i]! * channel[i]!;
            sum += s / (end - start);
        }
        powers.push(sum);
        if (end >= frames) break;
    }
    const lufsOf = (power: number): number => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);
    const loud = powers.filter((p) => lufsOf(p) > ABSOLUTE_GATE);
    if (loud.length === 0) return -Infinity;
    const threshold = lufsOf(loud.reduce((a, b) => a + b, 0) / loud.length) + RELATIVE_GATE;
    const kept = loud.filter((p) => lufsOf(p) > threshold);
    return lufsOf(kept.reduce((a, b) => a + b, 0) / kept.length);
}

function peakOf(sound: Recording): number {
    let peak = 0;
    for (const channel of sound.channels) for (const v of channel) if (Math.abs(v) > peak) peak = Math.abs(v);
    return peak;
}

export function soundLevels(sound: Recording): SoundLevels {
    return {
        seconds: round((sound.channels[0]?.length ?? 0) / sound.rate, 3),
        lufs: round(integratedLoudness(sound)),
        peakDb: round(db(peakOf(sound))),
    };
}

/** Frames @p from to @p to of every channel. */
const cut = (sound: Recording, from: number, to: number): Recording => ({
    rate: sound.rate, channels: sound.channels.map((c) => c.slice(from, to)),
});

/**
 * Peaks over @p ceiling turned down, the gain falling ahead of each one (5 ms) and coming back over 60 ms, so no peak
 * passes and nothing clicks. Answers the most it turned down, as a gain 0..1.
 */
function limit(channels: Float32Array[], rate: number, ceiling: number): number {
    const frames = channels[0]?.length ?? 0;
    const need = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        let loudest = 0;
        for (const c of channels) loudest = Math.max(loudest, Math.abs(c[i]!));
        need[i] = loudest > ceiling ? ceiling / loudest : 1;
    }
    let deepest = 1;
    for (const g of need) deepest = Math.min(deepest, g);
    if (deepest >= 1) return 1;
    const ahead = Math.max(1, Math.round(0.005 * rate));
    const release = 1 - Math.exp(-1 / (0.06 * rate));
    // The least each frame must be turned to by anything within the look-ahead after it, falling linearly toward it.
    const gain = new Float32Array(frames).fill(1);
    for (let i = 0; i < frames; i++) {
        if (need[i]! >= 1) continue;
        for (let j = Math.max(0, i - ahead); j <= i; j++) {
            const ramp = need[i]! + (1 - need[i]!) * ((i - j) / ahead);
            if (ramp < gain[j]!) gain[j] = ramp;
        }
    }
    let held = 1;
    for (let i = 0; i < frames; i++) {
        held = gain[i]! < held ? gain[i]! : held + (1 - held) * release;
        held = Math.min(held, gain[i]! < 1 ? gain[i]! : held);
        for (const c of channels) c[i] = c[i]! * held;
    }
    return deepest;
}

/** Make @p input ready for a game by @p options. Throws when what is asked leaves nothing. */
export function conformSound(input: Recording, options: ConformOptions): ConformResult {
    const steps: ConformStep[] = [];
    const before = soundLevels(input);
    const rate = input.rate;
    const frames = input.channels[0]?.length ?? 0;
    let sound: Recording = { rate, channels: input.channels.map((c) => Float32Array.from(c)) };

    if (options.mono && sound.channels.length > 1) {
        const mixed = new Float32Array(frames);
        for (const c of sound.channels) for (let i = 0; i < frames; i++) mixed[i] = mixed[i]! + c[i]! / sound.channels.length;
        sound = { rate, channels: [mixed] };
        steps.push({ step: 'mono', detail: 'mixed down to one channel' });
    }

    if (options.start !== undefined || options.end !== undefined) {
        const from = Math.max(0, Math.round((options.start ?? 0) * rate));
        const to = Math.min(frames, Math.round((options.end ?? frames / rate) * rate));
        if (to <= from) throw new Error(`start ${options.start ?? 0} s and end ${options.end} s leave nothing of a ${round(frames / rate, 2)} s recording`);
        sound = cut(sound, from, to);
        steps.push({ step: 'excerpt', detail: `${round(from / rate, 2)} s to ${round(to / rate, 2)} s of the ${round(frames / rate, 2)} s original` });
    }

    if (options.trimSilence !== false) {
        const floor = fromDb(options.silenceDb ?? -60);
        const length = sound.channels[0]!.length;
        const loud = (i: number): boolean => sound.channels.some((c) => Math.abs(c[i]!) > floor);
        let first = 0;
        while (first < length && !loud(first)) first++;
        let last = length - 1;
        while (last > first && !loud(last)) last--;
        if (first >= length) throw new Error(`the recording is silent (nothing louder than ${options.silenceDb ?? -60} dB)`);
        // A few milliseconds kept either side, so a soft attack is not cut into.
        const margin = Math.round(0.005 * rate);
        const from = Math.max(0, first - margin), to = Math.min(length, last + 1 + margin);
        if (from > 0 || to < length) {
            sound = cut(sound, from, to);
            const parts = [from > 0 ? `${round(from / rate, 2)} s of leading silence` : '', to < length ? `${round((length - to) / rate, 2)} s of trailing silence` : ''].filter(Boolean);
            steps.push({ step: 'silence', detail: `${parts.join(' and ')} removed` });
        }
    }

    // Level: music and ambience by how loud they sound, an effect by its peak.
    const isEffect = options.kind === 'effect' && options.loudness === undefined;
    const ceilingDb = options.peak ?? (isEffect ? -3 : -1);
    const ceiling = fromDb(ceilingDb);
    let limitedDb = 0;
    if (isEffect) {
        const peak = peakOf(sound);
        if (peak <= 0) throw new Error('the recording is silent');
        const gain = ceiling / peak;
        for (const c of sound.channels) for (let i = 0; i < c.length; i++) c[i] = c[i]! * gain;
        steps.push({ step: 'level', detail: `gain ${round(db(gain))} dB to a ${round(ceilingDb)} dBFS peak` });
    } else {
        const target = options.loudness ?? DEFAULT_LOUDNESS;
        const measured = integratedLoudness(sound);
        if (!Number.isFinite(measured)) throw new Error('the recording is too quiet to measure its loudness');
        const gain = fromDb(target - measured);
        for (const c of sound.channels) for (let i = 0; i < c.length; i++) c[i] = c[i]! * gain;
        const deepest = limit(sound.channels, rate, ceiling);
        limitedDb = round(-db(deepest));
        steps.push({
            step: 'level',
            detail: `gain ${round(db(gain))} dB to ${round(target)} LUFS${limitedDb > 0 ? `, with peak limiting of at most ${limitedDb} dB under ${round(ceilingDb)} dBFS` : ''}`,
        });
    }

    const length = (): number => sound.channels[0]!.length;
    const loop = options.loopCrossfade ?? 0;
    let seamJump: number | undefined;
    if (loop > 0) {
        const n = Math.round(loop * rate);
        if (n * 2 > length()) throw new Error(`a ${loop} s crossfade needs a recording at least twice as long; this one is ${round(length() / rate, 2)} s`);
        // The end laid over the start: what leads into the first frame on the way round is the frame just before the
        // tail, so the join is the recording's own continuation. Equal power, so the blend does not dip.
        const kept = length() - n;
        sound = {
            rate,
            channels: sound.channels.map((c) => {
                const out = c.slice(0, kept);
                for (let i = 0; i < n; i++) {
                    const t = (i + 0.5) / n;
                    out[i] = c[i]! * Math.sin(t * Math.PI / 2) + c[kept + i]! * Math.cos(t * Math.PI / 2);
                }
                return out;
            }),
        };
        seamJump = round(Math.max(...sound.channels.map((c) => {
            let steps = 0;
            for (let i = 1; i < c.length; i++) steps += Math.abs(c[i]! - c[i - 1]!);
            const typical = steps / Math.max(1, c.length - 1);
            return typical > 0 ? Math.abs(c[0]! - c[c.length - 1]!) / typical : 0;
        })), 2);
        steps.push({ step: 'loop', detail: `the last ${round(loop, 2)} s cross-faded into the start for a seamless ${round(length() / rate, 2)} s loop` });
    }

    const fade = (seconds: number | undefined, atEnd: boolean): void => {
        if (!(seconds && seconds > 0)) return;
        const n = Math.min(length(), Math.round(seconds * rate));
        for (const c of sound.channels) {
            for (let i = 0; i < n; i++) {
                const k = i / n;
                const at = atEnd ? c.length - 1 - i : i;
                c[at] = c[at]! * k * k;
            }
        }
        steps.push({ step: atEnd ? 'fade-out' : 'fade-in', detail: `${round(n / rate, 2)} s fade-${atEnd ? 'out' : 'in'}` });
    };
    // A loop has no ends to fade: it goes round.
    if (!(loop > 0)) {
        fade(options.fadeIn, false);
        fade(options.fadeOut, true);
    }

    return { ...sound, steps, before, after: soundLevels(sound), limitedDb, ...(seamJump !== undefined ? { seamJump } : {}) };
}

/** What a credits line says was changed: the steps, in the order taken. */
export function describeChanges(steps: readonly ConformStep[]): string {
    if (steps.length === 0) return 'used as it is';
    const text = steps.map((s) => s.detail).join('; ');
    return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
