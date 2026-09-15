// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sh.ts
 * @brief   Nine coefficients: the shader's `shIrradiance` and its inverse.
 *
 * @details Two things produce these — a panorama import and a probe solve — and
 *          one expression reads them back. The scales here are the shader's own,
 *          so what a bake writes is what a fragment reconstructs.
 */

/** The nine real SH basis scales, in the usual l/m order. */
export const SH_BASIS_SCALE = [
    0.282095,
    0.488603, 0.488603, 0.488603,
    1.092548, 1.092548, 0.315392, 1.092548, 0.546274,
] as const;

/**
 * Ramamoorthi & Hanrahan's cosine-lobe convolution, over π.
 *
 * The division is what makes a constant field come back as itself — a uniform
 * radiance c integrates to πc — so these land where the flat ambient term sits,
 * as the value that multiplies albedo.
 */
export const SH_COSINE_BAND = [1, 2 / 3, 2 / 3, 2 / 3, 0.25, 0.25, 0.25, 0.25, 0.25] as const;

/** The nine basis functions at `d`, which must be a unit direction. */
export function shBasis(dx: number, dy: number, dz: number, out: Float32Array): void {
    out[0] = SH_BASIS_SCALE[0];
    out[1] = SH_BASIS_SCALE[1] * dy;
    out[2] = SH_BASIS_SCALE[2] * dz;
    out[3] = SH_BASIS_SCALE[3] * dx;
    out[4] = SH_BASIS_SCALE[4] * dx * dy;
    out[5] = SH_BASIS_SCALE[5] * dy * dz;
    out[6] = SH_BASIS_SCALE[6] * (3 * dz * dz - 1);
    out[7] = SH_BASIS_SCALE[7] * dx * dz;
    out[8] = SH_BASIS_SCALE[8] * (dx * dx - dy * dy);
}

/** Convolves radiance coefficients into irradiance ones, in place. */
export function convolveCosine(coefficients: Float32Array, at = 0): void {
    for (let i = 0; i < 9; i++) {
        for (let c = 0; c < 3; c++) coefficients[at + i * 3 + c]! *= SH_COSINE_BAND[i];
    }
}

/** Evaluate nine RGB coefficients at `d` — the shader's reconstruction, in
 *  TypeScript, so a test can state what a pixel should be. */
export function evalIrradianceSH(coefficients: ArrayLike<number>,
                                 dx: number, dy: number, dz: number,
                                 at = 0): [number, number, number] {
    const basis = new Float32Array(9);
    shBasis(dx, dy, dz, basis);
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 9; i++) {
        for (let c = 0; c < 3; c++) out[c] += coefficients[at + i * 3 + c]! * basis[i]!;
    }
    return out;
}
