// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    solve.ts
 * @brief   How much light reaches each texel — direct, then what arrives indirectly.
 *
 * The gather reads the atlas the pass before it wrote, so a second round costs
 * what the first did and carries light one surface further. That is the whole
 * reason a bake is worth having: it is the term a real-time renderer here has
 * no way to compute at all.
 */

import type { Bvh } from './bvh';
import type { LumelField } from './atlas';
import type { SkyRadiance } from './reflection';

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
    /** Directional only: this light is the environment's sun. The bake takes its
     *  direction and colour from there, and the sky without it. */
    followsEnvironmentSun?: boolean;
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
    /** Which way each triangle FACES, three floats each. A surface gives off
     *  light on one side; a ray arriving at the other finds an unlit back. */
    triNormal: Float32Array;
    /** Per surface: 1 where both faces are drawn, so both give off light. */
    twoSided: Uint8Array;
    /** Per surface: the share of rays it stops. Below one only for a cutout. */
    coverage: Float32Array;
    /** Whether any surface lets rays through, which costs a nearest-hit walk. */
    cutouts: boolean;
    /** How far a surface's back may sit and still be passed: half a lumel. A layer
     *  that close above a surface (a decal, a wet sheen, a duplicate) is finer than
     *  the atlas can say anything about, and stopping at its back walls the surface
     *  under it off from the sky. */
    backReach: number;
}

/** Whether a ray travelling `d` arrived at triangle `tri`'s lit side. */
export function facesRay(lookup: HitLookup, tri: number,
                         dx: number, dy: number, dz: number): boolean {
    if (lookup.twoSided[lookup.triSurface[tri]]) return true;
    const at = tri * 3;
    return lookup.triNormal[at] * dx + lookup.triNormal[at + 1] * dy
         + lookup.triNormal[at + 2] * dz < 0;
}

/** A well-mixed 32-bit hash, so which rays a cutout lets by is fixed per input. */
function mix32(x: number): number {
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
}

/**
 * The first triangle along a ray that stops it, or -1; `bvh.hitU/hitV` describe
 * it. A cutout stops a ray with the probability of its coverage, decided by a
 * hash of `seed` and not by chance: a bake that answers differently twice cannot
 * be told from one that answers wrongly once.
 */
export function firstHit(bvh: Bvh, lookup: HitLookup,
                         ox: number, oy: number, oz: number,
                         dx: number, dy: number, dz: number,
                         far: number, epsilon: number, seed: number, backReach = 0): number {
    let travelled = 0;
    for (let step = 0; step < 16; step++) {
        // Past a cutout the walk starts ON it, so it must look beyond its own plane.
        const tri = bvh.hit(ox, oy, oz, dx, dy, dz, far - travelled,
                            step === 0 ? epsilon : Math.max(epsilon, SHADOW_EPSILON));
        if (tri < 0) return -1;
        const near = travelled + bvh.hitDistance < backReach && !facesRay(lookup, tri, dx, dy, dz);
        const keep = lookup.coverage[lookup.triSurface[tri]];
        if (!near && (keep >= 1 || mix32(seed ^ Math.imul(step + 1, 0x9e3779b9)) / 4294967296 < keep)) {
            return tri;
        }
        const t = bvh.hitDistance;
        ox += dx * t; oy += dy * t; oz += dz * t;
        travelled += t;
    }
    return -1;
}

/** Whether anything stops the segment, honouring cutouts the way {@link firstHit} does. */
function blocked(bvh: Bvh, lookup: HitLookup, ox: number, oy: number, oz: number,
                 dx: number, dy: number, dz: number, far: number, seed: number): boolean {
    if (!lookup.cutouts && !(lookup.backReach > 0)) {
        return bvh.occluded(ox, oy, oz, dx, dy, dz, far, SHADOW_EPSILON);
    }
    return firstHit(bvh, lookup, ox, oy, oz, dx, dy, dz, far, SHADOW_EPSILON, seed, lookup.backReach) >= 0;
}

export const SHADOW_EPSILON = 1e-3;

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
 * bake is read, so one atlas serves a mesh whose texture changes. The sky is not
 * here: it reaches a lumel past whatever stands in the way, so it is gathered.
 */
export function solveDirect(lumels: LumelField, bvh: Bvh, lookup: HitLookup,
                            lights: readonly BakeLight[], out: Float32Array,
                            from = 0, to = lumels.count): void {
    for (let i = from; i < to; i++) {
        const px = lumels.position[i * 3], py = lumels.position[i * 3 + 1], pz = lumels.position[i * 3 + 2];
        const nx = lumels.normal[i * 3], ny = lumels.normal[i * 3 + 1], nz = lumels.normal[i * 3 + 2];
        let r = 0, g = 0, b = 0;
        for (let li = 0; li < lights.length; li++) {
            const light = lights[li];
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
            if (blocked(bvh, lookup, px + nx * SHADOW_EPSILON, py + ny * SHADOW_EPSILON,
                        pz + nz * SHADOW_EPSILON, lx, ly, lz, far, Math.imul(i, 31) ^ li)) continue;
            const w = lambert * falloff * light.intensity;
            r += light.color[0] * w; g += light.color[1] * w; b += light.color[2] * w;
        }
        out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
    }
}

