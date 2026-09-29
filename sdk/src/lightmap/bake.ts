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
import {
    layoutAtlas, rasterizeLumels, atlasDemand, SPARSE_LIGHTMAP_UV, type BakeSurface, type SurfacePatch,
} from './atlas';
import { solveDirect, solveGather, type BakeLight, type HitLookup } from './solve';
import { skyRadiance, type SkySpec } from './sky';
import type { LumelField } from './atlas';
import { solveProbes, type ProbeGrid } from './probes';
import { captureReflection, flatSky, type CapturedPanorama, type SkyRadiance }
    from './reflection';

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
    /** The sky's radiance where no {@link sky} is given: the same from every
     *  direction, and still only reaching what can see it. */
    ambient?: readonly [number, number, number];
    /** What a lumel or a probe receives along a ray that escapes the scene — the
     *  environment as the frame lights by it, tint and turn included. A bake split
     *  across threads needs it as data. */
    sky?: SkySpec | SkyRadiance;
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
    /** Where reflections are captured from — a panorama each, solved in the same
     *  light field the probes are. The specular half of the same question. */
    reflectionProbes?: readonly (readonly [number, number, number])[];
    /** Width of a captured panorama; its height is half. Small on purpose: what
     *  a rough surface reflects is a blur, and the prefilter below widens the
     *  lobe anyway. */
    reflectionWidth?: number;
    /** What a captured ray brings back when it escapes the scene. The environment
     *  where the caller could sample one, the flat ambient where it could not. */
    reflectionSky?: SkyRadiance;
}

export interface BakeResult {
    /** `atlasSize * atlasSize * 4` bytes a `.png` is written from; see
     *  {@link encodeLightmap}. */
    pixels: Uint8Array;
    size: number;
    /** What each surface's `MeshLightmap.scaleOffset` must be set to, in order. */
    scaleOffset: Array<[number, number, number, number]>;
    /** Texels the surfaces actually cover, out of the atlas. */
    lumels: number;
    /** Per surface: the share of its texels its own lightmap UVs laid twice. */
    shared: Float32Array;
    /** Nine RGB coefficients per probe, one array per requested grid, in grid
     *  order with x varying fastest — what a `.esprobes` carries. */
    probes: Float32Array[];
    /** One captured sphere per {@link BakeOptions.reflectionProbes}, in the order
     *  they were given, for the caller to prefilter into an atlas column. */
    reflections: CapturedPanorama[];
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
    reflectionProbes: [] as readonly (readonly [number, number, number])[],
    reflectionWidth: 64,
};

const chan = (m: MeshData, s: number): MeshChannelDesc | undefined =>
    m.channels.find((c) => c.semantic === s);

/** Every surface's triangles in world space, plus what a ray hit has to know. */
function collect(surfaces: readonly BakeSurface[], patches: readonly SurfacePatch[],
                 size: number, texelsPerUnit: number): { soup: TriangleSoup; lookup: HitLookup } {
    let total = 0;
    for (const s of surfaces) total += Math.floor(s.mesh.indices.length / 3);
    const positions = new Float32Array(total * 9);
    const triUV = new Float32Array(total * 6);
    const triSurface = new Int32Array(total);
    const patch = new Float32Array(surfaces.length * 4);
    const albedo = new Float32Array(surfaces.length * 3);
    const triNormal = new Float32Array(total * 3);
    const twoSided = new Uint8Array(surfaces.length);
    const coverage = new Float32Array(surfaces.length);

    let at = 0;
    for (let s = 0; s < surfaces.length; s++) {
        const mesh = surfaces[s].mesh;
        const m = surfaces[s].transform;
        const a = surfaces[s].albedo ?? [0.5, 0.5, 0.5];
        albedo.set(a, s * 3);
        twoSided[s] = surfaces[s].twoSided ? 1 : 0;
        coverage[s] = Math.min(1, Math.max(0, surfaces[s].coverage ?? 1));
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
    return { soup: { positions, count: total },
             lookup: { triUV, triSurface, patch, albedo, triNormal, twoSided, coverage,
                       cutouts: coverage.some((c) => c < 1),
                       backReach: texelsPerUnit > 0 ? 0.5 / texelsPerUnit : 0 } };
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
 * The most an atlas texel holds, in units of a flat ambient of one. Stored as the
 * square root of its fraction, alpha opaque: eight plain bits stop at one, and a
 * scale in alpha does not survive a premultiplying decoder. `bakedIrradiance` reads it.
 */
export const LIGHTMAP_RANGE = 8;

/** Irradiance to atlas bytes: `sqrt(v / LIGHTMAP_RANGE)` per channel, alpha 255. */
export function encodeLightmap(rgb: Float32Array, count: number): Uint8Array {
    const out = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            const v = Math.min(1, Math.max(0, rgb[i * 3 + k] / LIGHTMAP_RANGE));
            out[i * 4 + k] = Math.round(Math.sqrt(v) * 255);
        }
        out[i * 4 + 3] = 255;
    }
    return out;
}

