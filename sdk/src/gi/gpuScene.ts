// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    gpuScene.ts
 * @brief   The scene as the dynamic GI's compute passes read it: the arrays handed to `postprocess_setGIScene` (src/esengine/renderer/frame/DynamicGI.hpp).
 *
 * @details Layouts (all little-endian numbers, the engine copies them as they are):
 *
 *            header  (floats) dim, cell, origin x y z (cells), reach, instances, card pixels, sun toLight x y z, sun on, sun radiance r g b,
 *                    ray bias, ray range, card tolerance, sky r g b, hit fraction
 *            sdf     dim^3 floats, toroidal like GlobalSdf's level, then dim^3 / 4 words holding the id (+ 1) of the instance nearest each cell
 *            instance (20 vec4 = 80 floats) 0-3 local to world (column major) | 4-6 world to local rows, w the translation, scale divided out |
 *                    7 world box min, w scale | 8 world box max, w card pixel size | 9 local box min, w emission scale | 10 local box max |
 *                    11-16 the six faces (width, height, first pixel) | 17-19 spare
 *            pixel   (4 words) 0: depth16 | normal x i8 << 16 | normal y i8 << 24; 1: normal z i8 | albedo rgb << 8; 2: emission rgb; 3: instance << 3 | face
 *
 *          The CPU twins (globalSdf.ts, surfaceCache.ts, screenProbes.ts) are checked against Cycles; the kernels are the same arithmetic.
 */
import { GlobalSdf, type SdfInstance } from './globalSdf';
import type { PointLight } from './surfaceCache';
import { CARD_AXES, NO_DEPTH, type MeshCards } from './cardFormat';
import type { MeshSdf } from './meshSdfFormat';

export interface GIInstance {
    sdf: MeshSdf;
    cards: MeshCards;
    /** Column-major 4x4, local to world: rotation, translation and one uniform scale. */
    worldFromLocal: ArrayLike<number>;
}

export interface GILight {
    /** Unit vector toward the sun. */
    toLight: readonly [number, number, number];
    radiance: readonly [number, number, number];
}

export interface GPUScene {
    header: Float32Array;
    sdf: Float32Array;
    instances: Float32Array;
    pixels: Uint32Array;
}

/** Header floats: 0-21 the first level and the scene (see the layout above), 22 levels, 23 lights, 24-39 the second and third level, 40- the lights. */
export const GI_MAX_LEVELS = 3;
export const GI_MAX_LIGHTS = 8;
export const GI_LIGHT_FLOATS = 16;
/** The header ends with one float past the lights: the growth of the fattest instance's field (see `clearOrigin` in DynamicGI.cpp). */
export const GI_HEADER_FLOATS = 40 + GI_MAX_LIGHTS * GI_LIGHT_FLOATS + 1;
export const GI_INSTANCE_FLOATS = 80;

/** A box of the given size centred on the origin, as a distance field and as cards, without any mesh: what a primitive is to the GI. */
export function analyticBox(size: readonly [number, number, number], colour: readonly [number, number, number], cell: number, cardCell: number, maxResolution = 24, emissive: readonly [number, number, number] = [0, 0, 0]): GIInstance['sdf'] & { cards: MeshCards } {
    const h = size.map((s) => s / 2);
    const inflate = 0.5 * cell, pad = 2;
    const dims = size.map((s) => Math.max(Math.ceil(s / cell), 1) + 2 * pad) as [number, number, number];
    const origin = h.map((v) => -v - pad * cell) as [number, number, number];
    const distance = new Float32Array(dims[0] * dims[1] * dims[2]);
    for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
        const q = [origin[0] + (x + 0.5) * cell, origin[1] + (y + 0.5) * cell, origin[2] + (z + 0.5) * cell].map((v, k) => Math.abs(v) - h[k]!);
        const d = Math.hypot(Math.max(q[0]!, 0), Math.max(q[1]!, 0), Math.max(q[2]!, 0)) + Math.min(Math.max(q[0]!, q[1]!, q[2]!), 0);
        distance[x + y * dims[0] + z * dims[0] * dims[1]] = d - inflate;
    }
    const cards: MeshCards = { aabbMin: h.map((v) => -v) as [number, number, number], aabbMax: h as [number, number, number], cell: cardCell, emissiveScale: Math.max(emissive[0], emissive[1], emissive[2], 1e-6), cards: [] };
    const cap = Math.max(...size) / maxResolution, px = Math.max(cardCell, cap);
    for (const { axis, sign, u, v } of CARD_AXES) {
        const width = Math.max(1, Math.min(maxResolution, Math.ceil(size[u]! / px))), height = Math.max(1, Math.min(maxResolution, Math.ceil(size[v]! / px)));
        const n = width * height, normal = new Int8Array(n * 3), albedo = new Uint8Array(n * 3), emit = new Uint8Array(n * 3);
        for (let i = 0; i < n; i++) {
            normal[i * 3 + axis] = 127 * sign;
            for (let k = 0; k < 3; k++) {
                albedo[i * 3 + k] = Math.round(Math.min(Math.max(colour[k]!, 0), 1) * 255);
                emit[i * 3 + k] = Math.round(Math.min(Math.max(emissive[k]! / cards.emissiveScale, 0), 1) * 255);
            }
        }
        cards.cards.push({ width, height, depth: new Uint16Array(n), normal, albedo, emissive: emit });
    }
    return { dims, cell, origin, distance, inflate, cards };
}

