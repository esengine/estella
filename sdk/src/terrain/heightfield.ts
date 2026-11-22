// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    heightfield.ts
 * @brief   The ground as numbers: a grid of heights, read by a heightmap image or made by noise.
 *
 * @details Heights are stored as 0..1 and scaled by the terrain's own height, so the same field
 *          serves a terrain of any size and a rescale never touches the data. Everything here is
 *          pure and has no engine in it, which is what lets the mesh builder and the tests stand on it.
 */

/** A rectangular grid of heights, 0 to 1, row-major with z as the row. */
export interface Heightfield {
    readonly width: number;
    readonly height: number;
    readonly data: Float32Array;
}

/**
 * How a heightmap image holds its heights. The file says how deep its channels are; this says what they mean, so an image is never
 * read one way or another by what its pixels happen to hold.
 * @experimental
 */
export const HeightmapFormat = {
    /** The grey (or red) channel is the height, at the depth the file has: 16 bits from a 16-bit PNG, 8 (256 steps) from any other. */
    Grey: 0,
    /** Sixteen bits across two 8-bit channels: red is the high byte, green the low one. */
    RedGreen16: 1,
} as const;

/**
 * A heightfield from an RGBA image read as data, 0 at its lowest and 1 at its highest, by `format`. `wide` is the first channel at 16
 * bits, for an image whose file holds 16 bits a channel.
 */
export function heightfieldFromPixels(width: number, height: number, pixels: ArrayLike<number>, format: number = HeightmapFormat.Grey,
    wide?: ArrayLike<number>): Heightfield {
    const data = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        data[i] = format === HeightmapFormat.RedGreen16 ? (pixels[i * 4]! * 256 + pixels[i * 4 + 1]!) / 65535
            : wide ? wide[i]! / 65535 : pixels[i * 4]! / 255;
    }
    return { width, height, data };
}

