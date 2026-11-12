// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waves.ts
 * @brief   The height of the water, in one formula the CPU and the Water shader share.
 *
 * @details A set of peaked sines (`exp(sin(theta) - 1)`: a crest narrower than its trough) spread about the wind, each with its own length,
 *          height and speed. The shader's `waterWaveHeight` and `waveSlope` are the same arithmetic in GLSL and WGSL, written out FROM the
 *          table below when the shader's source is assembled (waterShader.ts), so what a floating object reads here is what is drawn there
 *          and there is one place to change a wave.
 *
 *          Each wave is taken at a place bent off the true one (`waveBend`). Straight sines a few directions apart add up to crests
 *          that are long parallel lines, which is how a sea of them looked from above: scored with diagonal strokes, turning with the
 *          wind.
 *
 *          Everything here is in the body's own space: x and z along its surface, the height along its up.
 */

/** How many waves a sea is the sum of at most. */
export const WAVE_SET_SIZE = 8;
/** How far to either side of the wind the waves head, in degrees. */
const SPREAD = 65;
/** Each wave's length as a share of the one before it. */
const SHORTER = 0.78;
/** What the heights of the whole set add up to, as a share of the body's height: the most a crest can stand above the rest plane. */
export const WAVE_SET_HEIGHT = 2;

/**
 * The set a sea is summed from, longest first: the first heads with the wind, each after it is shorter by the same share, lower as nearly as
 * much (a wind sea's waves are about as steep at every length) and off the wind by a golden-ratio step, so no two headings are near and no
 * two lengths share a multiple. Every wave travels at the speed its length gives deep water.
 */
function buildWaveSet(): readonly (readonly [number, number, number, number])[] {
    const raw: [number, number, number, number][] = [];
    for (let i = 0; i < WAVE_SET_SIZE; i++) {
        const length = SHORTER ** i;
        const turn = i * 0.6180339887;
        raw.push([i === 0 ? 0 : SPREAD * ((turn - Math.floor(turn)) * 2 - 1), length, length ** 0.9, 1]);
    }
    const total = raw.reduce((sum, w) => sum + w[2], 0);
    const round = (v: number, digits: number): number => Number(v.toFixed(digits));
    return raw.map(([heading, length, height, speed]) => [round(heading, 1), round(length, 4), round(height * WAVE_SET_HEIGHT / total, 4), speed] as const);
}

/** Each wave of the set: its heading off the base direction (degrees), its length and its height as shares of the body's, and its speed share. */
export const WAVE_SET: readonly (readonly [number, number, number, number])[] = buildWaveSet();

/** What shapes the waves: a WaterZone's and its bodies' heights, and the parameters of the Water material they are written to. */
export interface WaveParams {
    /** Half of the most a crest stands above the rest plane (the set's heights add up to twice this), in world units. */
    height: number;
    /** Length of the longest wave. */
    length: number;
    /** A multiplier on how fast they travel. */
    speed: number;
    /** The base heading, in degrees. */
    direction: number;
    /** How many of the set's waves are summed, longest first (the quality level's); all of them when absent. */
    count?: number;
}

const TAU = Math.PI * 2;
const GRAVITY = 9.8;

/** How far a crest is bent, as a share of the longest wave. Its slope is this times the bend's frequency, about 0.33 at most. */
const BEND = 0.45;

/**
 * Where the waves are read for the true place (x, z), bent by a span of `length`: a slow sine of z moves x and one of x moves z, at
 * frequencies that share no multiple, repeating every 8.6 and 10.3 lengths. Each axis depends only on the other, so the two terms a slope needs (how x's bend changes along z,
 * z's along x) are all of its Jacobian. The shader's `waterBend` is the same arithmetic.
 *
 * @returns x and z to read at, then dx/dz and dz/dx.
 */
export function waveBend(x: number, z: number, length: number): [number, number, number, number] {
    const u = x / length, v = z / length;
    return [
        x + length * BEND * Math.sin(v * 0.73 + 1.3),
        z + length * BEND * Math.sin(u * 0.61 + 2.7),
        BEND * 0.73 * Math.cos(v * 0.73 + 1.3),
        BEND * 0.61 * Math.cos(u * 0.61 + 2.7),
    ];
}