const scaleOf = (m: ArrayLike<number>): number => Math.hypot(m[0]!, m[1]!, m[2]!);

/** What a pack of a field left behind: the packed array and the version of each level it holds (see `Level.version`). */
const packCache = new WeakMap<GlobalSdf, { packed: Float32Array; versions: number[] }>();

export interface PackOptions {
    dim?: number;
    sky?: readonly [number, number, number];
    bias?: number;
    /** Point and spot lights, up to GI_MAX_LIGHTS. */
    lights?: readonly PointLight[];
    /**
     * A field to pack as it stands (levels that follow the camera, composed by the caller); without one the instances are composed into a
     * single window that holds them all.
     */
    sdf?: GlobalSdf;
}

/** The bounds of the instances' cards in the world. */
export function instanceBounds(instances: readonly GIInstance[]): { min: number[]; max: number[] } {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const inst of instances) {
        const m = inst.worldFromLocal, { aabbMin, aabbMax } = inst.cards;
        for (let c = 0; c < 8; c++) {
            const l = [c & 1 ? aabbMax[0] : aabbMin[0], c & 2 ? aabbMax[1] : aabbMin[1], c & 4 ? aabbMax[2] : aabbMin[2]];
            for (let k = 0; k < 3; k++) {
                const w = m[k]! * l[0]! + m[4 + k]! * l[1]! + m[8 + k]! * l[2]! + m[12 + k]!;
                min[k] = Math.min(min[k]!, w); max[k] = Math.max(max[k]!, w);
            }
        }
    }
    return { min, max };
}

