// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  soundPicture.ts — a sound as something to look at.
 *
 *        Whoever writes a sound source here cannot hear it, and a list of numbers does not say whether a gunshot has a
 *        crack on the front of it. A picture does. The top band is the wave: how loud, when. Under it is the sound laid
 *        out by pitch against time, low at the bottom and high at the top, brighter where there is more: a thump is a
 *        blot low on the left, a hiss is a haze across the top, a tone is a line, a tone that falls is a line that falls.
 *        Faint lines mark 100 Hz, 1 kHz and 10 kHz, and tenths of a second, or whole seconds on a long sound.
 */
import type { RenderedSound } from './soundRender';

export interface SoundPicture { width: number; height: number; rgba: Uint8Array }

/** In place: the transform of @p re + i @p im, their length a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
    }
    for (let size = 2; size <= n; size <<= 1) {
        const angle = (-2 * Math.PI) / size;
        const [wr, wi] = [Math.cos(angle), Math.sin(angle)];
        for (let start = 0; start < n; start += size) {
            let [cr, ci] = [1, 0];
            for (let k = 0; k < size / 2; k++) {
                const [a, b] = [start + k, start + k + size / 2];
                const [tr, ti] = [re[b]! * cr - im[b]! * ci, re[b]! * ci + im[b]! * cr];
                re[b] = re[a]! - tr; im[b] = im[a]! - ti;
                re[a] = re[a]! + tr; im[a] = im[a]! + ti;
                [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
            }
        }
    }
}

const LOW = 40;
const HIGH = 20000;
/** From nothing through violet and orange to white, so that a little shows and a lot is not all one colour. */
const HEAT: readonly (readonly [number, number, number])[] = [[8, 8, 14], [48, 18, 92], [140, 32, 110], [226, 84, 58], [250, 182, 60], [255, 250, 228]];

function heat(t: number): [number, number, number] {
    const f = Math.max(0, Math.min(1, t)) * (HEAT.length - 1);
    const i = Math.min(HEAT.length - 2, Math.floor(f));
    return [0, 1, 2].map((k) => Math.round(HEAT[i]![k]! + (HEAT[i + 1]![k]! - HEAT[i]![k]!) * (f - i))) as [number, number, number];
}

/** How much of the sound's energy lies under 200 Hz, from there to 2 kHz, and above, each 0..1. */
export function soundBands(sound: RenderedSound): { low: number; mid: number; high: number } {
    const size = 2048;
    const mono = sound.channels[0]!.map((v, i) => (sound.channels.length === 2 ? (v + sound.channels[1]![i]!) / 2 : v));
    const sums = [0, 0, 0];
    for (let start = 0; start < mono.length; start += size) {
        const [re, im] = [new Float64Array(size), new Float64Array(size)];
        for (let i = 0; i < size && start + i < mono.length; i++) re[i] = mono[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
        fft(re, im);
        for (let k = 1; k < size / 2; k++) {
            const hz = (k * sound.rate) / size;
            sums[hz < 200 ? 0 : hz < 2000 ? 1 : 2]! += re[k]! * re[k]! + im[k]! * im[k]!;
        }
    }
    const all = sums[0]! + sums[1]! + sums[2]! || 1;
    const share = (v: number): number => Math.round((v / all) * 100) / 100;
    return { low: share(sums[0]!), mid: share(sums[1]!), high: share(sums[2]!) };
}

/** The wave over the pitches, @p width pixels across. */
export function soundPicture(sound: RenderedSound, width = 768): SoundPicture {
    const [waveH, specH] = [120, 264];
    const height = waveH + specH;
    const rgba = new Uint8Array(width * height * 4);
    const put = (x: number, y: number, r: number, g: number, b: number, a = 1): void => {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const o = (y * width + x) * 4;
        rgba[o] = Math.round(rgba[o]! * (1 - a) + r * a);
        rgba[o + 1] = Math.round(rgba[o + 1]! * (1 - a) + g * a);
        rgba[o + 2] = Math.round(rgba[o + 2]! * (1 - a) + b * a);
        rgba[o + 3] = 255;
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, y < waveH ? 22 : 8, y < waveH ? 24 : 8, y < waveH ? 30 : 14);

    const frames = sound.channels[0]!.length;
    const mono = sound.channels[0]!.map((v, i) => (sound.channels.length === 2 ? (v + sound.channels[1]![i]!) / 2 : v));

    // The wave: for each column, from its lowest sample to its highest.
    const mid = waveH / 2;
    for (let x = 0; x < width; x++) put(x, mid, 60, 66, 80);
    for (let x = 0; x < width; x++) {
        const [from, to] = [Math.floor((x / width) * frames), Math.max(Math.floor((x / width) * frames) + 1, Math.floor(((x + 1) / width) * frames))];
        let [lo, hi] = [0, 0];
        for (let n = from; n < to && n < frames; n++) { if (mono[n]! < lo) lo = mono[n]!; if (mono[n]! > hi) hi = mono[n]!; }
        for (let y = Math.round(mid - hi * (mid - 4)); y <= Math.round(mid - lo * (mid - 4)); y++) put(x, y, 120, 214, 255);
    }

    // The pitches: a window of the sound at each column, its strength at each height's frequency.
    const size = 2048;
    const [re, im] = [new Float64Array(size), new Float64Array(size)];
    const column = new Float32Array(size / 2);
    for (let x = 0; x < width; x++) {
        const centre = Math.floor(((x + 0.5) / width) * frames);
        re.fill(0); im.fill(0);
        for (let i = 0; i < size; i++) {
            const n = centre - size / 2 + i;
            if (n >= 0 && n < frames) re[i] = mono[n]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
        }
        fft(re, im);
        for (let k = 0; k < size / 2; k++) column[k] = Math.hypot(re[k]!, im[k]!) / (size / 4);
        for (let y = 0; y < specH; y++) {
            const hz = LOW * Math.pow(HIGH / LOW, 1 - y / (specH - 1));
            const bin = (hz * size) / sound.rate;
            // Between two bins, and across all the bins one row covers where they are packed close.
            const next = (LOW * Math.pow(HIGH / LOW, 1 - (y - 1) / (specH - 1)) * size) / sound.rate;
            let v = 0;
            for (let k = Math.max(1, Math.floor(bin)); k <= Math.min(size / 2 - 1, Math.max(Math.ceil(bin), Math.floor(next))); k++) v = Math.max(v, column[k]!);
            const db = 20 * Math.log10(v + 1e-9);
            const [r, g, b] = heat((db + 78) / 72);
            put(x, waveH + y, r, g, b);
        }
    }

    // What to read it against: 100 Hz, 1 kHz and 10 kHz across, and time down.
    for (const hz of [100, 1000, 10000]) {
        const y = waveH + Math.round((1 - Math.log(hz / LOW) / Math.log(HIGH / LOW)) * (specH - 1));
        for (let x = 0; x < width; x += 2) put(x, y, 255, 255, 255, 0.28);
    }
    const tick = sound.seconds > 3 ? 1 : 0.1;
    for (let t = tick; t < sound.seconds - 1e-6; t += tick) {
        const x = Math.round((t / sound.seconds) * width);
        for (let y = 0; y < height; y += y < waveH ? 1 : 3) put(x, y, 255, 255, 255, y < waveH ? 0.1 : 0.22);
    }
    for (let x = 0; x < width; x++) put(x, waveH, 90, 96, 110);
    return { width, height, rgba };
}
