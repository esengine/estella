// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bake.ts
 * @brief   Surfaces and lights in, an atlas out — the whole bake, in one place.
 *
 * Lay out, rasterise, solve direct, bounce, dilate, encode. Each stage is its
 * own file and testable on its own; this is the order they go in, and the one
 * place a caller's units are turned into the texels every stage works in.
 */

import { MeshChannel, MeshChannelType, type MeshData, type MeshChannelDesc } from '../asset/meshFormat';
import { Bvh, type TriangleSoup } from './bvh';
import { layoutAtlas, rasterizeLumels, type BakeSurface, type SurfacePatch } from './atlas';
import { solveDirect, solveBounce, type BakeLight, type HitLookup } from './solve';
import { solveProbes, type ProbeGrid } from './probes';

export interface BakeOptions {
    /** Side of the square atlas, in texels. */
    atlasSize?: number;
    /** How finely a surface is lit, in texels per world unit. A world unit here
     *  is a DESIGN PIXEL, so a room is hundreds of units across and a lumel every
     *  few of them is already fine — a density borrowed from an engine whose unit
     *  is a metre would ask for an atlas no scene could fit. */
    texelsPerUnit?: number;
    /** How many times light is allowed to reflect. Zero is direct light only —
     *  useful, because past the sixteen a frame can carry it is still the answer. */
    bounces?: number;
    /** Rays each lumel gathers per bounce. */
    samples?: number;
    /** Light every surface receives from no direction in particular. */
    ambient?: readonly [number, number, number];
    /** Texels the solved edges are smeared outwards, so a bilinear tap near a
     *  chart's border does not read the empty atlas beside it. */
    dilate?: number;
    /** Grids of probes to solve in the same light field — what lights the things
     *  a bake cannot hold still. Solved after the surfaces, because a probe
     *  gathers what they ended up giving off. */
    probeGrids?: readonly ProbeGrid[];
    /** Directions each probe gathers. Over the whole sphere, so this buys less
     *  per ray than a lumel's hemisphere does. */
    probeSamples?: number;
}

export interface BakeResult {
    /** RGBA8, `atlasSize * atlasSize * 4` — what a `.png` is written from. */
    pixels: Uint8Array;
    size: number;
    /** What each surface's `MeshLightmap.scaleOffset` must be set to, in order. */
    scaleOffset: Array<[number, number, number, number]>;
    /** Texels the surfaces actually cover, out of the atlas. */
    lumels: number;
    /** Nine RGB coefficients per probe, one array per requested grid, in grid
     *  order with x varying fastest — what a `.esprobes` carries. */
    probes: Float32Array[];
}

/** What a bake does where the caller says nothing — and what a scene's own
 *  `BakedLighting` starts at, so the two cannot drift apart. */
export const BAKE_DEFAULTS = {
    atlasSize: 1024,
    texelsPerUnit: 0.25,
    bounces: 2,
    samples: 64,
    ambient: [0, 0, 0] as readonly [number, number, number],
    dilate: 2,
    probeGrids: [] as readonly ProbeGrid[],
    probeSamples: 128,
};

const chan = (m: MeshData, s: number): MeshChannelDesc | undefined =>
    m.channels.find((c) => c.semantic === s);

/** Every surface's triangles in world space, plus what a ray hit has to know. */
function collect(surfaces: readonly BakeSurface[], patches: readonly SurfacePatch[],
                 size: number): { soup: TriangleSoup; lookup: HitLookup } {
    let total = 0;
    for (const s of surfaces) total += Math.floor(s.mesh.indices.length / 3);
    const positions = new Float32Array(total * 9);
    const triUV = new Float32Array(total * 6);
    const triSurface = new Int32Array(total);
    const patch = new Float32Array(surfaces.length * 4);
    const albedo = new Float32Array(surfaces.length * 3);
    const triNormal = new Float32Array(total * 3);

    let at = 0;
    for (let s = 0; s < surfaces.length; s++) {
        const mesh = surfaces[s].mesh;
        const m = surfaces[s].transform;
        const a = surfaces[s].albedo ?? [0.5, 0.5, 0.5];
        albedo.set(a, s * 3);
        patch[s * 4] = patches[s].x;
        patch[s * 4 + 1] = patches[s].y;
        patch[s * 4 + 2] = patches[s].side;
        patch[s * 4 + 3] = patches[s].rotated ? 1 : 0;

        const pos = chan(mesh, MeshChannel.Position);
        const uv1 = chan(mesh, MeshChannel.TexCoord1);
        const nrm = chan(mesh, MeshChannel.Normal);
        const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
        const idx = mesh.indices;
        for (let i = 0; i + 2 < idx.length; i += 3, at++) {
            triSurface[at] = s;
            for (let k = 0; k < 3; k++) {
                const v = idx[i + k];
                if (pos && pos.type === MeshChannelType.Float32) {
                    const b = v * mesh.vertexStride + pos.offset;
                    const x = view.getFloat32(b, true);
                    const y = view.getFloat32(b + 4, true);
                    const z = pos.components >= 3 ? view.getFloat32(b + 8, true) : 0;
                    positions[at * 9 + k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
                    positions[at * 9 + k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
                    positions[at * 9 + k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
                }
                if (uv1 && uv1.type === MeshChannelType.Float32) {
                    const b = v * mesh.vertexStride + uv1.offset;
                    triUV[at * 6 + k * 2] = view.getFloat32(b, true);
                    triUV[at * 6 + k * 2 + 1] = view.getFloat32(b + 4, true);
                }
                if (nrm && nrm.type === MeshChannelType.Float32) {
                    const b = v * mesh.vertexStride + nrm.offset;
                    const x = view.getFloat32(b, true);
                    const y = view.getFloat32(b + 4, true);
                    const z = view.getFloat32(b + 8, true);
                    // The transform's rotation, which is its upper 3x3 — a
                    // non-uniform scale would want the inverse transpose, and
                    // only the SIGN of this is read.
                    triNormal[at * 3] += m[0] * x + m[4] * y + m[8] * z;
                    triNormal[at * 3 + 1] += m[1] * x + m[5] * y + m[9] * z;
                    triNormal[at * 3 + 2] += m[2] * x + m[6] * y + m[10] * z;
                }
            }
        }
    }
    // Geometry with no declared normal gets the winding's: something has to say
    // which side is lit, and a zero vector would call every arrival a back.
    for (let t = 0; t < total; t++) {
        const at = t * 3;
        if (triNormal[at] !== 0 || triNormal[at + 1] !== 0 || triNormal[at + 2] !== 0) continue;
        const p = t * 9;
        const e1 = [positions[p + 3] - positions[p], positions[p + 4] - positions[p + 1],
                    positions[p + 5] - positions[p + 2]];
        const e2 = [positions[p + 6] - positions[p], positions[p + 7] - positions[p + 1],
                    positions[p + 8] - positions[p + 2]];
        triNormal[at] = e1[1] * e2[2] - e1[2] * e2[1];
        triNormal[at + 1] = e1[2] * e2[0] - e1[0] * e2[2];
        triNormal[at + 2] = e1[0] * e2[1] - e1[1] * e2[0];
    }
    return { soup: { positions, count: total }, lookup: { triUV, triSurface, patch, albedo, triNormal } };
}

/** Smears solved texels outwards so a bilinear tap near an edge reads light
 *  rather than the gap beside it. The gaps are where charts do not meet. */
function dilate(radiance: Float32Array, solved: Uint8Array, size: number, rounds: number): void {
    for (let round = 0; round < rounds; round++) {
        const filled = solved.slice();
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const at = y * size + x;
                if (solved[at]) continue;
                let r = 0, g = 0, b = 0, n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
                        const near = ny * size + nx;
                        if (!solved[near]) continue;
                        r += radiance[near * 3]; g += radiance[near * 3 + 1]; b += radiance[near * 3 + 2];
                        n++;
                    }
                }
                if (n === 0) continue;
                radiance[at * 3] = r / n; radiance[at * 3 + 1] = g / n; radiance[at * 3 + 2] = b / n;
                filled[at] = 1;
            }
        }
        solved.set(filled);
    }
}

