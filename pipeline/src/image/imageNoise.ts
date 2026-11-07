// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export type Rgba = readonly [number, number, number, number];

export function parseColor(text: string): Rgba {
    const h = /^#([0-9a-fA-F]+)$/.exec(text)?.[1];
    if (!h || ![3, 4, 6, 8].includes(h.length)) throw new Error(`color ${JSON.stringify(text)} must be #rgb, #rgba, #rrggbb or #rrggbbaa`);
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    const at = (i: number): number => parseInt(full.slice(i, i + 2), 16) / 255;
    return [at(0), at(2), at(4), full.length === 8 ? at(6) : 1];
}

export function blurMask(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
    if (sigma <= 0) return src;
    const r = Math.max(1, Math.round(sigma * 1.2));
    let cur = src;
    for (let pass = 0; pass < 3; pass++) {
        const a = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            let sum = 0;
            for (let x = -r; x <= r; x++) sum += cur[y * w + Math.max(0, Math.min(w - 1, x))]!;
            for (let x = 0; x < w; x++) {
                a[y * w + x] = sum / (2 * r + 1);
                sum += cur[y * w + Math.min(w - 1, x + r + 1)]! - cur[y * w + Math.max(0, x - r)]!;
            }
        }
        const b = new Float32Array(w * h);
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let y = -r; y <= r; y++) sum += a[Math.max(0, Math.min(h - 1, y)) * w + x]!;
            for (let y = 0; y < h; y++) {
                b[y * w + x] = sum / (2 * r + 1);
                sum += a[Math.min(h - 1, y + r + 1) * w + x]! - a[Math.max(0, y - r) * w + x]!;
            }
        }
        cur = b;
    }
    return cur;
}

export const NOISE_DIRECTIONS: readonly (readonly [number, number])[] = [
    [1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
    [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239], [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827],
];

export function cornerLift(ix: number, iy: number, seed: number, dx: number, dy: number): number {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442968193);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    const d = NOISE_DIRECTIONS[((h ^ (h >>> 16)) >>> 0) % NOISE_DIRECTIONS.length]!;
    return d[0] * dx + d[1] * dy;
}

export const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

export function gradientNoise(x: number, y: number, seed: number): number {
    const [ix, iy] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [x - ix, y - iy];
    const [sx, sy] = [fade(fx), fade(fy)];
    const top = cornerLift(ix, iy, seed, fx, fy) * (1 - sx) + cornerLift(ix + 1, iy, seed, fx - 1, fy) * sx;
    const bottom = cornerLift(ix, iy + 1, seed, fx, fy - 1) * (1 - sx) + cornerLift(ix + 1, iy + 1, seed, fx - 1, fy - 1) * sx;
    return top * (1 - sy) + bottom * sy;
}

export const NOISE_CONTRAST = [1.15, 1.3, 1.4, 1.45, 1.45, 1.45, 1.45, 1.45];

export function fractalNoise(x: number, y: number, octaves: number, seed: number): number {
    let [sum, weight, amplitude, frequency] = [0, 0, 1, 1];
    for (let i = 0; i < octaves; i++) {
        // Off the lattice, where this noise is always nothing.
        sum += gradientNoise(x * frequency + 0.37, y * frequency + 0.61, seed + i * 101) * amplitude;
        weight += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return Math.max(0, Math.min(1, 0.5 + (sum / weight) * NOISE_CONTRAST[octaves - 1]!));
}
