// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    source.ts
 * @brief   What a volume is before anyone digs in it: hills with caves through them, or any height field given a body.
 */
import type { VoxelSample, VoxelSource } from './field';

/** The material of each part of the stock ground. @experimental */
export const VoxelMaterial = { Topsoil: 0, Soil: 1, Rock: 2, Ore: 3 } as const;

function hash3(x: number, y: number, z: number, seed: number): number {
    let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ Math.imul(seed, 0x165667b1);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967295;
}

/** Smooth noise from -1 to 1 with features about a unit across. */
function noise3(x: number, y: number, z: number, seed: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    const at = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz, seed);
    return lerp(
        lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
        lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v), w) * 2 - 1;
}

/** @experimental */
export interface VoxelNoiseParams {
    seed: number;
    /** Where the ground lies on average, relative to the volume's entity. */
    surfaceHeight: number;
    /** How far the hills rise and fall from it, and how wide they are, in world units. */
    hillHeight: number;
    hillScale: number;
    /** How wide the tunnels are, in world units; 0 has none. */
    caveWidth: number;
    /** How far apart the tunnels are, in world units. */
    caveScale: number;
    /** How deep the soil goes before rock, in world units. */
    soilDepth: number;
    /** The share of the rock that is ore, 0 to 1. */
    oreAmount: number;
    /** The side of the volume's cells. The corners a vertex reads reach about two cells in, so topsoil thinner than that shows soil through in a pattern. Defaults to 1. */
    cellSize?: number;
}

/** Hills, with tunnels where two sheets of noise cross, soil over rock, and pockets of ore. @experimental */
export function noiseVoxelSource(params: VoxelNoiseParams): VoxelSource {
    const { seed, surfaceHeight, hillHeight, soilDepth, caveWidth } = params;
    const hills = 1 / Math.max(params.hillScale, 1e-3), caves = 1 / Math.max(params.caveScale, 1e-3);
    const topsoil = Math.max(soilDepth * 0.25, (params.cellSize ?? 1) * 2.5);
    const oreAt = params.oreAmount > 0 ? 0.7 - Math.min(params.oreAmount, 1) * 1.4 : 2;
    let lastX = NaN, lastZ = NaN, lastHeight = 0;
    return (x, y, z, out) => {
        if (x !== lastX || z !== lastZ) {
            lastX = x;
            lastZ = z;
            lastHeight = surfaceHeight + hillHeight * (noise3(x * hills, 0, z * hills, seed) * 0.7
                + noise3(x * hills * 2.3, 7.5, z * hills * 2.3, seed + 1) * 0.3);
        }
        const above = y - lastHeight;
        let distance = above;
        if (caveWidth > 0 && above < caveWidth) {
            const a = noise3(x * caves, y * caves, z * caves, seed + 2), b = noise3(x * caves, y * caves, z * caves, seed + 3);
            // Where both sheets are near zero is a line through the ground: distance from it, in about world units.
            const tunnel = (Math.hypot(a, b) * params.caveScale * 0.5) - caveWidth;
            distance = Math.max(above, -tunnel);
        }
        out.distance = distance;
        const depth = -above;
        if (depth < topsoil) out.material = VoxelMaterial.Topsoil;
        else if (depth < Math.max(soilDepth, topsoil)) out.material = VoxelMaterial.Soil;
        else out.material = noise3(x * caves * 3, y * caves * 3, z * caves * 3, seed + 4) > oreAt ? VoxelMaterial.Ore : VoxelMaterial.Rock;
    };
}

/**
 * A body under a height field: solid below `heightAt`, so a Terrain's own ground, or any other, can be dug into as a volume. The answer must be
 * the same for the same place, and null where it knows no height is air.
 *
 * @experimental
 */
export function heightVoxelSource(heightAt: (x: number, z: number) => number | null, material: (depth: number, sample: VoxelSample) => void = (depth, s) => {
    s.material = depth < 1 ? VoxelMaterial.Topsoil : depth < 4 ? VoxelMaterial.Soil : VoxelMaterial.Rock;
}): VoxelSource {
    return (x, y, z, out) => {
        const h = heightAt(x, z);
        out.distance = h === null ? 1 : y - h;
        material(-out.distance, out);
    };
}
