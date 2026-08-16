// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Radiance `.hdr` panorama → the two things a renderer actually asks an
 *        environment for: irradiance for the diffuse term, and a roughness-indexed
 *        reflection for the specular one.
 *
 *        Both are precomputed here rather than at load: the convolutions are the
 *        expensive part and the answer never changes, so the product carries it.
 *        The diffuse half becomes nine spherical-harmonic coefficients — no texture
 *        at all — and the specular half one ordinary RGBA8 image, so nothing
 *        downstream learns a cube map or a float format.
 */
import { PNG } from 'pngjs';

/** A panorama in linear light: equirectangular, row 0 = up (+Y). */
export interface Panorama {
    width: number;
    height: number;
    /** RGB triples, `width * height * 3` linear values. */
    rgb: Float32Array;
}

/** The `.esenv` document. `specular` is filled in by the importer, which is what
 *  knows the atlas' project path. */
export interface EnvironmentAssetData {
    version: number;
    /** Nine RGB coefficients, already divided by π: evaluating them at N gives the
     *  value that multiplies albedo directly, the way `ambient` does. */
    irradiance: number[];
    /** The octahedral mip atlas, named as a sibling of this document. */
    specular: string;
    /** Edge length of mip 0's octahedral face, in texels. */
    faceSize: number;
    /** How many mips the atlas holds; mip i is prefiltered for roughness i/(mipCount-1). */
    mipCount: number;
    /** The RGBM decode range: `(rgb*a)^2 * maxRange` is the stored radiance. */
    maxRange: number;
}

export const ENVIRONMENT_FORMAT_VERSION = 1;

/** Mip 0's face size, and how many mips follow it. Five mips put roughness on a
 *  0.25 grid, which is finer than the prefilter's own error at the rough end. */
export const ENV_FACE_SIZE = 128;
export const ENV_MIP_COUNT = 5;
/** No mip goes below this. An octahedral face of a few texels is not a blurrier
 *  environment, it is a different one: the roughest lobe covers most of the
 *  sphere, and at 4 texels the SEAM is a quarter of what a sample can reach. */
export const ENV_MIN_FACE = 8;

/** How many mips `faceSize` supports without falling under {@link ENV_MIN_FACE}. */
export function mipCountFor(faceSize: number, want = ENV_MIP_COUNT): number {
    return Math.max(1, Math.min(want, Math.floor(Math.log2(faceSize / ENV_MIN_FACE)) + 1));
}
/** Radiance above this clips. Sky detail lives well below it; a sun disc does not,
 *  and is meant to survive as a bright blob rather than as its true thousands. */
export const ENV_MAX_RANGE = 8;

// =============================================================================
// Radiance (.hdr) decode
// =============================================================================

/**
 * Decode a Radiance RGBE file. Both the flat and the adaptive-RLE scanline
 * encodings appear in the wild; a decoder that handles one silently produces
 * garbage for the other, so both are here.
 */
export function decodeRadianceHdr(bytes: Uint8Array): Panorama {
    let at = 0;
    const line = (): string => {
        const start = at;
        while (at < bytes.length && bytes[at] !== 0x0a) at++;
        const text = new TextDecoder().decode(bytes.subarray(start, at));
        at++;
        return text;
    };

    const magic = line();
    if (!magic.startsWith('#?')) throw new Error('not a Radiance file: no #? signature');
    let format = '';
    for (;;) {
        if (at >= bytes.length) throw new Error('Radiance header ended before the resolution line');
        const text = line();
        if (text === '') break;
        if (text.startsWith('FORMAT=')) format = text.slice(7).trim();
    }
    if (format !== '' && format !== '32-bit_rle_rgbe') {
        throw new Error(`unsupported Radiance format ${format}`);
    }

    // Only the -Y +X orientation is produced by panorama tools; another one would
    // arrive mirrored, which is worse than refused.
    const resolution = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(line().trim());
    if (!resolution) throw new Error('unsupported Radiance scanline order (want "-Y h +X w")');
    const height = Number(resolution[1]);
    const width = Number(resolution[2]);

    const rgb = new Float32Array(width * height * 3);
    const scanline = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
        at = readScanline(bytes, at, width, scanline);
        for (let x = 0; x < width; x++) {
            const e = scanline[x * 4 + 3]!;
            const scale = e === 0 ? 0 : Math.pow(2, e - 136);
            const o = (y * width + x) * 3;
            rgb[o] = scanline[x * 4]! * scale;
            rgb[o + 1] = scanline[x * 4 + 1]! * scale;
            rgb[o + 2] = scanline[x * 4 + 2]! * scale;
        }
    }
    return { width, height, rgb };
}