/**
 * What reaches each lumel indirectly: the sky where a ray escapes, what the surface
 * it meets gives off where one does not. `atlas` is that off each texel, before its
 * albedo, as the pass before left it. Overwrites `out`.
 */
export function solveGather(lumels: LumelField, bvh: Bvh, lookup: HitLookup,
                            atlas: Float32Array, atlasSize: number, samples: number,
                            sky: SkyRadiance, out: Float32Array, from = 0, to = lumels.count): void {
    const dirs = hemisphere(samples);
    const basis = new Float32Array(6);
    const seen = new Float32Array(3);
    const far = 1e7;
    for (let i = from; i < to; i++) {
        const px = lumels.position[i * 3], py = lumels.position[i * 3 + 1], pz = lumels.position[i * 3 + 2];
        const nx = lumels.normal[i * 3], ny = lumels.normal[i * 3 + 1], nz = lumels.normal[i * 3 + 2];
        frame(nx, ny, nz, basis);
        let r = 0, g = 0, b = 0;
        for (let s = 0; s < samples; s++) {
            const a = dirs[s * 3], c = dirs[s * 3 + 1], d = dirs[s * 3 + 2];
            const dx = basis[0] * a + basis[3] * c + nx * d;
            const dy = basis[1] * a + basis[4] * c + ny * d;
            const dz = basis[2] * a + basis[5] * c + nz * d;
            const tri = firstHit(bvh, lookup, px + nx * SHADOW_EPSILON, py + ny * SHADOW_EPSILON,
                                 pz + nz * SHADOW_EPSILON, dx, dy, dz, far, SHADOW_EPSILON,
                                 Math.imul(i, samples) + s, lookup.backReach);
            if (tri < 0) {
                sky(dx, dy, dz, seen, 0);
                r += seen[0]; g += seen[1]; b += seen[2];
                continue;
            }
            if (!facesRay(lookup, tri, dx, dy, dz)) continue;
            const texel = texelOf(lookup, tri, bvh.hitU, bvh.hitV, atlasSize);
            if (texel < 0) continue;
            const surface = lookup.triSurface[tri];
            r += atlas[texel * 3] * lookup.albedo[surface * 3];
            g += atlas[texel * 3 + 1] * lookup.albedo[surface * 3 + 1];
            b += atlas[texel * 3 + 2] * lookup.albedo[surface * 3 + 2];
        }
        // Cosine-weighted sampling already carries the projected-area term, so
        // the estimator is the plain mean of what came back.
        out[i * 3] = r / samples;
        out[i * 3 + 1] = g / samples;
        out[i * 3 + 2] = b / samples;
    }
}

/**
 * What the GEOMETRY along a ray gives off, written into @p out at @p at.
 *
 * @returns false where the ray met nothing: the sky is the caller's to write,
 *          and the two hold different ones — a probe gathers a flat ambient, a
 *          capture points the same ray at the environment. What a SURFACE gives
 *          off is one answer, and the two halves of a bake must not differ on it.
 */
export function rayRadiance(bvh: Bvh, lookup: HitLookup, atlas: Float32Array, atlasSize: number,
                            fromX: number, fromY: number, fromZ: number,
                            dx: number, dy: number, dz: number,
                            out: Float32Array, at = 0, seed = 0): boolean {
    const tri = firstHit(bvh, lookup, fromX, fromY, fromZ, dx, dy, dz, 1e7, 0, seed);
    if (tri < 0) return false;
    // Geometry with no place in the atlas is black rather than sky: something is
    // there, and it is unlit.
    out[at] = 0; out[at + 1] = 0; out[at + 2] = 0;
    if (!facesRay(lookup, tri, dx, dy, dz)) return true;
    const texel = texelOf(lookup, tri, bvh.hitU, bvh.hitV, atlasSize);
    if (texel < 0) return true;
    const surface = lookup.triSurface[tri]!;
    out[at] = atlas[texel * 3]! * lookup.albedo[surface * 3]!;
    out[at + 1] = atlas[texel * 3 + 1]! * lookup.albedo[surface * 3 + 1]!;
    out[at + 2] = atlas[texel * 3 + 2]! * lookup.albedo[surface * 3 + 2]!;
    return true;
}

/** Where on the atlas a hit lands, or -1 when it falls outside it. */
export function texelOf(lookup: HitLookup, tri: number, u: number, v: number, size: number): number {
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