/**
 * How much of a wave a mesh of `cell`-sized cells can draw: none below three cells to a wavelength, all of it from six. The shader applies the
 * same ramp per vertex with the cell size of the ring the vertex is in, so a coarse far ring does not alias; `cell` 0 draws every wave.
 */
export function waveFade(length: number, cell: number): number {
    if (cell <= 0) return 1;
    return Math.min(Math.max((length / cell - 3) / 3, 0), 1);
}

/** How many waves of the set a body sums: its count, held to the set. */
export function waveCount(p: WaveParams): number {
    return Math.min(Math.max(Math.round(p.count ?? WAVE_SET.length), 1), WAVE_SET.length);
}

/** The surface's height above the body's rest plane at (x, z), `time` seconds in. */
export function waveHeight(p: WaveParams, x: number, z: number, time: number, cell = 0): number {
    let height = 0;
    const base = p.direction * Math.PI / 180;
    const [bx, bz] = waveBend(x, z, p.length);
    let used = waveCount(p);
    for (const [heading, lengthShare, heightShare, speedShare] of WAVE_SET) {
        if (used-- <= 0) break;
        const length = p.length * lengthShare;
        const k = TAU / length;
        const a = base + heading * Math.PI / 180;
        const omega = Math.sqrt(GRAVITY * k) * p.speed * speedShare;
        const theta = k * (Math.sin(a) * bx + Math.cos(a) * bz) - omega * time;
        height += p.height * heightShare * Math.exp(Math.sin(theta) - 1) * waveFade(length, cell);
    }
    return height;
}

/** The slope of the surface at (x, z): how fast its height changes along x and along z. */
export function waveSlope(p: WaveParams, x: number, z: number, time: number): [number, number] {
    let sx = 0, sz = 0;
    const base = p.direction * Math.PI / 180;
    const [bx, bz, xAlongZ, zAlongX] = waveBend(x, z, p.length);
    let used = waveCount(p);
    for (const [heading, lengthShare, heightShare, speedShare] of WAVE_SET) {
        if (used-- <= 0) break;
        const k = TAU / (p.length * lengthShare);
        const a = base + heading * Math.PI / 180;
        const dx = Math.sin(a), dz = Math.cos(a);
        const omega = Math.sqrt(GRAVITY * k) * p.speed * speedShare;
        const theta = k * (dx * bx + dz * bz) - omega * time;
        const rise = p.height * heightShare * Math.exp(Math.sin(theta) - 1) * Math.cos(theta) * k;
        sx += dx * rise;
        sz += dz * rise;
    }
    return [sx + sz * zAlongX, sz + sx * xAlongZ];
}

/**
 * The surf: waves that run in across the last `4 * length` of water, break on the shore and run up past it. `shore` is the distance to
 * the shore (above zero on the water), `height` a breaker's most; the crests are lines of `phase` (a zone's is the shore's, smoothed,
 * so they come in straight). Each has a steep face shoreward and a long back, at a deep-water wave's speed for their length times
 * `speed`. The Water shader draws the same.
 */
export function surfHeight(shore: number, height: number, length: number, speed: number, time: number, phase = shore): number {
    if (height <= 0 || length <= 0) return 0;
    const reach = length * 4;
    if (shore > reach || shore < -reach * 0.05) return 0;
    const celerity = Math.sqrt(GRAVITY * length / TAU) * speed;
    const u = fract(phase / length + (celerity * time) / length);
    // Seaward of a crest the water falls away slowly; shoreward its face is steep.
    const face = 0.2;
    const g = u > 1 - face ? smooth01((u - (1 - face)) / face) : 1 - smooth01(u / (1 - face));
    return height * g * g * surfEnvelope(shore, reach);
}

/** How much of the surf stands at `shore`: none out past its reach, rising as the water shoals, and dying as it runs up the ground. */
export function surfEnvelope(shore: number, reach: number): number {
    const shoal = 1 - smooth01((shore - reach * 0.25) / (reach * 0.75));
    const runUp = shore >= 0 ? 1 : 1 - smooth01(-shore / (reach * 0.05));
    return shoal * runUp;
}

function fract(x: number): number {
    return x - Math.floor(x);
}

function smooth01(t: number): number {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
}
