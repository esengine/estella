// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    imageAdjust.ts
 * @brief   What a photo editor offers over a picture so far: adjustments of its colour, and filters over its pixels.
 *
 * Each is one operation with numbers to turn, and the layer it sits on says where it applies and how much. Which to use, and how far, is the model's.
 * Pixels here are stored as the canvas stores them, colour already times alpha.
 */
import { blurMask, fractalNoise, parseColor } from './imageRaster';
import type { ImageAdjust, ImageFilterName } from './imageSource';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (t: number): number => t * t * (3 - 2 * t);
export const lightnessOf = (r: number, g: number, b: number): number => r * 0.2126 + g * 0.7152 + b * 0.0722;

// ---- Colour ----------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
    const l = (hi + lo) / 2;
    if (hi === lo) return [0, 0, l];
    const d = hi - lo;
    const s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
    const h = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t0: number): number => {
        const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/** Through its points without overshooting them, as a curves dialog draws it: a table for 0..1. */
function curveTable(points: readonly (readonly number[])[]): Float32Array {
    const sorted = [...points].sort((a, b) => a[0]! - b[0]!);
    const xs = sorted.map((p) => p[0]!), ys = sorted.map((p) => p[1]!);
    const n = xs.length;
    const slopes = xs.slice(0, -1).map((x, i) => (ys[i + 1]! - ys[i]!) / Math.max(1e-6, xs[i + 1]! - x));
    const tangents = xs.map((_, i) => {
        if (i === 0) return slopes[0] ?? 0;
        if (i === n - 1) return slopes[n - 2] ?? 0;
        return slopes[i - 1]! * slopes[i]! <= 0 ? 0 : (slopes[i - 1]! + slopes[i]!) / 2;
    });
    const table = new Float32Array(1024);
    for (let k = 0; k < table.length; k++) {
        const x = k / (table.length - 1);
        if (x <= xs[0]!) { table[k] = ys[0]!; continue; }
        if (x >= xs[n - 1]!) { table[k] = ys[n - 1]!; continue; }
        let i = 0;
        while (x > xs[i + 1]!) i++;
        const h = xs[i + 1]! - xs[i]!;
        const t = (x - xs[i]!) / h;
        const [t2, t3] = [t * t, t * t * t];
        table[k] = clamp01((2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * tangents[i]! + (3 * t2 - 2 * t3) * ys[i + 1]! + (t3 - t2) * h * tangents[i + 1]!);
    }
    return table;
}
const look = (table: Float32Array, v: number): number => table[Math.round(clamp01(v) * (table.length - 1))]!;

/** Colour along stops, for a gradient map. */
function stopsTable(stops: readonly (readonly [number, string])[]): Float32Array {
    const sorted = [...stops].sort((a, b) => a[0] - b[0]).map(([t, c]) => [t, parseColor(c)] as const);
    const out = new Float32Array(256 * 3);
    for (let k = 0; k < 256; k++) {
        const v = k / 255;
        let i = 0;
        while (i + 2 < sorted.length && v > sorted[i + 1]![0]) i++;
        const [a, b] = [sorted[i]!, sorted[Math.min(sorted.length - 1, i + 1)]!];
        const t = clamp01((v - a[0]) / Math.max(1e-6, b[0] - a[0]));
        for (let n = 0; n < 3; n++) out[k * 3 + n] = a[1][n]! + (b[1][n]! - a[1][n]!) * t;
    }
    return out;
}

/** The picture with its colour changed, in the order a stack of adjustment layers would most often take. */
export function applyAdjust(px: Float32Array, w: number, h: number, a: ImageAdjust): Float32Array {
    const out = new Float32Array(px.length);
    const levels = a.levels;
    const [inLow, inHigh] = levels?.input ?? [0, 1];
    const [outLow, outHigh] = levels?.output ?? [0, 1];
    const gamma = levels?.gamma ?? 1;
    const curves = a.curves ? (Array.isArray(a.curves) ? { all: curveTable(a.curves as readonly (readonly number[])[]) } : Object.fromEntries(Object.entries(a.curves).map(([k, v]) => [k, curveTable(v as readonly (readonly number[])[])]))) as Record<string, Float32Array> : null;
    const exposure = a.exposure !== undefined ? 2 ** a.exposure : 1;
    const [brightness, contrast] = [a.brightness ?? 0, a.contrast ?? 0];
    const contrastGain = contrast >= 0 ? 1 / Math.max(0.01, 1 - contrast * 0.98) : 1 + contrast;
    const [warm, tint] = [a.temperature ?? 0, a.tint ?? 0];
    const [hue, saturation, lightness] = [(a.hue ?? 0) / 360, a.saturation ?? 0, a.lightness ?? 0];
    const vibrance = a.vibrance ?? 0;
    const map = a.gradientMap ? stopsTable(a.gradientMap) : null;
    const levelsStep = a.posterize !== undefined ? Math.max(2, Math.round(a.posterize)) : 0;
    const balance = a.balance;
    for (let i = 0; i < w * h; i++) {
        const at = i * 4, alpha = px[at + 3]!;
        if (alpha <= 0) continue;
        let [r, g, b] = [px[at]! / alpha, px[at + 1]! / alpha, px[at + 2]! / alpha];
        if (exposure !== 1) { r *= exposure; g *= exposure; b *= exposure; }
        if (levels) {
            const f = (v: number): number => outLow + (outHigh - outLow) * clamp01((v - inLow) / Math.max(1e-6, inHigh - inLow)) ** (1 / gamma);
            r = f(r); g = f(g); b = f(b);
        }
        if (curves) {
            if (curves.all) { r = look(curves.all, r); g = look(curves.all, g); b = look(curves.all, b); }
            if (curves.r) r = look(curves.r, r);
            if (curves.g) g = look(curves.g, g);
            if (curves.b) b = look(curves.b, b);
        }
        if (brightness || contrast) {
            const f = (v: number): number => (v + brightness - 0.5) * contrastGain + 0.5;
            r = f(r); g = f(g); b = f(b);
        }
        if (warm || tint) { r += warm * 0.2 + tint * 0.1; g -= tint * 0.2; b += -warm * 0.2 + tint * 0.1; }
        if (balance) {
            const l = clamp01(lightnessOf(r, g, b));
            const [dark, mid, bright] = [smooth(clamp01(1 - l * 2.5)), 1 - Math.abs(l - 0.5) * 2, smooth(clamp01((l - 0.6) * 2.5))];
            for (const [weight, shift] of [[dark, balance.shadows], [mid, balance.midtones], [bright, balance.highlights]] as const) {
                if (!shift) continue;
                r += shift[0]! * weight * 0.5; g += shift[1]! * weight * 0.5; b += shift[2]! * weight * 0.5;
            }
        }
        if (hue || saturation || lightness) {
            const [hh, ss, ll] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
            const s2 = saturation >= 0 ? ss + (1 - ss) * saturation * (ss > 0 ? 1 : 0) : ss * (1 + saturation);
            const l2 = lightness >= 0 ? ll + (1 - ll) * lightness : ll * (1 + lightness);
            [r, g, b] = hslToRgb((hh + hue + 1) % 1, clamp01(s2), clamp01(l2));
        }
        if (vibrance) {
            // More for what is dull than for what is already vivid, so skin and neon are not pushed over.
            const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
            const amount = vibrance * (1 - clamp01(hi - lo));
            const l = lightnessOf(r, g, b);
            r = l + (r - l) * (1 + amount); g = l + (g - l) * (1 + amount); b = l + (b - l) * (1 + amount);
        }
        if (a.blackWhite) {
            const [cr, cg, cb] = Array.isArray(a.blackWhite) ? a.blackWhite as readonly number[] : [0.2126, 0.7152, 0.0722];
            r = g = b = r * cr! + g * cg! + b * cb!;
        }
        if (map) {
            const k = Math.round(clamp01(lightnessOf(r, g, b)) * 255) * 3;
            [r, g, b] = [map[k]!, map[k + 1]!, map[k + 2]!];
        }
        if (a.invert) { r = 1 - r; g = 1 - g; b = 1 - b; }
        if (levelsStep) {
            const f = (v: number): number => Math.round(clamp01(v) * (levelsStep - 1)) / (levelsStep - 1);
            r = f(r); g = f(g); b = f(b);
        }
        if (a.threshold !== undefined) r = g = b = lightnessOf(r, g, b) >= a.threshold ? 1 : 0;
        out[at] = clamp01(r) * alpha; out[at + 1] = clamp01(g) * alpha; out[at + 2] = clamp01(b) * alpha; out[at + 3] = alpha;
    }
    return out;
}

// ---- Filters ---------------------------------------------------------------------

const bilinear = (px: Float32Array, w: number, h: number, x: number, y: number, out: Float32Array, to: number): void => {
    const [fx, fy] = [Math.max(0, Math.min(w - 1.001, x - 0.5)), Math.max(0, Math.min(h - 1.001, y - 0.5))];
    const [ix, iy] = [Math.floor(fx), Math.floor(fy)];
    const [tx, ty] = [fx - ix, fy - iy];
    const [a, b, c, d] = [(iy * w + ix) * 4, (iy * w + ix + 1) * 4, ((iy + 1) * w + ix) * 4, ((iy + 1) * w + ix + 1) * 4];
    for (let n = 0; n < 4; n++) {
        out[to + n] = (px[a + n]! * (1 - tx) + px[b + n]! * tx) * (1 - ty) + (px[c + n]! * (1 - tx) + px[d + n]! * tx) * ty;
    }
};

const blurAll = (px: Float32Array, w: number, h: number, sigma: number): Float32Array => {
    const out = new Float32Array(px.length);
    for (let n = 0; n < 4; n++) {
        const channel = new Float32Array(w * h);
        for (let i = 0; i < channel.length; i++) channel[i] = px[i * 4 + n]!;
        const soft = blurMask(channel, w, h, sigma);
        for (let i = 0; i < channel.length; i++) out[i * 4 + n] = soft[i]!;
    }
    return out;
};

/** Every pixel from somewhere else in the picture. */
function warped(px: Float32Array, w: number, h: number, from: (x: number, y: number) => readonly [number, number]): Float32Array {
    const out = new Float32Array(px.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [sx, sy] = from(x + 0.5, y + 0.5);
            bilinear(px, w, h, sx, sy, out, (y * w + x) * 4);
        }
    }
    return out;
}

/** Every pixel the mean of several places, each given by how far along 0..1 it is. */
function averaged(px: Float32Array, w: number, h: number, samples: number, from: (x: number, y: number, t: number) => readonly [number, number]): Float32Array {
    const out = new Float32Array(px.length);
    const one = new Float32Array(4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const to = (y * w + x) * 4;
            for (let s = 0; s < samples; s++) {
                const [sx, sy] = from(x + 0.5, y + 0.5, samples === 1 ? 0 : s / (samples - 1));
                bilinear(px, w, h, sx, sy, one, 0);
                for (let n = 0; n < 4; n++) out[to + n]! += one[n]!;
            }
            for (let n = 0; n < 4; n++) out[to + n]! /= samples;
        }
    }
    return out;
}