/** Read one scanline into `out` as RGBE quadruples; returns where it ended. */
function readScanline(bytes: Uint8Array, at: number, width: number, out: Uint8Array): number {
    const adaptive = width >= 8 && width < 32768
        && bytes[at] === 2 && bytes[at + 1] === 2
        && ((bytes[at + 2]! << 8) | bytes[at + 3]!) === width;
    if (!adaptive) {
        // Flat RGBE. The old run marker is (1,1,1,count) — NOT an all-255 pixel,
        // which is what a mid-grey encodes to and must stay.
        let x = 0;
        while (x < width) {
            const r = bytes[at]!, g = bytes[at + 1]!, b = bytes[at + 2]!, e = bytes[at + 3]!;
            at += 4;
            if (r === 1 && g === 1 && b === 1 && x > 0) {
                const from = (x - 1) * 4;
                for (let i = 0; i < e && x < width; i++, x++) {
                    out.copyWithin(x * 4, from, from + 4);
                }
                continue;
            }
            out[x * 4] = r; out[x * 4 + 1] = g; out[x * 4 + 2] = b; out[x * 4 + 3] = e;
            x++;
        }
        return at;
    }

    at += 4;
    for (let channel = 0; channel < 4; channel++) {
        let x = 0;
        while (x < width) {
            const count = bytes[at++]!;
            if (count > 128) {
                const value = bytes[at++]!;
                for (let i = 0; i < count - 128; i++) out[(x++) * 4 + channel] = value;
            } else {
                for (let i = 0; i < count; i++) out[(x++) * 4 + channel] = bytes[at++]!;
            }
        }
    }
    return at;
}

// =============================================================================
// Directions
// =============================================================================

/** Bilinear lookup of the panorama along `d` (normalized). The image's centre
 *  column is +Z — the direction a head-on camera reflects — and row 0 is +Y. */
export function samplePanorama(env: Panorama, dx: number, dy: number, dz: number,
                               out: Float32Array): void {
    const u = 0.5 + Math.atan2(dx, dz) / (2 * Math.PI);
    const v = Math.acos(Math.max(-1, Math.min(1, dy))) / Math.PI;
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

// =============================================================================
// Diffuse: nine coefficients
// =============================================================================

const SH_BASIS_SCALE = [
    0.282095,
    0.488603, 0.488603, 0.488603,
    1.092548, 1.092548, 0.315392, 1.092548, 0.546274,
];

/** The nine real SH basis functions at `d`, in the usual l/m order. */
export function shBasis(dx: number, dy: number, dz: number, out: Float32Array): void {
    out[0] = SH_BASIS_SCALE[0]!;
    out[1] = SH_BASIS_SCALE[1]! * dy;
    out[2] = SH_BASIS_SCALE[2]! * dz;
    out[3] = SH_BASIS_SCALE[3]! * dx;
    out[4] = SH_BASIS_SCALE[4]! * dx * dy;
    out[5] = SH_BASIS_SCALE[5]! * dy * dz;
    out[6] = SH_BASIS_SCALE[6]! * (3 * dz * dz - 1);
    out[7] = SH_BASIS_SCALE[7]! * dx * dz;
    out[8] = SH_BASIS_SCALE[8]! * (dx * dx - dy * dy);
}

/**
 * Project the panorama onto nine RGB coefficients, convolved with the clamped
 * cosine lobe and divided by π. That division is what makes a constant
 * environment come back as itself — a uniform radiance c integrates to πc — so
 * these land where the flat ambient term already sits.
 */
export function projectIrradianceSH(env: Panorama): Float32Array {
    const coefficients = new Float32Array(27);
    const basis = new Float32Array(9);
    const dPhi = (2 * Math.PI) / env.width;
    const dTheta = Math.PI / env.height;
    for (let y = 0; y < env.height; y++) {
        const theta = (y + 0.5) * dTheta;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const solidAngle = sinTheta * dTheta * dPhi;
        for (let x = 0; x < env.width; x++) {
            const phi = ((x + 0.5) / env.width - 0.5) * 2 * Math.PI;
            shBasis(sinTheta * Math.sin(phi), cosTheta, sinTheta * Math.cos(phi), basis);
            const o = (y * env.width + x) * 3;
            for (let i = 0; i < 9; i++) {
                const weighted = basis[i]! * solidAngle;
                coefficients[i * 3] += env.rgb[o]! * weighted;
                coefficients[i * 3 + 1] += env.rgb[o + 1]! * weighted;
                coefficients[i * 3 + 2] += env.rgb[o + 2]! * weighted;
            }
        }
    }

    // Ramamoorthi & Hanrahan's cosine-lobe convolution, over π.
    const band = [1.0, 2 / 3, 2 / 3, 2 / 3, 0.25, 0.25, 0.25, 0.25, 0.25];
    for (let i = 0; i < 9; i++) {
        for (let c = 0; c < 3; c++) coefficients[i * 3 + c] *= band[i]!;
    }
    return coefficients;
}

/** Evaluate {@link projectIrradianceSH}'s output at `d` — the shader's own
 *  reconstruction, in TypeScript, so a test can state what a pixel should be. */
export function evalIrradianceSH(coefficients: ArrayLike<number>,
                                 dx: number, dy: number, dz: number): [number, number, number] {
    const basis = new Float32Array(9);
    shBasis(dx, dy, dz, basis);
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 9; i++) {
        for (let c = 0; c < 3; c++) out[c] += coefficients[i * 3 + c]! * basis[i]!;
    }
    return out;
}