/** Composes the instances into a distance field (one window that holds them all, or the caller's) and lays everything out for the engine. */
export function packGPUScene(instances: readonly GIInstance[], light: GILight | null, options: PackOptions = {}): GPUScene | null {
    if (instances.length === 0) return null;
    const dim = options.dim ?? 128;
    const { min, max } = instanceBounds(instances);
    const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
    let sdf = options.sdf;
    if (!sdf) {
        // The window covers the instances' boxes: the cell is the one that fits them, with the border a trace needs.
        const cell = (extent * 1.15) / (dim - 4);
        sdf = new GlobalSdf([{ dim, cell }]);
        sdf.setCenter([(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2]);
        instances.forEach((inst, id) => { const s: SdfInstance = { id, sdf: inst.sdf, worldFromLocal: inst.worldFromLocal }; sdf!.update(s); });
    }
    const levels = sdf.levels.slice(0, GI_MAX_LEVELS);
    const level = levels[0]!;
    const cell = level.cell;

    const pixelTotal = instances.reduce((a, inst) => a + inst.cards.cards.reduce((b, c) => b + c.width * c.height, 0), 0);
    const header = new Float32Array(GI_HEADER_FLOATS);
    const instanceData = new Float32Array(instances.length * GI_INSTANCE_FLOATS);
    const pixels = new Uint32Array(pixelTotal * 4);
    let pixel = 0;
    instances.forEach((inst, i) => {
        const m = inst.worldFromLocal, scale = scaleOf(m), b = i * GI_INSTANCE_FLOATS, { cards } = inst;
        for (let k = 0; k < 16; k++) instanceData[b + k] = m[k]!;
        // World to local = (R^T (p - t)) / scale, with R = the matrix's columns over the scale.
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) instanceData[b + 16 + row * 4 + col] = m[row * 4 + col]! / (scale * scale);
            instanceData[b + 16 + row * 4 + 3] = -(m[row * 4]! * m[12]! + m[row * 4 + 1]! * m[13]! + m[row * 4 + 2]! * m[14]!) / (scale * scale);
        }
        const wmin = [Infinity, Infinity, Infinity], wmax = [-Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 8; c++) {
            const l = [c & 1 ? cards.aabbMax[0] : cards.aabbMin[0], c & 2 ? cards.aabbMax[1] : cards.aabbMin[1], c & 4 ? cards.aabbMax[2] : cards.aabbMin[2]];
            for (let k = 0; k < 3; k++) {
                const w = m[k]! * l[0]! + m[4 + k]! * l[1]! + m[8 + k]! * l[2]! + m[12 + k]!;
                wmin[k] = Math.min(wmin[k]!, w); wmax[k] = Math.max(wmax[k]!, w);
            }
        }
        for (let k = 0; k < 3; k++) { instanceData[b + 28 + k] = wmin[k]!; instanceData[b + 32 + k] = wmax[k]!; instanceData[b + 36 + k] = cards.aabbMin[k]!; instanceData[b + 40 + k] = cards.aabbMax[k]!; }
        instanceData[b + 31] = scale;
        instanceData[b + 35] = cards.cell;
        instanceData[b + 39] = cards.emissiveScale;
        cards.cards.forEach((card, face) => {
            instanceData[b + 44 + face * 4] = card.width;
            instanceData[b + 44 + face * 4 + 1] = card.height;
            instanceData[b + 44 + face * 4 + 2] = pixel;
            for (let j = 0; j < card.width * card.height; j++, pixel++) {
                const o = pixel * 4, depth = card.depth[j]!;
                const nx = card.normal[j * 3]! & 255, ny = card.normal[j * 3 + 1]! & 255, nz = card.normal[j * 3 + 2]! & 255;
                pixels[o] = ((depth === NO_DEPTH ? 65535 : depth) | (nx << 16) | (ny << 24)) >>> 0;
                pixels[o + 1] = (nz | (card.albedo[j * 3]! << 8) | (card.albedo[j * 3 + 1]! << 16) | (card.albedo[j * 3 + 2]! << 24)) >>> 0;
                pixels[o + 2] = (card.emissive[j * 3]! | (card.emissive[j * 3 + 1]! << 8) | (card.emissive[j * 3 + 2]! << 16)) >>> 0;
                pixels[o + 3] = ((i << 3) | face) >>> 0;
            }
        });
    });

    // A ray starts off its surface by more than the instances' own fields are grown (a body is half a cell of ITS mesh fatter than it is), or it
    // starts inside the body it left; and a card is forgiven by about as much. This is the meshes' cell, not the clipmap's.
    const growth = Math.max(...instances.map((inst) => inst.sdf.inflate), 0);
    const bias = options.bias ?? Math.max(cell * 1.6, growth * 1.8, 0.5);
    const tolerance = Math.max(cell * 3, growth * 3.5);
    const set = (i: number, ...v: number[]) => { v.forEach((x, k) => { header[i + k] = x; }); };
    set(0, level.dim, cell, level.origin[0]!, level.origin[1]!, level.origin[2]!, cell * GlobalSdf.REACH_CELLS, instances.length, pixelTotal);
    set(8, ...(light?.toLight ?? [0, 1, 0]), light ? 1 : 0, ...(light?.radiance ?? [0, 0, 0]), bias, extent * 2.5, tolerance);
    set(18, ...(options.sky ?? [0, 0, 0]), 0.25);
    set(22, levels.length);
    set(GI_HEADER_FLOATS - 1, growth);
    // The field of every level, each followed by its owner words, level 0 first (so the header's offsets for it are 0 and dim^3). A level is
    // copied into the packed array only if it changed since the last pack of this field: a camera that moves rebuilds the finest level
    // nearly every step and the others once in a long while, and the copy is 10 MB a level.
    let floats = 0;
    for (const l of levels) floats += l.storage.length;
    let cache = packCache.get(sdf);
    if (!cache || cache.packed.length !== floats) { cache = { packed: new Float32Array(floats), versions: levels.map(() => -1) }; packCache.set(sdf, cache); }
    const packed = cache.packed;
    let at = 0;
    levels.forEach((l, k) => {
        const cells = l.data.length;
        if (cache!.versions[k] !== l.version) { packed.set(l.storage, at); cache!.versions[k] = l.version; }
        if (k > 0) set(24 + (k - 1) * 8, l.dim, l.cell, l.origin[0]!, l.origin[1]!, l.origin[2]!, l.cell * GlobalSdf.REACH_CELLS, at, at + cells);
        at += l.storage.length;
    });
    const lights = (options.lights ?? []).slice(0, GI_MAX_LIGHTS);
    set(23, lights.length);
    lights.forEach((l, i) => {
        const o = 40 + i * GI_LIGHT_FLOATS, aim = l.spot?.axis ?? [0, -1, 0];
        const len = Math.hypot(aim[0], aim[1], aim[2]) || 1;
        // fo.y of the frame's distanceFalloff: the ramp's power, or minus the world units to the metre for an inverse-square light.
        const fy = l.metre && l.metre > 0 ? -l.metre : (l.falloff ?? 1);
        set(o, l.position[0], l.position[1], l.position[2], l.reach, l.radiance[0], l.radiance[1], l.radiance[2], l.spot ? 2 : 0,
            aim[0] / len, aim[1] / len, aim[2] / len, fy, l.innerRadius ?? 0, l.spot?.innerCos ?? 1, l.spot?.outerCos ?? 0, 0);
    });
    return { header, sdf: packed, instances: instanceData, pixels };
}