/**
 * Bakes `lights` into an atlas the surfaces can be read through.
 *
 * Throws when the surfaces do not fit: a bake that quietly shrank someone would
 * light one wall at a different resolution from the next, and the caller is the
 * one who can decide between a bigger atlas and a coarser density.
 */
export function bakeLightmap(surfaces: readonly BakeSurface[], lights: readonly BakeLight[],
                             options: BakeOptions = {}): BakeResult {
    const opts = { ...BAKE_DEFAULTS, ...options };
    const size = opts.atlasSize;
    const patches = layoutAtlas(surfaces, size, opts.texelsPerUnit);
    if (!patches) {
        throw new Error(`bakeLightmap: ${surfaces.length} surface(s) do not fit a ${size}px atlas at`
            + ` ${opts.texelsPerUnit} texels per unit — raise the atlas or lower the density`);
    }
    const lumels = rasterizeLumels(surfaces, patches, size);
    const { soup, lookup } = collect(surfaces, patches, size);
    const bvh = new Bvh(soup);

    const direct = new Float32Array(lumels.count * 3);
    solveDirect(lumels, bvh, lights, opts.ambient, direct);

    // The atlas as each pass leaves it, so the next reads what the last wrote —
    // which is what carries light one more surface along.
    const radiance = new Float32Array(size * size * 3);
    const solved = new Uint8Array(size * size);
    const total = new Float32Array(lumels.count * 3);
    total.set(direct);
    let emitted = direct;
    for (let bounce = 0; bounce < opts.bounces; bounce++) {
        radiance.fill(0);
        for (let i = 0; i < lumels.count; i++) {
            const at = lumels.texel[i] * 3;
            radiance[at] = emitted[i * 3];
            radiance[at + 1] = emitted[i * 3 + 1];
            radiance[at + 2] = emitted[i * 3 + 2];
        }
        const gathered = new Float32Array(lumels.count * 3);
        solveBounce(lumels, bvh, lookup, radiance, size, opts.samples, gathered);
        for (let i = 0; i < gathered.length; i++) total[i] += gathered[i];
        emitted = gathered;
    }

    radiance.fill(0);
    solved.fill(0);
    for (let i = 0; i < lumels.count; i++) {
        const at = lumels.texel[i] * 3;
        radiance[at] = total[i * 3];
        radiance[at + 1] = total[i * 3 + 1];
        radiance[at + 2] = total[i * 3 + 2];
        solved[lumels.texel[i]] = 1;
    }
    dilate(radiance, solved, size, opts.dilate);

    const pixels = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        for (let k = 0; k < 3; k++) {
            pixels[i * 4 + k] = Math.max(0, Math.min(255, Math.round(radiance[i * 3 + k] * 255)));
        }
        pixels[i * 4 + 3] = 255;
    }

    // The probes read the atlas as a bounce does — after it holds everything the
    // surfaces ended up giving off, and before it is quantised to eight bits.
    const probes = opts.probeGrids.map((grid) =>
        solveProbes(grid, bvh, lookup, radiance, size, opts.probeSamples, opts.ambient));

    return {
        pixels,
        size,
        scaleOffset: patches.map((p) => p.scaleOffset),
        lumels: lumels.count,
        probes,
    };
}
