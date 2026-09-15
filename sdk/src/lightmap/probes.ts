// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    probes.ts
 * @brief   What light arrives at a point in the air, as nine coefficients.
 *
 * @details The bounce's gather, aimed from a point rather than from a surface:
 *          the whole sphere instead of a hemisphere, and no normal to weight by.
 *          It is the same light field the atlas holds, sampled where a thing that
 *          moves can be — which is the one place a lightmap cannot answer.
 */

import type { Bvh } from './bvh';
import { texelOf, facesRay, type HitLookup } from './solve';
import { shBasis, convolveCosine } from './sh';

/** Where one grid of probes sits, and how many. */
export interface ProbeGrid {
    /** The world box the probes fill, corner to corner. */
    min: readonly [number, number, number];
    max: readonly [number, number, number];
    /** Probes along each axis. */
    resolution: readonly [number, number, number];
}

/**
 * Directions over the whole sphere, as a fixed low-discrepancy set (Fibonacci).
 * Fixed and not random, for the reason the hemisphere's set is: a bake that
 * answers differently twice cannot be told from one that answers wrongly once.
 */
function sphere(samples: number): Float32Array {
    const out = new Float32Array(samples * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < samples; i++) {
        const y = 1 - (2 * i + 1) / samples;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const phi = i * golden;
        out[i * 3] = Math.cos(phi) * r;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = Math.sin(phi) * r;
    }
    return out;
}

/**
 * Where probe `i` of `n` sits along one axis.
 *
 * On the CORNERS — the rule ProbeStore's trilinear read assumes, so a volume's
 * own bounds are covered by its own probes. One probe sits at the middle, which
 * is the value that read takes for the whole axis.
 */
export function probeAt(min: number, max: number, i: number, n: number): number {
    if (n <= 1) return (min + max) * 0.5;
    return min + (max - min) * (i / (n - 1));
}

/**
 * Nine RGB coefficients per probe, in grid order with x varying fastest.
 *
 * `atlas` is the solved light field indexed by texel — what a surface gives off,
 * before its own albedo. A ray that hits geometry with no place in the atlas
 * returns black rather than the ambient: something is there, and it is unlit.
 */
export function solveProbes(grid: ProbeGrid, bvh: Bvh, lookup: HitLookup,
                            atlas: Float32Array, atlasSize: number, samples: number,
                            ambient: readonly [number, number, number]): Float32Array {
    const [nx, ny, nz] = grid.resolution;
    const count = Math.max(0, nx) * Math.max(0, ny) * Math.max(0, nz);
    const out = new Float32Array(count * 27);
    if (count === 0) return out;

    const dirs = sphere(samples);
    const basis = new Float32Array(9);
    const far = 1e7;
    // The Monte-Carlo weight of one direction over the sphere, folded in once.
    const weight = (4 * Math.PI) / samples;

    for (let z = 0; z < nz; z++) {
        const pz = probeAt(grid.min[2], grid.max[2], z, nz);
        for (let y = 0; y < ny; y++) {
            const py = probeAt(grid.min[1], grid.max[1], y, ny);
            for (let x = 0; x < nx; x++) {
                const px = probeAt(grid.min[0], grid.max[0], x, nx);
                const at = (x + y * nx + z * nx * ny) * 27;
                for (let s = 0; s < samples; s++) {
                    const dx = dirs[s * 3]!, dy = dirs[s * 3 + 1]!, dz = dirs[s * 3 + 2]!;
                    let r = ambient[0], g = ambient[1], b = ambient[2];
                    const tri = bvh.hit(px, py, pz, dx, dy, dz, far, 0);
                    if (tri >= 0) {
                        r = 0; g = 0; b = 0;
                        const texel = facesRay(lookup, tri, dx, dy, dz)
                            ? texelOf(lookup, tri, bvh.hitU, bvh.hitV, atlasSize) : -1;
                        if (texel >= 0) {
                            const surface = lookup.triSurface[tri]!;
                            r = atlas[texel * 3]! * lookup.albedo[surface * 3]!;
                            g = atlas[texel * 3 + 1]! * lookup.albedo[surface * 3 + 1]!;
                            b = atlas[texel * 3 + 2]! * lookup.albedo[surface * 3 + 2]!;
                        }
                    }
                    shBasis(dx, dy, dz, basis);
                    for (let i = 0; i < 9; i++) {
                        const w = basis[i]! * weight;
                        out[at + i * 3]! += r * w;
                        out[at + i * 3 + 1]! += g * w;
                        out[at + i * 3 + 2]! += b * w;
                    }
                }
                convolveCosine(out, at);
            }
        }
    }
    return out;
}