// =============================================================================
// Specular: one prefiltered octahedral atlas
// =============================================================================

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
export function prefilterOctahedral(env: Panorama, faceSize = ENV_FACE_SIZE,
                                    mipCount = ENV_MIP_COUNT,
                                    maxRange = ENV_MAX_RANGE): {
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

/** Encode raw RGBA8 (row 0 = top) as PNG bytes. */
export function encodeAtlasPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
    const png = new PNG({ width, height });
    png.data = Buffer.from(rgba);
    return new Uint8Array(PNG.sync.write(png));
}

/** Everything a `.hdr` becomes, less the reference the caller has to resolve. */
export interface ImportedEnvironment {
    /** `<stem>_env.png` — the octahedral atlas. */
    atlasName: string;
    atlasBytes: Uint8Array;
    /** The `.esenv` document, with `specular` still empty. */
    document: EnvironmentAssetData;
    /** What the source says that this import had to reinterpret. */
    warnings: string[];
}

/**
 * Turn a Radiance panorama into the assets a scene can reference.
 *
 * @param faceSize Mip 0's face size; smaller is faster and is what tests use.
 */
export function importEnvironment(bytes: Uint8Array, stem: string,
                                  options: { faceSize?: number; mipCount?: number } = {}):
                                  ImportedEnvironment {
    const faceSize = options.faceSize ?? ENV_FACE_SIZE;
    const mipCount = mipCountFor(faceSize, options.mipCount ?? ENV_MIP_COUNT);
    const panorama = decodeRadianceHdr(bytes);
    const warnings: string[] = [];
    // Equirectangular is 2:1 by construction. Another ratio still bakes, but the
    // sphere it wraps onto is not the one the file draws — said, not guessed at.
    if (Math.abs(panorama.width - panorama.height * 2) > 1) {
        warnings.push(`the panorama is ${panorama.width}x${panorama.height}, not the 2:1 an`
            + ' equirectangular projection is; it was wrapped as if it were');
    }
    const irradiance = projectIrradianceSH(panorama);
    const atlas = prefilterOctahedral(panorama, faceSize, mipCount, ENV_MAX_RANGE);
    return {
        atlasName: `${stem}_env.png`,
        atlasBytes: encodeAtlasPng(atlas.width, atlas.height, atlas.rgba),
        warnings,
        document: {
            version: ENVIRONMENT_FORMAT_VERSION,
            irradiance: Array.from(irradiance),
            specular: '',
            faceSize,
            mipCount,
            maxRange: ENV_MAX_RANGE,
        },
    };
}