/** A 32-bit integer hash, stable across hosts, so a seed makes the same ground everywhere. */
function hash2(x: number, y: number, seed: number): number {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/** What {@link proceduralHeightfield} is made from. */
export interface ProceduralParams {
    /** Samples along each side. */
    resolution: number;
    seed: number;
    /** How many times the biggest hill repeats across the terrain. */
    frequency: number;
    octaves: number;
    /** What each octave keeps of the height of the one before it: lower is smoother. */
    persistence: number;
    /** 0 is rolling hills; 1 is sharp ridges, the way eroded mountains look. */
    ridged: number;
    /** How far the noise is pushed about by noise of its own before it is read, 0 to 1: bent ridges and winding valleys instead of round hills. */
    warp?: number;
}

/** Fractal noise as a heightfield, scaled to span 0 to 1 so the terrain's height is its true range. */
export function proceduralHeightfield(p: ProceduralParams): Heightfield {
    const n = Math.max(2, Math.floor(p.resolution));
    const data = new Float32Array(n * n);
    const warp = Math.min(Math.max(p.warp ?? 0, 0), 1);
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            let x = i / (n - 1), y = j / (n - 1);
            if (warp > 0) {
                // Two octaves of noise at the biggest hills' scale move the point up to half a hill before it is read.
                const f = p.frequency;
                const wx = valueNoise(x * f + 5.2, y * f + 1.3, p.seed + 7001) + 0.5 * valueNoise(x * f * 2 + 2.8, y * f * 2 + 9.1, p.seed + 7002);
                const wy = valueNoise(x * f + 8.3, y * f + 2.8, p.seed + 7003) + 0.5 * valueNoise(x * f * 2 + 4.4, y * f * 2 + 6.6, p.seed + 7004);
                x += ((wx / 1.5) * 2 - 1) * warp * 0.5 / f;
                y += ((wy / 1.5) * 2 - 1) * warp * 0.5 / f;
            }
            let amplitude = 1, frequency = p.frequency, sum = 0, norm = 0;
            for (let o = 0; o < Math.max(1, Math.min(8, Math.floor(p.octaves))); o++) {
                let v = valueNoise(x * frequency, y * frequency, p.seed + o * 101);
                v = v * (1 - p.ridged) + (1 - Math.abs(v * 2 - 1)) * p.ridged;
                sum += v * amplitude;
                norm += amplitude;
                amplitude *= p.persistence;
                frequency *= 2;
            }
            const v = sum / norm;
            data[j * n + i] = v;
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    const span = max - min || 1;
    for (let i = 0; i < data.length; i++) data[i] = (data[i]! - min) / span;
    return { width: n, height: n, data };
}

/** The height at (u, v), each 0 to 1 across the field, bilinear between the four samples it falls among. */
export function sampleHeight(field: Heightfield, u: number, v: number): number {
    const x = Math.min(Math.max(u, 0), 1) * (field.width - 1);
    const y = Math.min(Math.max(v, 0), 1) * (field.height - 1);
    const x0 = Math.min(Math.floor(x), field.width - 2), y0 = Math.min(Math.floor(y), field.height - 2);
    const fx = x - x0, fy = y - y0;
    const at = (i: number, j: number): number => field.data[j * field.width + i]!;
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
}

/** The unit normal of the ground at (u, v), from the heights a texel either side of it, in world units. */
export function terrainNormal(
    field: Heightfield, u: number, v: number, sizeX: number, sizeZ: number, heightScale: number,
): [number, number, number] {
    const du = 1 / (field.width - 1), dv = 1 / (field.height - 1);
    const dx = (sampleHeight(field, u + du, v) - sampleHeight(field, u - du, v)) * heightScale / (2 * du * sizeX);
    const dz = (sampleHeight(field, u, v + dv) - sampleHeight(field, u, v - dv)) * heightScale / (2 * dv * sizeZ);
    const len = Math.hypot(dx, 1, dz);
    return [-dx / len, 1 / len, -dz / len];
}

/** What {@link erodeHeightfield} wears the ground with. */
export interface ErosionParams {
    /** Optional resistance to cutting, 0 to 1 per height sample. */
    hardness?: Float32Array;
    /** How much rain falls, 0 to 1: at 1, a drop for every sample of the field. */
    amount: number;
    seed: number;
    /** The field's world size along x and z, and its world height: erosion works in the ground's own proportions. */
    sizeX: number;
    sizeZ: number;
    height: number;
}

/** The ground after the rain, and where the water ran: `flow` is 0 to 1 per sample, the share of the busiest channel's water that passed. */
export interface Eroded { field: Heightfield; flow: Float32Array }

/**
 * Hydraulic erosion: drops of rain fall at random over the field, each runs downhill carrying what it can for its speed and the water in it,
 * cuts the ground where it carries less than it could, lays it down where it carries more or slows (in a hollow, on a flat, as it dries),
 * and evaporates as it goes. What is left has gullies down the slopes, sharper ridges between them and silt in the valleys, and where the water
 * ran is kept as `flow`. The same seed wears the same ground everywhere.
 */
export function erodeHeightfield(field: Heightfield, p: ErosionParams): Eroded {
    const job = erosionJob(field, p);
    for (;;) {
        const next = job.next();
        if (next.done) return next.value;
    }
}

/** {@link erodeHeightfield} as a job that yields its progress (0 to 1) every few thousand drops, for spreading over frames. */
export function* erosionJob(field: Heightfield, p: ErosionParams): Generator<number, Eroded, void> {
    const w = field.width, h = field.height;
    const drops = Math.min(600_000, Math.floor(Math.min(Math.max(p.amount, 0), 4) * w * h));
    if (drops === 0 || w < 3 || h < 3) return { field, flow: new Float32Array(field.data.length) };
    const cell = Math.max(p.sizeX / Math.max(w - 1, 1), p.sizeZ / Math.max(h - 1, 1), 1e-6);
    // Heights in cells, so slopes and capacities mean the same on any terrain.
    const scale = p.height / cell;
    const H = new Float32Array(field.data.length);
    for (let k = 0; k < H.length; k++) H[k] = field.data[k]! * scale;
    const flow = new Float32Array(field.data.length);
    const random = mulberry32(p.seed * 7919 + 17);
    const INERTIA = 0.05, CAPACITY = 4, MIN_SLOPE = 0.01, DEPOSIT = 0.3, ERODE = 0.3, EVAPORATE = 0.02, GRAVITY = 4, LIFE = 40;
    // A drop wears the ground over the cells about it, the nearer the more.
    const RADIUS = 2;
    const brush: [number, number, number][] = [];
    let total = 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > RADIUS) continue;
        brush.push([dx, dy, 1 - d / RADIUS]);
        total += 1 - d / RADIUS;
    }
    for (const b of brush) b[2] /= total;
    const gradient = (x: number, y: number): [number, number, number] => {
        const ix = Math.min(Math.floor(x), w - 2), iy = Math.min(Math.floor(y), h - 2);
        const fx = x - ix, fy = y - iy;
        const k = iy * w + ix;
        const a = H[k]!, b = H[k + 1]!, c = H[k + w]!, d = H[k + w + 1]!;
        return [(b - a) * (1 - fy) + (d - c) * fy, (c - a) * (1 - fx) + (d - b) * fx, a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy];
    };
    for (let n = 0; n < drops; n++) {
        if (n % 2000 === 0) yield n / drops;
        let x = random() * (w - 1), y = random() * (h - 1);
        let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
        for (let life = 0; life < LIFE; life++) {
            const ix = Math.floor(x), iy = Math.floor(y);
            const fx = x - ix, fy = y - iy;
            const [gx, gy, here] = gradient(x, y);
            dx = dx * INERTIA - gx * (1 - INERTIA);
            dy = dy * INERTIA - gy * (1 - INERTIA);
            const len = Math.hypot(dx, dy);
            if (len < 1e-9) break;
            dx /= len; dy /= len;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx > w - 1.001 || ny < 0 || ny > h - 1.001) break;
            const fall = gradient(nx, ny)[2] - here;
            const capacity = Math.max(-fall * speed * water * CAPACITY, MIN_SLOPE);
            const k = iy * w + ix;
            flow[k] = flow[k]! + water;
            if (sediment > capacity || fall > 0) {
                // Uphill, fill the hollow it is leaving (no more than it is deep); else lay down what it cannot carry.
                const put = fall > 0 ? Math.min(fall, sediment) : (sediment - capacity) * DEPOSIT;
                sediment -= put;
                H[k] = H[k]! + put * (1 - fx) * (1 - fy);
                H[k + 1] = H[k + 1]! + put * fx * (1 - fy);
                H[k + w] = H[k + w]! + put * (1 - fx) * fy;
                H[k + w + 1] = H[k + w + 1]! + put * fx * fy;
            } else {
                const take = Math.min((capacity - sediment) * ERODE, -fall);
                for (const [bx, by, weight] of brush) {
                    const cx = ix + bx, cy = iy + by;
                    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
                    const c = cy * w + cx;
                    const cut = Math.min(H[c]!, take * weight * (1 - (p.hardness?.[c] ?? 0)));
                    H[c] = H[c]! - cut;
                    sediment += cut;
                }
            }
            speed = Math.sqrt(Math.max(speed * speed - fall * GRAVITY, 0));
            water *= 1 - EVAPORATE;
            x = nx; y = ny;
        }
    }
    const data = new Float32Array(H.length);
    let busiest = 0;
    for (let k = 0; k < H.length; k++) {
        data[k] = Math.min(Math.max(H[k]! / scale, 0), 1);
        busiest = Math.max(busiest, flow[k]!);
    }
    // Channels are told apart over orders of magnitude: the share is taken on a log scale.
    const top = Math.log1p(busiest);
    for (let k = 0; k < flow.length; k++) flow[k] = top > 0 ? Math.log1p(flow[k]!) / top : 0;
    return { field: { width: w, height: h, data }, flow };
}

/** A small seeded random number generator: the same seed gives the same sequence on every host. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