/** Light over a pixel without covering it: `add` 0..1 in each colour on top of what is there. */
function screened(px: Float32Array, w: number, h: number, light: (x: number, y: number, into: Float32Array) => void): Float32Array {
    const out = new Float32Array(px);
    const add = new Float32Array(3);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            add.fill(0);
            light(x + 0.5, y + 0.5, add);
            const at = (y * w + x) * 4;
            let most = out[at + 3]!;
            for (let n = 0; n < 3; n++) {
                out[at + n] = out[at + n]! + (1 - out[at + n]!) * clamp01(add[n]!);
                most = Math.max(most, out[at + n]!);
            }
            out[at + 3] = most;
        }
    }
    return out;
}

type P = Readonly<Record<string, unknown>>;
const num = (p: P, key: string, fallback: number): number => (p[key] as number | undefined) ?? fallback;
const pointOf = (p: P, key: string, fallback: readonly [number, number]): readonly [number, number] => (p[key] as readonly [number, number] | undefined) ?? fallback;

/** The picture with a filter over it: what it would be everywhere, which the layer then lays down where and as much as it says. @p k is the size of a pixel in the source's terms. */
export function applyFilter(name: ImageFilterName, p: P, px: Float32Array, w: number, h: number, k: number): Float32Array {
    const middle = [w / (2 * k), h / (2 * k)] as const;
    const centre = (key = 'at'): readonly [number, number] => { const c = pointOf(p, key, middle); return [c[0] * k, c[1] * k]; };
    switch (name) {
        case 'gaussian':
            return blurAll(px, w, h, num(p, 'radius', 4) * k);
        case 'motion': {
            const a = (num(p, 'angle', 0) * Math.PI) / 180, d = num(p, 'distance', 16) * k;
            const [dx, dy] = [Math.cos(a) * d, Math.sin(a) * d];
            return averaged(px, w, h, Math.max(2, Math.min(64, Math.ceil(d))), (x, y, t) => [x + dx * (t - 0.5), y + dy * (t - 0.5)]);
        }
        case 'spin': {
            const [cx, cy] = centre();
            const amount = (num(p, 'angle', 10) * Math.PI) / 180;
            return averaged(px, w, h, 24, (x, y, t) => {
                const r = amount * (t - 0.5);
                const [dx, dy] = [x - cx, y - cy];
                return [cx + dx * Math.cos(r) - dy * Math.sin(r), cy + dx * Math.sin(r) + dy * Math.cos(r)];
            });
        }
        case 'zoom': {
            const [cx, cy] = centre();
            const amount = num(p, 'amount', 0.1);
            return averaged(px, w, h, 24, (x, y, t) => { const s = 1 + amount * (t - 0.5); return [cx + (x - cx) * s, cy + (y - cy) * s]; });
        }
        case 'lens': {
            // A disc and not a bell, so highlights open into the round lights of a real lens.
            const radius = num(p, 'radius', 6) * k;
            const bright = num(p, 'highlights', 1);
            const rings = Math.max(2, Math.min(6, Math.ceil(radius / 2)));
            const offsets: [number, number][] = [[0, 0]];
            for (let ring = 1; ring <= rings; ring++) {
                const count = ring * 7;
                for (let s = 0; s < count; s++) {
                    const a = (s / count) * Math.PI * 2 + ring;
                    offsets.push([Math.cos(a) * (radius * ring) / rings, Math.sin(a) * (radius * ring) / rings]);
                }
            }
            const out = new Float32Array(px.length);
            const one = new Float32Array(4);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const to = (y * w + x) * 4;
                    let weight = 0;
                    for (const [ox, oy] of offsets) {
                        bilinear(px, w, h, x + 0.5 + ox, y + 0.5 + oy, one, 0);
                        const l = lightnessOf(one[0]!, one[1]!, one[2]!);
                        const q = 1 + bright * 2 * l * l * l * l;
                        for (let n = 0; n < 4; n++) out[to + n]! += one[n]! * q;
                        weight += q;
                    }
                    for (let n = 0; n < 4; n++) out[to + n]! /= weight;
                }
            }
            return out;
        }
        case 'sharpen': {
            const soft = blurAll(px, w, h, num(p, 'radius', 1.5) * k);
            const [amount, threshold] = [num(p, 'amount', 0.8), num(p, 'threshold', 0)];
            const out = new Float32Array(px);
            for (let i = 0; i < w * h; i++) {
                const at = i * 4, a = px[at + 3]!;
                for (let n = 0; n < 3; n++) {
                    const diff = px[at + n]! - soft[at + n]!;
                    if (Math.abs(diff) >= threshold) out[at + n] = Math.max(0, Math.min(a, px[at + n]! + diff * amount));
                }
            }
            return out;
        }
        case 'highPass': {
            const soft = blurAll(px, w, h, num(p, 'radius', 6) * k);
            const out = new Float32Array(px.length);
            for (let i = 0; i < w * h; i++) {
                const at = i * 4, a = px[at + 3]!;
                out[at + 3] = a;
                for (let n = 0; n < 3; n++) out[at + n] = clamp01(0.5 + px[at + n]! - soft[at + n]!) * a;
            }
            return out;
        }
        case 'noise': {
            const [amount, scale, seed, mono] = [num(p, 'amount', 0.08), num(p, 'scale', 1) * k, num(p, 'seed', 1), p.mono !== false];
            const out = new Float32Array(px);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const at = (y * w + x) * 4, a = px[at + 3]!;
                    for (let n = 0; n < 3; n++) {
                        const v = fractalNoise(x / scale, y / scale, 1, mono ? seed : seed + n * 13) - 0.5;
                        out[at + n] = Math.max(0, Math.min(a, px[at + n]! + v * amount * 2 * a));
                    }
                }
            }
            return out;
        }
        case 'median': {
            const r = Math.max(1, Math.min(6, Math.round(num(p, 'radius', 1) * k)));
            const out = new Float32Array(px.length);
            const lights: [number, number][] = [];
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    lights.length = 0;
                    for (let dy = -r; dy <= r; dy++) {
                        for (let dx = -r; dx <= r; dx++) {
                            const at = (Math.max(0, Math.min(h - 1, y + dy)) * w + Math.max(0, Math.min(w - 1, x + dx))) * 4;
                            lights.push([lightnessOf(px[at]!, px[at + 1]!, px[at + 2]!), at]);
                        }
                    }
                    lights.sort((a, b) => a[0] - b[0]);
                    const from = lights[lights.length >> 1]![1], to = (y * w + x) * 4;
                    for (let n = 0; n < 4; n++) out[to + n] = px[from + n]!;
                }
            }
            return out;
        }
        case 'emboss': {
            const a = (num(p, 'angle', 135) * Math.PI) / 180, d = num(p, 'height', 2) * k, amount = num(p, 'amount', 2);
            const [dx, dy] = [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)];
            const out = new Float32Array(px.length);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const at = (y * w + x) * 4;
                    const there = (Math.max(0, Math.min(h - 1, y + dy)) * w + Math.max(0, Math.min(w - 1, x + dx))) * 4;
                    const diff = lightnessOf(px[at]!, px[at + 1]!, px[at + 2]!) - lightnessOf(px[there]!, px[there + 1]!, px[there + 2]!);
                    const v = clamp01(0.5 + diff * amount);
                    const alpha = px[at + 3]!;
                    out[at] = out[at + 1] = out[at + 2] = v * alpha;
                    out[at + 3] = alpha;
                }
            }
            return out;
        }
        case 'ripple': {
            const [amount, size, seed] = [num(p, 'amount', 4) * k, num(p, 'size', 24) * k, num(p, 'seed', 1)];
            return warped(px, w, h, (x, y) => [x + Math.sin((y / size) * Math.PI * 2 + seed) * amount, y + Math.sin((x / size) * Math.PI * 2 + seed * 1.7) * amount]);
        }
        case 'displace': {
            const [amount, size, seed] = [num(p, 'amount', 8) * k, num(p, 'size', 40) * k, num(p, 'seed', 1)];
            return warped(px, w, h, (x, y) => [x + (fractalNoise(x / size, y / size, 3, seed) - 0.5) * amount * 2, y + (fractalNoise(x / size, y / size, 3, seed + 7) - 0.5) * amount * 2]);
        }
        case 'twirl': {
            const [cx, cy] = centre();
            const [radius, angle] = [num(p, 'radius', Math.min(w, h) / (2 * k)) * k, (num(p, 'angle', 45) * Math.PI) / 180];
            return warped(px, w, h, (x, y) => {
                const [dx, dy] = [x - cx, y - cy];
                const d = Math.hypot(dx, dy);
                if (d >= radius) return [x, y];
                const a = angle * (1 - d / radius) ** 2;
                return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
            });
        }
        case 'pixelate': {
            const cell = Math.max(2, Math.round(num(p, 'cell', 8) * k));
            const out = new Float32Array(px.length);
            for (let gy = 0; gy < h; gy += cell) {
                for (let gx = 0; gx < w; gx += cell) {
                    const sum = [0, 0, 0, 0];
                    let n = 0;
                    for (let y = gy; y < Math.min(h, gy + cell); y++) for (let x = gx; x < Math.min(w, gx + cell); x++) { const at = (y * w + x) * 4; for (let c = 0; c < 4; c++) sum[c]! += px[at + c]!; n++; }
                    for (let y = gy; y < Math.min(h, gy + cell); y++) for (let x = gx; x < Math.min(w, gx + cell); x++) { const at = (y * w + x) * 4; for (let c = 0; c < 4; c++) out[at + c] = sum[c]! / n; }
                }
            }
            return out;
        }
        case 'chromatic': {
            const [cx, cy] = centre();
            const amount = num(p, 'amount', 2) * k / Math.max(w, h);
            const out = new Float32Array(px);
            const one = new Float32Array(4);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const at = (y * w + x) * 4;
                    const [dx, dy] = [x + 0.5 - cx, y + 0.5 - cy];
                    bilinear(px, w, h, cx + dx * (1 + amount), cy + dy * (1 + amount), one, 0);
                    out[at] = one[0]!;
                    bilinear(px, w, h, cx + dx * (1 - amount), cy + dy * (1 - amount), one, 0);
                    out[at + 2] = one[2]!;
                }
            }
            return out;
        }
        case 'vignette': {
            const [cx, cy] = centre();
            const [amount, inner, outer] = [num(p, 'amount', 0.6), num(p, 'radius', 0.55), num(p, 'outer', 1.05)];
            const col = parseColor((p.color as string | undefined) ?? '#000000');
            const reach = Math.hypot(w, h) / 2;
            const out = new Float32Array(px);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const at = (y * w + x) * 4;
                    const t = amount * smooth(clamp01((Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / reach - inner) / Math.max(0.01, outer - inner)));
                    for (let n = 0; n < 3; n++) out[at + n] = px[at + n]! + (col[n]! * px[at + 3]! - px[at + n]!) * t;
                }
            }
            return out;
        }
        case 'fog': {
            // Thick at `to`, clear at `from`, in drifting patches: air between things, over and not behind them.
            const col = parseColor((p.color as string | undefined) ?? '#c8d0e0');
            const [fx, fy] = [pointOf(p, 'from', [0, 0])[0] * k, pointOf(p, 'from', [0, 0])[1] * k];
            const [tx, ty] = [pointOf(p, 'to', [0, h / k])[0] * k, pointOf(p, 'to', [0, h / k])[1] * k];
            const [dx, dy] = [tx - fx, ty - fy];
            const len = dx * dx + dy * dy || 1;
            const [density, patch, size, seed] = [num(p, 'density', 0.6), num(p, 'patchiness', 0.5), num(p, 'size', 120) * k, num(p, 'seed', 1)];
            const out = new Float32Array(px);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const at = (y * w + x) * 4;
                    const along = clamp01(((x + 0.5 - fx) * dx + (y + 0.5 - fy) * dy) / len);
                    const cloud = patch > 0 ? 1 - patch + patch * 2 * fractalNoise(x / (size * 2), y / size, 4, seed) : 1;
                    const t = clamp01(smooth(along) * density * cloud) * col[3];
                    for (let n = 0; n < 3; n++) out[at + n] = px[at + n]! * (1 - t) + col[n]! * t;
                    out[at + 3] = px[at + 3]! * (1 - t) + t;
                }
            }
            return out;
        }
        case 'rays': {
            // What is bright, drawn out from a point: light through air, in the colour of what shines.
            const [cx, cy] = centre();
            const [threshold, length, strength, decay] = [num(p, 'threshold', 0.6), num(p, 'length', 0.6), num(p, 'strength', 0.8), num(p, 'decay', 0.96)];
            const bright = new Float32Array(px.length);
            for (let i = 0; i < w * h; i++) {
                const at = i * 4;
                const over = clamp01((Math.max(px[at]!, px[at + 1]!, px[at + 2]!) - threshold) / Math.max(0.01, 1 - threshold));
                for (let n = 0; n < 3; n++) bright[at + n] = px[at + n]! * over;
                bright[at + 3] = 1;
            }
            const STEPS = 48;
            const one = new Float32Array(4);
            return screened(px, w, h, (x, y, into) => {
                let weight = 1;
                for (let s = 0; s < STEPS; s++) {
                    const t = 1 - (s / STEPS) * length;
                    bilinear(bright, w, h, cx + (x - cx) * t, cy + (y - cy) * t, one, 0);
                    for (let n = 0; n < 3; n++) into[n]! += one[n]! * weight * strength / STEPS;
                    weight *= decay;
                }
            });
        }
        case 'flare': {
            const [cx, cy] = centre();
            const col = parseColor((p.color as string | undefined) ?? '#ffe0b0');
            const [size, strength] = [num(p, 'size', 60) * k, num(p, 'strength', 1)];
            const [mx, my] = [w / 2, h / 2];
            const ghosts = [[-0.4, 0.22, 0.14], [-0.8, 0.12, 0.2], [-1.3, 0.34, 0.09], [-1.7, 0.17, 0.13]] as const;
            return screened(px, w, h, (x, y, into) => {
                const d = Math.hypot(x - cx, y - cy);
                let v = 0.9 * Math.exp(-((d / size) ** 2)) + 0.25 * Math.exp(-d / (size * 2.5));
                // A streak along the sensor, and ghosts in a line through the middle of the frame.
                v += 0.5 * Math.exp(-Math.abs(y - cy) / (size * 0.05)) * Math.exp(-Math.abs(x - cx) / (size * 3.5));
                for (const [t, r, a] of ghosts) {
                    const [gx, gy] = [cx + (mx - cx) * (1 - t), cy + (my - cy) * (1 - t)];
                    const gd = Math.hypot(x - gx, y - gy) / (size * r * 2.2);
                    if (gd < 1) v += a * (1 - gd * gd * gd * gd);
                }
                for (let n = 0; n < 3; n++) into[n]! += col[n]! * v * strength;
            });
        }
        case 'texture': {
            // A relief lit from one side and not a stain: canvas, paper, plaster.
            const [scale, amount, seed] = [num(p, 'scale', 3) * k, num(p, 'amount', 0.3), num(p, 'seed', 1)];
            const a = (num(p, 'angle', 135) * Math.PI) / 180;
            const [lx, ly] = [Math.cos(a), Math.sin(a)];
            const out = new Float32Array(px);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const at = (y * w + x) * 4;
                    const v = fractalNoise(x / scale, y / scale, 3, seed);
                    const slope = v - fractalNoise((x + lx) / scale, (y + ly) / scale, 3, seed);
                    const shade = 1 + slope * amount * 3;
                    const alpha = px[at + 3]!;
                    for (let n = 0; n < 3; n++) out[at + n] = Math.max(0, Math.min(alpha, px[at + n]! * shade));
                }
            }
            return out;
        }
        default:
            throw new Error(`no filter "${String(name)}"`);
    }
}
