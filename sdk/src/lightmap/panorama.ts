// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    panorama.ts
 * @brief   Where an equirectangular panorama's texels look, seen from inside it.
 *
 * The centre column is +Z and row 0 is +Y; u grows toward -X, the right of a
 * viewer facing +Z, so a panorama reads as its photographer saw it rather than
 * mirrored. sky.esshader draws with the same mapping, written out in GLSL and WGSL.
 */

/** The unit direction texel coordinates (u, v) in [0, 1] look along. */
export function panoramaDirection(u: number, v: number): [number, number, number] {
    const phi = (u - 0.5) * 2 * Math.PI;
    const theta = v * Math.PI;
    const s = Math.sin(theta);
    return [-s * Math.sin(phi), Math.cos(theta), s * Math.cos(phi)];
}

/** The texel coordinates (u, v) the unit direction `d` finds. */
export function panoramaUV(dx: number, dy: number, dz: number): [number, number] {
    return [0.5 - Math.atan2(dx, dz) / (2 * Math.PI), Math.acos(Math.max(-1, Math.min(1, dy))) / Math.PI];
}
