// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    reflection.ts
 * @brief   What a shiny thing standing at a point would SEE — the whole sphere
 *          of it, as a panorama.
 *
 * @details The probe gather with the integral taken out: irradiance asks what
 *          arrives from everywhere at once, a reflection asks what arrives from
 *          each direction separately. Same rays, same surfaces, same answer per
 *          ray — {@link rayRadiance} — so the two halves of one bake cannot
 *          disagree about what a wall gives off.
 */

import type { Bvh } from './bvh';
import { rayRadiance, type HitLookup } from './solve';

/** A captured sphere: equirectangular RGB, the layout the prefilter reads. */
export interface CapturedPanorama {
    width: number;
    height: number;
    rgb: Float32Array;
}

/** What a ray that escapes the scene brings back, by direction. */
export type SkyRadiance = (dx: number, dy: number, dz: number,
                           out: Float32Array, at: number) => void;

/** A flat sky, for a bake with no environment to sample. */
export function flatSky(colour: readonly [number, number, number]): SkyRadiance {
    return (_dx, _dy, _dz, out, at) => {
        out[at] = colour[0]; out[at + 1] = colour[1]; out[at + 2] = colour[2];
    };
}

/**
 * Captures the sphere seen from `at`, as an equirectangular panorama.
 *
 * The mapping is the environment importer's — centre column +Z, row 0 +Y —
 * because this is handed to that importer's own prefilter. `atlas` is the solved
 * light field by texel, as the probes read it; `sky` answers the rays that leave.
 */
export function captureReflection(at: readonly [number, number, number],
                                  bvh: Bvh, lookup: HitLookup,
                                  atlas: Float32Array, atlasSize: number,
                                  width: number, height: number,
                                  sky: SkyRadiance): CapturedPanorama {
    const rgb = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        const theta = ((y + 0.5) / height) * Math.PI;
        const sinTheta = Math.sin(theta);
        const dy = Math.cos(theta);
        for (let x = 0; x < width; x++) {
            const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
            const dx = sinTheta * Math.sin(phi);
            const dz = sinTheta * Math.cos(phi);
            const to = (y * width + x) * 3;
            if (!rayRadiance(bvh, lookup, atlas, atlasSize, at[0], at[1], at[2], dx, dy, dz,
                             rgb, to)) {
                sky(dx, dy, dz, rgb, to);
            }
        }
    }
    return { width, height, rgb };
}
