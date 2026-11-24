// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fields.ts
 * @brief   The environment a world is laid out by: numbers read anywhere in it, the same for the same seed on every machine.
 *
 * @details A field is a function of the world position. The ground's (`height`, `up`, `slope`) and the water's (`waterDepth`, and
 *          `shoreDistance`: how far a dry place is from the water's edge, negative in the water) are
 *          read from the terrain and the water; `moisture`, `temperature` and `rock` are seeded noise, slow across the world; a game
 *          adds fields of its own. A zone may set a field over its area, blended in by its weight, so a designer can make a wet hollow
 *          or a dry clearing by hand. Nothing here depends on what is loaded or in what order it was asked.
 */
import { noised } from '../terrain/source';

/** The fields at one place, by name. `height` is NaN where there is no ground. */
export type FieldValues = Record<string, number>;

/** A field of the game's own: a number at (x, z), read after the built-in ones (which it may read from `at`). */
export type FieldFn = (x: number, z: number, at: Readonly<FieldValues>) => number;

/** A seeded noise field: `scale` world units to a feature, `octaves` layers of detail. */
export interface NoiseField { scale: number; octaves?: number }

/** Where the environment comes from. */
export interface EnvironmentInputs {
    seed: number;
    /** The ground's height, how much it faces up and (if known) its normal at (x, z), or null where there is none. */
    ground(x: number, z: number): { y: number; up: number; normal?: [number, number, number] } | null;
    /** How deep water stands over the world height `y` at (x, z): above zero under water, null where there is none. */
    waterDepth?(x: number, z: number, y: number): number | null;
    /** How far (x, z) is from the water's edge across the ground: above zero on land, below in the water, null where no water is known. */
    shoreDistance?(x: number, z: number): number | null;
    /**
     * Where (x, z) is in the space the noise fields are read from. Absent, the noise is flat, over x and z; a round world gives the point's place in
     * three dimensions, so a field wanders over it with no seam where its ground's patches meet.
     */
    space?(x: number, z: number): readonly [number, number, number];
    /** The noise fields; absent ones keep their defaults (moisture 900, temperature 2400, rock 500 world units). */
    noise?: Partial<Record<string, NoiseField>>;
    /** Fields of the game's own. */
    fields?: Record<string, FieldFn>;
    /** Fields set by hand over an area: the value, and how much of it holds at (x, z) (0 to 1). */
    overrides?(x: number, z: number): { field: string; value: number; weight: number }[];
}

const DEFAULT_NOISE: Record<string, NoiseField> = {
    moisture: { scale: 900, octaves: 4 },
    temperature: { scale: 2400, octaves: 3 },
    rock: { scale: 500, octaves: 4 },
};

/** A stable 32-bit hash of integers, as a number in [0, 1). */
export function hash01(...v: number[]): number {
    let h = 0x9e3779b9 | 0;
    for (const n of v) {
        h = Math.imul(h ^ (n | 0), 0x85ebca6b);
        h = (h ^ (h >>> 13)) | 0;
        h = Math.imul(h, 0xc2b2ae35);
        h = (h ^ (h >>> 16)) | 0;
    }
    return (h >>> 0) / 4294967296;
}

/** A stable hash of a string, for mixing a name into a seed. */
export function hashString(s: string): number {
    let h = 0x811c9dc5 | 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h | 0;
}

/** Fractal value noise in three dimensions, 0 to 1: what a round world's slow fields are read from, which has no seam and no pole. */
export function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
    let sum = 0, norm = 0, amp = 1, freq = 1;
    for (let o = 0; o < octaves; o++) {
        sum += noise3(x * freq, y * freq, z * freq, seed + o * 131) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
}

function hash3(x: number, y: number, z: number, seed: number): number {
    return hash01(x, y, z, seed);
}

/** Smooth value noise in three dimensions, 0 to 1, at a point measured in lattice cells. */
function noise3(x: number, y: number, z: number, seed: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const c = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz, seed);
    const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * sx, x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * sx;
    const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * sx, x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * sx;
    const y0 = x00 + (x10 - x00) * sy, y1 = x01 + (x11 - x01) * sy;
    return y0 + (y1 - y0) * sz;
}

/** Fractal value noise, 0 to 1. */
export function fbm(x: number, z: number, seed: number, octaves: number): number {
    let sum = 0, norm = 0, amp = 1, freq = 1;
    for (let o = 0; o < octaves; o++) {
        sum += noised(x * freq, z * freq, seed + o * 131)[0] * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
}

/** Samples the environment. */
export class Environment {
    private readonly noise_: Record<string, NoiseField>;
    private readonly seeds_: Record<string, number> = {};

    constructor(readonly inputs: EnvironmentInputs) {
        this.noise_ = { ...DEFAULT_NOISE };
        for (const [name, f] of Object.entries(inputs.noise ?? {})) if (f) this.noise_[name] = f;
        for (const name of Object.keys(this.noise_)) this.seeds_[name] = (inputs.seed * 7919) ^ hashString(name);
    }

    /**
     * Every field at (x, z), each worked out the first time it is read and not before: a biome reads three or four of the dozen, and a candidate asks
     * of every biome, so working all of them out for each was most of what laying out a world cost.
     */
    sample(x: number, z: number): FieldValues {
        const at: FieldValues = {};
        const lazy = (name: string, compute: () => number): void => {
            let done = false, value = 0;
            Object.defineProperty(at, name, {
                enumerable: true, configurable: true,
                get: () => {
                    if (!done) {
                        value = compute();
                        done = true;
                    }
                    return value;
                },
                set: (v: number) => { value = v; done = true; },
            });
        };
        let g: ReturnType<EnvironmentInputs['ground']> | undefined;
        const ground = (): ReturnType<EnvironmentInputs['ground']> => (g === undefined ? (g = this.inputs.ground(x, z)) : g);
        lazy('height', () => ground()?.y ?? NaN);
        lazy('up', () => ground()?.up ?? 1);
        lazy('slope', () => 1 - (ground()?.up ?? 1));
        lazy('waterDepth', () => { const gr = ground(); return gr && this.inputs.waterDepth ? this.inputs.waterDepth(x, z, gr.y) ?? -Infinity : -Infinity; });
        lazy('shoreDistance', () => this.inputs.shoreDistance?.(x, z) ?? Infinity);
        for (const [name, f] of Object.entries(this.noise_)) {
            const scale = Math.max(f.scale, 1e-6), octaves = Math.max(1, f.octaves ?? 3);
            if (this.inputs.space) {
                lazy(name, () => { const p = this.inputs.space!(x, z); return fbm3(p[0] / scale, p[1] / scale, p[2] / scale, this.seeds_[name]!, octaves); });
            } else lazy(name, () => fbm(x / scale, z / scale, this.seeds_[name]!, octaves));
        }
        for (const [name, f] of Object.entries(this.inputs.fields ?? {})) lazy(name, () => f(x, z, at));
        for (const o of this.inputs.overrides?.(x, z) ?? []) {
            const base = at[o.field] ?? o.value;
            at[o.field] = base + (o.value - base) * Math.min(Math.max(o.weight, 0), 1);
        }
        return at;
    }
}
