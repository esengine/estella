// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    environmentAtlas.ts
 * @brief   A panorama of radiance → what an environment is to the renderer: nine irradiance coefficients and one
 *          prefiltered octahedral reflection atlas (RGBM, mips stacked downward).
 *
 * @details The importer runs this over an `.hdr` once (pipeline/environmentImport) and the sky lights the scene
 *          from it at run time (postprocess/skyEnvironment): one implementation, so a baked sky and a live one
 *          are the same numbers through the same basis.
 */
import { shBasis, convolveCosine } from './sh';
import { panoramaDirection, panoramaUV } from './panorama';

/** A panorama in linear light: equirectangular, row 0 = up (+Y). */
export interface Panorama {
    width: number;
    height: number;
    /** RGB triples, `width * height * 3` linear values. */
    rgb: Float32Array;
}

/** Bilinear lookup of the panorama along `d` (normalized), by `panoramaUV`. */
export function samplePanorama(env: Panorama, dx: number, dy: number, dz: number,
                               out: Float32Array): void {
    const [u, v] = panoramaUV(dx, dy, dz);
    const fx = u * env.width - 0.5;
    const fy = v * env.height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    // u wraps (the seam is continuous); v clamps (there is nothing past a pole).
    const wrapX = (x: number): number => ((x % env.width) + env.width) % env.width;
    const clampY = (y: number): number => Math.max(0, Math.min(env.height - 1, y));
    const x1 = wrapX(x0 + 1), y1 = clampY(y0 + 1);
    const xa = wrapX(x0), ya = clampY(y0);
    for (let c = 0; c < 3; c++) {
        const a = env.rgb[(ya * env.width + xa) * 3 + c]!;
        const b = env.rgb[(ya * env.width + x1) * 3 + c]!;
        const d = env.rgb[(y1 * env.width + xa) * 3 + c]!;
        const e = env.rgb[(y1 * env.width + x1) * 3 + c]!;
        out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
    }
}

/** Octahedral unit square → direction, with +Y at the centre. Values slightly
 *  outside [0,1] stay continuous, which is what makes the atlas' border texels
 *  the neighbours a bilinear tap expects. */
export function octDecode(u: number, v: number): [number, number, number] {
    const fx = u * 2 - 1;
    const fz = v * 2 - 1;
    let x = fx;
    let z = fz;
    const y = 1 - Math.abs(fx) - Math.abs(fz);
    if (y < 0) {
        const sx = x >= 0 ? 1 : -1;
        const sz = z >= 0 ? 1 : -1;
        x = (1 - Math.abs(fz)) * sx;
        z = (1 - Math.abs(fx)) * sz;
    }
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
}

/** The inverse of {@link octDecode}. */
export function octEncode(dx: number, dy: number, dz: number): [number, number] {
    const norm = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) || 1;
    let px = dx / norm;
    let pz = dz / norm;
    if (dy < 0) {
        const sx = px >= 0 ? 1 : -1;
        const sz = pz >= 0 ? 1 : -1;
        const ax = Math.abs(px);
        const az = Math.abs(pz);
        px = (1 - az) * sx;
        pz = (1 - ax) * sz;
    }
    return [px * 0.5 + 0.5, pz * 0.5 + 0.5];
}

/**
 * Project the panorama onto nine RGB coefficients, convolved with the clamped
 * cosine lobe and divided by π — the same nine a probe solve produces, through
 * the same basis, because one expression in the shader reads them both.
 */
export function projectIrradianceSH(env: Panorama): Float32Array {
    const coefficients = new Float32Array(27);
    const basis = new Float32Array(9);
    const dPhi = (2 * Math.PI) / env.width;
    const dTheta = Math.PI / env.height;
    for (let y = 0; y < env.height; y++) {
        const theta = (y + 0.5) * dTheta;
        const solidAngle = Math.sin(theta) * dTheta * dPhi;
        for (let x = 0; x < env.width; x++) {
            const [dx, dy, dz] = panoramaDirection((x + 0.5) / env.width, (y + 0.5) / env.height);
            shBasis(dx, dy, dz, basis);
            const o = (y * env.width + x) * 3;
            for (let i = 0; i < 9; i++) {
                const weighted = basis[i]! * solidAngle;
                coefficients[i * 3] += env.rgb[o]! * weighted;
                coefficients[i * 3 + 1] += env.rgb[o + 1]! * weighted;
                coefficients[i * 3 + 2] += env.rgb[o + 2]! * weighted;
            }
        }
    }

    convolveCosine(coefficients);
    return coefficients;
}

/** The atlas' pixel size, and where each mip's face begins in it. Mips stack
 *  downward, every face ringed by one texel so a bilinear tap at the edge of one
 *  never reaches into the next. */
export function atlasLayout(faceSize: number, mipCount: number): {
    width: number; height: number; offsets: number[];
} {
    const offsets: number[] = [];
    let height = 0;
    for (let mip = 0; mip < mipCount; mip++) {
        offsets.push(height);
        height += (faceSize >> mip) + 2;
    }
    return { width: faceSize + 2, height, offsets };
}

