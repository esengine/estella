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
 *            sdf     dim^3 floats, toroidal like GlobalSdf's level
 *            instance (20 vec4 = 80 floats) 0-3 local to world (column major) | 4-6 world to local rows, w the translation, scale divided out |
 *                    7 world box min, w scale | 8 world box max, w card pixel size | 9 local box min, w emission scale | 10 local box max |
 *                    11-16 the six faces (width, height, first pixel) | 17-19 spare
 *            pixel   (4 words) 0: depth16 | normal x i8 << 16 | normal y i8 << 24; 1: normal z i8 | albedo rgb << 8; 2: emission rgb; 3: instance << 3 | face
 *
 *          The CPU twins (globalSdf.ts, surfaceCache.ts, screenProbes.ts) are checked against Cycles; the kernels are the same arithmetic.
 */
import { GlobalSdf, type SdfInstance } from './globalSdf';
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

export const GI_HEADER_FLOATS = 24;
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

/** Composes the instances into one distance field window and lays everything out for the engine. */
export function packGPUScene(instances: readonly GIInstance[], light: GILight | null, options: { dim?: number; sky?: readonly [number, number, number]; bias?: number } = {}): GPUScene | null {
    if (instances.length === 0) return null;
    const dim = options.dim ?? 128;
    // The window covers the instances' boxes: the cell is the smallest power-free size that fits them, with the border a trace needs.
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
    const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
    const cell = (extent * 1.15) / (dim - 4);
    const sdf = new GlobalSdf([{ dim, cell }]);
    sdf.setCenter([(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2]);
    instances.forEach((inst, id) => { const s: SdfInstance = { id, sdf: inst.sdf, worldFromLocal: inst.worldFromLocal }; sdf.update(s); });
    const level = sdf.levels[0]!;

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

    const bias = options.bias ?? Math.max(cell * 1.6, 0.5);
    const set = (i: number, ...v: number[]) => { v.forEach((x, k) => { header[i + k] = x; }); };
    set(0, dim, cell, level.origin[0]!, level.origin[1]!, level.origin[2]!, cell * GlobalSdf.REACH_CELLS, instances.length, pixelTotal);
    set(8, ...(light?.toLight ?? [0, 1, 0]), light ? 1 : 0, ...(light?.radiance ?? [0, 0, 0]), bias, extent * 2.5, cell * 3);
    set(18, ...(options.sky ?? [0, 0, 0]), 0.25);
    return { header, sdf: level.data, instances: instanceData, pixels };
}
