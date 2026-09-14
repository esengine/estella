// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    solve.ts
 * @brief   How much light reaches each texel — direct, then what bounced.
 *
 * The bounce reads the atlas the pass before it wrote, so a second round costs
 * what the first did and carries light one surface further. That is the whole
 * reason a bake is worth having: it is the term a real-time renderer here has
 * no way to compute at all.
 */

import type { Bvh } from './bvh';
import type { LumelField } from './atlas';

/** A light as a bake sees one: no shadow maps, no cap on how many. */
export interface BakeLight {
    kind: 'directional' | 'point' | 'spot';
    /** Where it is — point and spot only. */
    position?: readonly [number, number, number];
    /** Where it aims — directional and spot only. */
    direction?: readonly [number, number, number];
    color: readonly [number, number, number];
    intensity: number;
    /** Reach, in world units. Past it a point or spot light contributes nothing. */
    radius?: number;
    /** Cosines of the half angles a spot falls off between. */
    innerCos?: number;
    outerCos?: number;
}

/** Where a ray that hit triangle `t` lands in the atlas, and what it reflects. */
export interface HitLookup {
    /** UV of each triangle's three corners, six floats each. */
    triUV: Float32Array;
    /** Which surface each triangle belongs to. */
    triSurface: Int32Array;
    /** Patch origin and side per surface, as `[x, y, side, rotated]`. */
    patch: Float32Array;
    /** Albedo per surface, three floats each. */
    albedo: Float32Array;
}

const SHADOW_EPSILON = 1e-3;

/** Cosine-weighted directions over a hemisphere, as a fixed low-discrepancy set.
 *  Fixed and not random: a bake that answers differently twice cannot be told
 *  from one that answers wrongly once. */
function hemisphere(samples: number): Float32Array {
    const out = new Float32Array(samples * 3);
    for (let i = 0; i < samples; i++) {
        // Hammersley: the second coordinate is the bit-reversal of the index.
        let bits = i;
        bits = ((bits << 16) | (bits >>> 16)) >>> 0;
        bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
        bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
        bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
        bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
        const u = (i + 0.5) / samples;
        const v = bits * 2.3283064365386963e-10;
        const r = Math.sqrt(u);
        const phi = 2 * Math.PI * v;
        out[i * 3] = r * Math.cos(phi);
        out[i * 3 + 1] = r * Math.sin(phi);
        out[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - u));
    }
    return out;
}

/** An orthonormal frame around `n`, built branchlessly (Duff et al.). */
function frame(nx: number, ny: number, nz: number, out: Float32Array): void {
    const sign = nz >= 0 ? 1 : -1;
    const a = -1 / (sign + nz);
    const b = nx * ny * a;
    out[0] = 1 + sign * nx * nx * a; out[1] = sign * b; out[2] = -sign * nx;
    out[3] = b; out[4] = sign + ny * ny * a; out[5] = -ny;
}

/**
 * What every light delivers straight to each lumel, with nothing between.
 *
 * Writes irradiance, not colour: the surface's own albedo is applied where the
 * bake is read, so one atlas serves a mesh whose texture changes.
 */
export function solveDirect(lumels: LumelField, bvh: Bvh, lights: readonly BakeLight[],
                            ambient: readonly [number, number, number],
                            out: Float32Array): void {
    out.fill(0);
    for (let i = 0; i < lumels.count; i++) {
        const px = lumels.position[i * 3], py = lumels.position[i * 3 + 1], pz = lumels.position[i * 3 + 2];
        const nx = lumels.normal[i * 3], ny = lumels.normal[i * 3 + 1], nz = lumels.normal[i * 3 + 2];
        let r = ambient[0], g = ambient[1], b = ambient[2];
        for (const light of lights) {
            let lx: number, ly: number, lz: number, distance: number, falloff = 1;
            if (light.kind === 'directional') {
                const d = light.direction ?? [0, 0, -1];
                const len = Math.hypot(d[0], d[1], d[2]) || 1;
                lx = -d[0] / len; ly = -d[1] / len; lz = -d[2] / len;
                distance = Infinity;
            } else {
                const p = light.position ?? [0, 0, 0];
                lx = p[0] - px; ly = p[1] - py; lz = p[2] - pz;
                distance = Math.hypot(lx, ly, lz);
                if (distance < 1e-6) continue;
                lx /= distance; ly /= distance; lz /= distance;
                const radius = light.radius ?? 0;
                if (radius > 0) {
                    if (distance >= radius) continue;
                    const k = 1 - distance / radius;
                    falloff = k * k;
                }
                if (light.kind === 'spot') {
                    const d = light.direction ?? [0, 0, -1];
                    const len = Math.hypot(d[0], d[1], d[2]) || 1;
                    const cos = -(lx * d[0] + ly * d[1] + lz * d[2]) / len;
                    const outer = light.outerCos ?? 0.7;
                    const inner = light.innerCos ?? 0.9;
                    if (cos <= outer) continue;
                    falloff *= Math.min(1, (cos - outer) / Math.max(inner - outer, 1e-4));
                }
            }
            const lambert = nx * lx + ny * ly + nz * lz;
            if (lambert <= 0) continue;
            const far = distance === Infinity ? 1e7 : distance - SHADOW_EPSILON;
            if (bvh.occluded(px + nx * SHADOW_EPSILON, py + ny * SHADOW_EPSILON, pz + nz * SHADOW_EPSILON,
                             lx, ly, lz, far, SHADOW_EPSILON)) continue;
            const w = lambert * falloff * light.intensity;
            r += light.color[0] * w; g += light.color[1] * w; b += light.color[2] * w;
        }
        out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
    }
}