/** Van der Corput radical inverse — the second half of a Hammersley pair. */
function radicalInverse(bits: number): number {
    let b = bits;
    b = ((b << 16) | (b >>> 16)) >>> 0;
    b = (((b & 0x55555555) << 1) | ((b & 0xaaaaaaaa) >>> 1)) >>> 0;
    b = (((b & 0x33333333) << 2) | ((b & 0xcccccccc) >>> 2)) >>> 0;
    b = (((b & 0x0f0f0f0f) << 4) | ((b & 0xf0f0f0f0) >>> 4)) >>> 0;
    b = (((b & 0x00ff00ff) << 8) | ((b & 0xff00ff00) >>> 8)) >>> 0;
    return b * 2.3283064365386963e-10;
}

/**
 * GGX-importance-sample the panorama around `N`, the standard prefilter with
 * V = N. That approximation drops the stretched grazing highlight, which is the
 * price every runtime prefilter pays; the split-sum term the shader applies on
 * top is derived under the same assumption, so the two agree.
 */
function prefilterDirection(env: Panorama, roughness: number, samples: number,
                            nx: number, ny: number, nz: number,
                            out: Float32Array, scratch: Float32Array): void {
    out[0] = 0; out[1] = 0; out[2] = 0;
    if (roughness <= 0) {
        samplePanorama(env, nx, ny, nz, out);
        return;
    }
    // A tangent frame around N; the branch keeps the helper axis off N.
    const ax = Math.abs(nz) < 0.999 ? 0 : 1;
    let tx = ax === 0 ? -ny : 0;
    let ty = ax === 0 ? nx : nz;
    let tz = ax === 0 ? 0 : -ny;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;

    const a = roughness * roughness;
    let weight = 0;
    for (let i = 0; i < samples; i++) {
        const u1 = (i + 0.5) / samples;
        const u2 = radicalInverse(i);
        const phi = 2 * Math.PI * u1;
        const cosTheta = Math.sqrt((1 - u2) / (1 + (a * a - 1) * u2));
        const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
        const hx = sinTheta * Math.cos(phi);
        const hy = sinTheta * Math.sin(phi);
        const wx = tx * hx + bx * hy + nx * cosTheta;
        const wy = ty * hx + by * hy + ny * cosTheta;
        const wz = tz * hx + bz * hy + nz * cosTheta;
        const vdoth = nx * wx + ny * wy + nz * wz;
        const lx = 2 * vdoth * wx - nx;
        const ly = 2 * vdoth * wy - ny;
        const lz = 2 * vdoth * wz - nz;
        const ndotl = nx * lx + ny * ly + nz * lz;
        if (ndotl <= 0) continue;
        samplePanorama(env, lx, ly, lz, scratch);
        out[0] += scratch[0]! * ndotl;
        out[1] += scratch[1]! * ndotl;
        out[2] += scratch[2]! * ndotl;
        weight += ndotl;
    }
    if (weight > 0) {
        out[0] /= weight; out[1] /= weight; out[2] /= weight;
    }
}

/** RGBM, gamma-2 in the colour channels: an 8-bit encoding whose channels each
 *  interpolate the way the GPU is about to interpolate them. */
export function encodeRgbm(r: number, g: number, b: number, maxRange: number,
                           out: Uint8Array, at: number): void {
    const sr = Math.sqrt(Math.max(0, r) / maxRange);
    const sg = Math.sqrt(Math.max(0, g) / maxRange);
    const sb = Math.sqrt(Math.max(0, b) / maxRange);
    const m = Math.min(1, Math.max(sr, sg, sb, 1 / 255));
    const a = Math.ceil(m * 255) / 255;
    out[at] = Math.round(Math.min(1, sr / a) * 255);
    out[at + 1] = Math.round(Math.min(1, sg / a) * 255);
    out[at + 2] = Math.round(Math.min(1, sb / a) * 255);
    out[at + 3] = Math.round(a * 255);
}

/** The inverse of {@link encodeRgbm} — the same expression the shader runs. */
export function decodeRgbm(r: number, g: number, b: number, a: number,
                           maxRange: number): [number, number, number] {
    const f = (v: number): number => ((v / 255) * (a / 255)) ** 2 * maxRange;
    return [f(r), f(g), f(b)];
}

/** Prefilter `env` into the octahedral mip atlas, as RGBA8 rows top-first. */
export function prefilterOctahedral(env: Panorama, faceSize: number, mipCount: number, maxRange: number): {
    width: number; height: number; rgba: Uint8Array;
} {
    const { width, height, offsets } = atlasLayout(faceSize, mipCount);
    const rgba = new Uint8Array(width * height * 4);
    const colour = new Float32Array(3);
    const scratch = new Float32Array(3);
    for (let mip = 0; mip < mipCount; mip++) {
        const size = faceSize >> mip;
        const roughness = mipCount > 1 ? mip / (mipCount - 1) : 0;
        // Fewer texels to fill as the lobe widens, so the sample count can climb
        // without the cost doing the same.
        const samples = mip === 0 ? 1 : Math.min(256, 64 << mip);
        for (let y = -1; y <= size; y++) {
            for (let x = -1; x <= size; x++) {
                const u = (x + 0.5) / size;
                const v = (y + 0.5) / size;
                const [dx, dy, dz] = octDecode(u, v);
                prefilterDirection(env, roughness, samples, dx, dy, dz, colour, scratch);
                const px = x + 1;
                const py = offsets[mip]! + y + 1;
                encodeRgbm(colour[0]!, colour[1]!, colour[2]!, maxRange,
                           rgba, (py * width + px) * 4);
            }
        }
    }
    return { width, height, rgba };
}