/**
 * The atlas as an image file holds it: texel row `y` (second UV `v` = y / size) in
 * image row `size - 1 - y`. The engine uploads a picture bottom-up, so a UV of 0
 * reads the image's LAST row; written top-down, every lookup lands on its mirror.
 */
export function lightmapImage(pixels: Uint8Array, size: number): Uint8Array {
    const out = new Uint8Array(pixels.length);
    const row = size * 4;
    for (let y = 0; y < size; y++) out.set(pixels.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
    return out;
}

/** What {@link encodeLightmap} wrote at texel `i`. */
export function decodeLightmap(pixels: ArrayLike<number>, i: number): [number, number, number] {
    const d = (b: number): number => (b / 255) * (b / 255) * LIGHTMAP_RANGE;
    return [d(pixels[i * 4]), d(pixels[i * 4 + 1]), d(pixels[i * 4 + 2])];
}

/**
 * Why the surfaces do not fit, naming the ones that take the most room: a
 * second UV set that leaves most of its square empty cannot be fixed by a
 * bigger atlas, only by unwrapping the mesh.
 */
function refusal(surfaces: readonly BakeSurface[], size: number, texelsPerUnit: number): string {
    const demand = atlasDemand(surfaces, size, texelsPerUnit)
        .map((d, i) => ({ ...d, name: surfaces[i]?.label ?? `surface ${i}` }))
        .sort((a, b) => b.side - a.side)
        .slice(0, 3);
    const named = demand.map((d) => `${d.name} (${d.side}x${d.side}, its lightmap UVs cover`
        + ` ${(d.uvCoverage * 100).toFixed(1)}%)`).join(', ');
    const sparse = demand.some((d) => d.uvCoverage < SPARSE_LIGHTMAP_UV)
        ? '; one whose lightmap UVs cover little of their square wastes the rest, which'
          + ' Generate Lightmap UVs on its model unwraps away'
        : '';
    return `bakeLightmap: ${surfaces.length} surface(s) do not fit a ${size}px atlas at`
        + ` ${texelsPerUnit} texels per unit — raise the atlas or lower the density.`
        + ` The largest: ${named}${sparse}`;
}

/** Everything a solve step reads, as arrays another thread can be handed. */
export interface BakeScene {
    lumels: LumelField;
    tris: TriangleSoup;
    lookup: HitLookup;
    lights: readonly BakeLight[];
    sky: SkySpec | SkyRadiance;
    atlasSize: number;
    samples: number;
}

/** One pass over every lumel. Each writes only its own lumels' entries of `out`,
 *  so any split of the range gives the same result. */
export type BakeJob =
    | { kind: 'direct'; out: Float32Array }
    | { kind: 'gather'; atlas: Float32Array; out: Float32Array };

export interface BakeStep {
    scene: BakeScene;
    job: BakeJob;
}

/** Runs jobs against one scene over any range of its lumels; one per thread. */
export function bakeRunner(scene: BakeScene): (job: BakeJob, from: number, to: number) => void {
    const bvh = new Bvh(scene.tris);
    const sky = typeof scene.sky === 'function' ? scene.sky : skyRadiance(scene.sky);
    return (job, from, to) => {
        if (job.kind === 'direct') solveDirect(scene.lumels, bvh, scene.lookup, scene.lights, job.out, from, to);
        else solveGather(scene.lumels, bvh, scene.lookup, job.atlas, scene.atlasSize, scene.samples, sky, job.out, from, to);
    };
}

/**
 * A bake as its passes, in order: the driver runs each yielded job over every
 * lumel, on one thread or many, before asking for the next. Throws when the surfaces do not fit rather than shrinking
 * one, which would light it at a different resolution from its neighbours.
 */
export function* bakeLightmapSteps(surfaces: readonly BakeSurface[], lights: readonly BakeLight[],
                                   options: BakeOptions = {}): Generator<BakeStep, BakeResult, void> {
    const opts = { ...BAKE_DEFAULTS, ...options };
    const size = opts.atlasSize;
    const patches = layoutAtlas(surfaces, size, opts.texelsPerUnit);
    if (!patches) throw new Error(refusal(surfaces, size, opts.texelsPerUnit));
    const lumels = rasterizeLumels(surfaces, patches, size);
    const { soup, lookup } = collect(surfaces, patches, size, opts.texelsPerUnit);
    const skyOf = options.sky ?? { kind: 'flat', rgb: opts.ambient };
    const scene: BakeScene = { lumels, tris: soup, lookup, lights, sky: skyOf,
                               atlasSize: size, samples: opts.samples };
    const sky = typeof skyOf === 'function' ? skyOf : skyRadiance(skyOf);

    const direct = new Float32Array(lumels.count * 3);
    yield { scene, job: { kind: 'direct', out: direct } };

    // Each pass gathers against what every texel gave off after the pass before,
    // so pass n carries light n surfaces along. With no bounce the surfaces give
    // off nothing and the pass is the sky alone, still shadowed by them.
    const outgoing = new Float32Array(size * size * 3);
    const indirect = new Float32Array(lumels.count * 3);
    for (let pass = 0; pass < Math.max(1, opts.bounces); pass++) {
        if (opts.bounces > 0) {
            for (let i = 0; i < lumels.count; i++) {
                const at = lumels.texel[i] * 3;
                for (let k = 0; k < 3; k++) outgoing[at + k] = direct[i * 3 + k] + indirect[i * 3 + k];
            }
        }
        yield { scene, job: { kind: 'gather', atlas: outgoing, out: indirect } };
    }

    // Two fields: what each texel gives off, which probes and captures read, and
    // what its surface is to add — less the lamps where the draw adds them itself.
    const radiance = new Float32Array(size * size * 3);
    const stored = new Float32Array(size * size * 3);
    const solved = new Uint8Array(size * size);
    for (let i = 0; i < lumels.count; i++) {
        const at = lumels.texel[i] * 3;
        const lampsLive = surfaces[lumels.surface[i]]?.realtimeDirect === true;
        for (let k = 0; k < 3; k++) {
            radiance[at + k] = direct[i * 3 + k] + indirect[i * 3 + k];
            stored[at + k] = (lampsLive ? 0 : direct[i * 3 + k]) + indirect[i * 3 + k];
        }
        solved[lumels.texel[i]] = 1;
    }
    const solvedStored = solved.slice();
    dilate(radiance, solved, size, opts.dilate);
    dilate(stored, solvedStored, size, opts.dilate);
    const pixels = encodeLightmap(stored, size * size);

    // The probes read the atlas as a gather does — after it holds everything the
    // surfaces ended up giving off, and before it is quantised to eight bits.
    let built: Bvh | null = null;
    const bvh = (): Bvh => (built ??= new Bvh(soup));
    const probes = opts.probeGrids.map((grid) =>
        solveProbes(grid, bvh(), lookup, radiance, size, opts.probeSamples, sky));

    // Captured from the same field, after the same bounces: a reflection of a
    // wall and the light that wall casts are then the same number.
    const width = Math.max(8, opts.reflectionWidth);
    const captured = options.reflectionSky ?? flatSky(opts.ambient);
    const reflections = opts.reflectionProbes.map((at) =>
        captureReflection(at, bvh(), lookup, radiance, size, width, Math.max(4, width >> 1), captured));

    return {
        pixels,
        size,
        scaleOffset: patches.map((p) => p.scaleOffset),
        lumels: lumels.count,
        shared: lumels.shared,
        probes,
        reflections,
    };
}

/** {@link bakeLightmapSteps} driven on this thread. */
export function bakeLightmap(surfaces: readonly BakeSurface[], lights: readonly BakeLight[],
                             options: BakeOptions = {}): BakeResult {
    const steps = bakeLightmapSteps(surfaces, lights, options);
    let runner: ReturnType<typeof bakeRunner> | null = null;
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
        runner ??= bakeRunner(next.value.scene);
        runner(next.value.job, 0, next.value.scene.lumels.count);
    }
}
