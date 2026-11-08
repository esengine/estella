// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { EnvironmentInputs } from './fields';

/** Fit an upright building's base to a grid over its entire rotated footprint. */
export interface GroundingOptions {
    /** Width and depth in model units, centred on the model's origin. */
    size: readonly [number, number];
    /** Odd grid side, including corners, edges and centre (3, 5, 7 or 9; default 5). */
    samples?: number;
    /** Base elevation before offset; highest avoids embedding the base (default). */
    mode?: 'highest' | 'lowest' | 'mean' | 'center';
    /** Reject sites with more height variation than this, in world units. */
    maxRelief?: number;
    /** Vertical offset in model units, scaled with the model. */
    offset?: number;
}

/** Measurements a foundation builder or a placement diagnostic can use. */
export interface GroundFit {
    y: number;
    min: number;
    max: number;
    mean: number;
    relief: number;
    /** Distance from the base to the lowest sampled ground, in world units. */
    supportDepth: number;
    /** Distance from the base to the highest sampled ground, in world units. */
    buriedDepth: number;
    samples: number;
}

export type GroundFitResult = { ok: true; fit: GroundFit } | { ok: false; reason: 'noGround' | 'slope' | 'water' | 'relief' };

/** Shared by file validation and direct callers; bad grids must never cause unbounded sampling. */
export function validateGrounding(options: GroundingOptions): void {
    if (!options || !Array.isArray(options.size) || options.size.length !== 2
        || options.size.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('grounding.size: two positive model dimensions');
    if (![3, 5, 7, 9].includes(options.samples ?? 5)) throw new Error('grounding.samples: 3, 5, 7 or 9');
    if (!['highest', 'lowest', 'mean', 'center'].includes(options.mode ?? 'highest')) throw new Error('grounding.mode: highest, lowest, mean or center');
    if (options.maxRelief !== undefined && (!Number.isFinite(options.maxRelief) || options.maxRelief < 0)) throw new Error('grounding.maxRelief: a nonnegative world distance');
    if (options.offset !== undefined && !Number.isFinite(options.offset)) throw new Error('grounding.offset: a finite model distance');
}

/**
 * Samples the same ground used by the plan, without changing it. Positive yaw follows the engine's +Y quaternion rotation.
 * A supported site is a finite grid test, not a proof about features smaller than its sample spacing. Use maxRelief no greater
 * than the model's foundation depth, or level the accepted site with a WorldZone before placing an authored building.
 */
export function fitGroundFootprint(
    inputs: Pick<EnvironmentInputs, 'ground' | 'waterDepth'>, x: number, z: number, yaw: number, scale: number,
    options: GroundingOptions, limits: { minUp?: number; waterDepth?: number } = {},
): GroundFitResult {
    validateGrounding(options);
    if (![x, z, yaw, scale].every(Number.isFinite) || scale <= 0) throw new Error('grounding transform: finite position, yaw and positive scale');
    const n = options.samples ?? 5, c = Math.cos(yaw), s = Math.sin(yaw);
    let min = Infinity, max = -Infinity, sum = 0, center = 0;
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
        const lx = (ix / (n - 1) - 0.5) * options.size[0] * scale;
        const lz = (iz / (n - 1) - 0.5) * options.size[1] * scale;
        const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
        const g = inputs.ground(wx, wz);
        if (!g || !Number.isFinite(g.y) || !Number.isFinite(g.up)) return { ok: false, reason: 'noGround' };
        if (g.up < (limits.minUp ?? 0)) return { ok: false, reason: 'slope' };
        const water = inputs.waterDepth?.(wx, wz, g.y) ?? 0;
        if (!Number.isFinite(water)) return { ok: false, reason: 'noGround' };
        if (water > (limits.waterDepth ?? 0)) return { ok: false, reason: 'water' };
        min = Math.min(min, g.y); max = Math.max(max, g.y); sum += g.y;
        if (ix === (n - 1) / 2 && iz === (n - 1) / 2) center = g.y;
    }
    const relief = max - min, mean = sum / (n * n);
    if (relief > (options.maxRelief ?? Infinity)) return { ok: false, reason: 'relief' };
    const levels = { highest: max, lowest: min, mean, center };
    const y = levels[options.mode ?? 'highest'] + (options.offset ?? 0) * scale;
    return { ok: true, fit: { y, min, max, mean, relief, supportDepth: Math.max(0, y - min), buriedDepth: Math.max(0, max - y), samples: n * n } };
}