/**
 * One bounce: every lumel gathers what the surfaces it can see are giving off.
 *
 * `previous` is the atlas as the pass before left it, indexed by texel — which
 * is why a ray has to be turned back into a texel to be worth anything, and what
 * {@link HitLookup} is for.
 */
export function solveBounce(lumels: LumelField, bvh: Bvh, lookup: HitLookup,
                            previous: Float32Array, atlasSize: number, samples: number,
                            accumulate: Float32Array): void {
    const dirs = hemisphere(samples);
    const basis = new Float32Array(6);
    const far = 1e7;
    for (let i = 0; i < lumels.count; i++) {
        const px = lumels.position[i * 3], py = lumels.position[i * 3 + 1], pz = lumels.position[i * 3 + 2];
        const nx = lumels.normal[i * 3], ny = lumels.normal[i * 3 + 1], nz = lumels.normal[i * 3 + 2];
        frame(nx, ny, nz, basis);
        let r = 0, g = 0, b = 0;
        for (let s = 0; s < samples; s++) {
            const a = dirs[s * 3], c = dirs[s * 3 + 1], d = dirs[s * 3 + 2];
            const dx = basis[0] * a + basis[3] * c + nx * d;
            const dy = basis[1] * a + basis[4] * c + ny * d;
            const dz = basis[2] * a + basis[5] * c + nz * d;
            const tri = bvh.hit(px + nx * SHADOW_EPSILON, py + ny * SHADOW_EPSILON, pz + nz * SHADOW_EPSILON,
                                dx, dy, dz, far, SHADOW_EPSILON);
            if (tri < 0) continue;
            const texel = texelOf(lookup, tri, bvh.hitU, bvh.hitV, atlasSize);
            if (texel < 0) continue;
            const surface = lookup.triSurface[tri];
            r += previous[texel * 3] * lookup.albedo[surface * 3];
            g += previous[texel * 3 + 1] * lookup.albedo[surface * 3 + 1];
            b += previous[texel * 3 + 2] * lookup.albedo[surface * 3 + 2];
        }
        // Cosine-weighted sampling already carries the projected-area term, so
        // the estimator is the plain mean of what came back.
        accumulate[i * 3] += r / samples;
        accumulate[i * 3 + 1] += g / samples;
        accumulate[i * 3 + 2] += b / samples;
    }
}

/** Where on the atlas a hit lands, or -1 when it falls outside it. */
function texelOf(lookup: HitLookup, tri: number, u: number, v: number, size: number): number {
    const at = tri * 6;
    const w0 = 1 - u - v;
    const uu = w0 * lookup.triUV[at] + u * lookup.triUV[at + 2] + v * lookup.triUV[at + 4];
    const vv = w0 * lookup.triUV[at + 1] + u * lookup.triUV[at + 3] + v * lookup.triUV[at + 5];
    const s = lookup.triSurface[tri] * 4;
    const rotated = lookup.patch[s + 3] !== 0;
    const side = lookup.patch[s + 2];
    const x = Math.floor(lookup.patch[s] + (rotated ? vv : uu) * side);
    const y = Math.floor(lookup.patch[s + 1] + (rotated ? uu : vv) * side);
    if (x < 0 || y < 0 || x >= size || y >= size) return -1;
    return y * size + x;
}
