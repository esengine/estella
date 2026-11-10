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
import { shBasis, evalIrradianceSH, panoramaDirection, samplePanorama, octDecode, octEncode,
         projectIrradianceSH, atlasLayout, encodeRgbm, decodeRgbm, prefilterOctahedral as prefilterOctahedralAtlas,
         type Panorama } from 'esengine';

export type { Panorama };
export { samplePanorama, octDecode, octEncode, projectIrradianceSH, atlasLayout, encodeRgbm, decodeRgbm };
import { encodeRgbaPng } from './png';


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
    /** Octahedral pyramids standing side by side in that atlas. Absent is one —
     *  a sky. A scene BAKE writes several, column 0 the sky and the rest a
     *  reflection probe each. */
    columns?: number;
    /** The panorama itself, for drawing the sky: equirectangular, row 0 up, RGBM
     *  under the same `maxRange`. Absent draws the sky from the atlas' mip 0. */
    sky?: string;
    /** The sun, when the panorama has one: what a directional light following the
     *  environment casts. Absent for a sky with no compact source bright enough. */
    sun?: EnvironmentSun;
}

/** A panorama's sun, separated from its sky. */
export interface EnvironmentSun {
    /** Toward the sun, in the panorama's frame, unit length. */
    direction: [number, number, number];
    /** Its irradiance over π per channel: the unit `irradiance` is in, and what a
     *  light's colour times intensity is. */
    color: [number, number, number];
    /** `irradiance` with the sun's texels filled from the sky around them — what
     *  the environment lights with while a light casts the sun. */
    skyIrradiance: number[];
}

export const ENVIRONMENT_FORMAT_VERSION = 1;
export { ENV_IMAGE_FIELDS } from './environmentFormat';

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
/** The widest sky texture an import writes by default. The sky is looked at
 *  directly, so it keeps the source's resolution up to here. */
export const ENV_SKY_MAX_WIDTH = 2048;

/** The `.meta` settings every image an environment import writes carries: RGBM
 *  radiance, not a picture — sRGB would linearize what is already linear, and a
 *  block compressor would quantize the shared multiplier with the colour. */
export const ENV_IMAGE_SETTINGS = { sRGB: false, compress: 'off', wrapMode: 'clamp' } as const;

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

// =============================================================================
// Diffuse: nine coefficients
// =============================================================================

export { shBasis, evalIrradianceSH };

// =============================================================================
// Specular: one prefiltered octahedral atlas
// =============================================================================

/** Prefilter `env` into the octahedral mip atlas, as RGBA8 rows top-first (the SDK's, with the import's defaults). */
export function prefilterOctahedral(env: Panorama, faceSize = ENV_FACE_SIZE, mipCount = ENV_MIP_COUNT,
                                    maxRange = ENV_MAX_RANGE): { width: number; height: number; rgba: Uint8Array } {
    return prefilterOctahedralAtlas(env, faceSize, mipCount, maxRange);
}

/**
 * The panorama as the sky texture, at most `maxWidth` wide: box-filtered down by
 * a whole factor where it is wider, so each texel is an average of whole source
 * texels rather than a point sample that skips some.
 */
export function encodeSkyPanorama(env: Panorama, maxWidth = ENV_SKY_MAX_WIDTH,
                                  maxRange = ENV_MAX_RANGE): {
    width: number; height: number; rgba: Uint8Array;
} {
    const factor = Math.max(1, Math.ceil(env.width / Math.max(1, maxWidth)));
    const width = Math.max(1, Math.floor(env.width / factor));
    const height = Math.max(1, Math.floor(env.height / factor));
    const rgba = new Uint8Array(width * height * 4);
    const area = factor * factor;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0;
            for (let sy = 0; sy < factor; sy++) {
                for (let sx = 0; sx < factor; sx++) {
                    const o = ((y * factor + sy) * env.width + (x * factor + sx)) * 3;
                    r += env.rgb[o]!; g += env.rgb[o + 1]!; b += env.rgb[o + 2]!;
                }
            }
            encodeRgbm(r / area, g / area, b / area, maxRange, rgba, (y * width + x) * 4);
        }
    }
    return { width, height, rgba };
}

/** Past this solid angle a bright region is a patch of sky, not a sun: the real
 *  disc is 7e-5 sr, and this leaves room for the halo a photograph gives it. */
const SUN_MAX_SOLID_ANGLE = 0.005;
/** A texel belongs to the sun above this fraction of the brightest one... */
const SUN_EDGE_OF_PEAK = 0.002;
/** ...and above this many times the panorama's median, so a flat sky has none. */
const SUN_OVER_MEDIAN = 20;
/** The least share of the panorama's light a sun must carry to be worth a light. */
const SUN_MIN_SHARE = 0.05;

/**
 * Find the panorama's sun and take it out of the sky, or null when it has none.
 *
 * The region around the brightest texel, bright against both peak and sky: too
 * wide is a lit patch of sky, too faint a highlight. Its irradiance is summed, not
 * fitted, so the light replacing it gives what the texels gave.
 */
export function separateSun(env: Panorama): EnvironmentSun | null {
    const { width: W, height: H, rgb } = env;
    const n = W * H;
    const lum = new Float32Array(n);
    let peak = 0, at = -1;
    for (let i = 0; i < n; i++) {
        const l = 0.2126 * rgb[i * 3]! + 0.7152 * rgb[i * 3 + 1]! + 0.0722 * rgb[i * 3 + 2]!;
        lum[i] = l;
        if (l > peak) { peak = l; at = i; }
    }
    if (!(peak > 0)) return null;
    const median = Float32Array.from(lum).sort()[n >> 1]!;
    const edge = Math.max(peak * SUN_EDGE_OF_PEAK, median * SUN_OVER_MEDIAN);
    if (!(peak > edge)) return null;

    const dTheta = Math.PI / H, dPhi = (2 * Math.PI) / W;
    const solidAngle = (y: number): number => Math.sin((y + 0.5) * dTheta) * dTheta * dPhi;
    let total = 0;
    for (let y = 0; y < H; y++) {
        const sa = solidAngle(y);
        for (let x = 0; x < W; x++) total += lum[y * W + x]! * sa;
    }

    const inSun = new Uint8Array(n);
    const region: number[] = [];
    const stack = [at];
    inSun[at] = 1;
    let omega = 0;
    while (stack.length > 0) {
        const i = stack.pop()!;
        region.push(i);
        const x = i % W, y = (i - x) / W;
        omega += solidAngle(y);
        if (omega > SUN_MAX_SOLID_ANGLE) return null;
        for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
                const j = ny * W + ((x + dx + W) % W);
                if (!inSun[j] && lum[j]! > edge) { inSun[j] = 1; stack.push(j); }
            }
        }
    }

    const energy = [0, 0, 0];
    const toward = [0, 0, 0];
    let power = 0;
    for (const i of region) {
        const x = i % W, y = (i - x) / W;
        const sa = solidAngle(y);
        for (let c = 0; c < 3; c++) energy[c]! += rgb[i * 3 + c]! * sa;
        const d = panoramaDirection((x + 0.5) / W, (y + 0.5) / H);
        const w = lum[i]! * sa;
        power += w;
        for (let c = 0; c < 3; c++) toward[c]! += d[c]! * w;
    }
    if (power < total * SUN_MIN_SHARE) return null;
    const length = Math.hypot(toward[0]!, toward[1]!, toward[2]!);
    if (!(length > 0)) return null;

    // The hole is filled with the sky that rims it, so the coefficients keep the
    // brightness around the sun and lose only the sun.
    const ring = [0, 0, 0];
    let rim = 0;
    for (const i of region) {
        const x = i % W, y = (i - x) / W;
        for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
                const j = ny * W + ((x + dx + W) % W);
                if (inSun[j]) continue;
                for (let c = 0; c < 3; c++) ring[c]! += rgb[j * 3 + c]!;
                rim++;
            }
        }
    }
    const sky = Float32Array.from(rgb);
    for (const i of region) {
        for (let c = 0; c < 3; c++) sky[i * 3 + c] = rim > 0 ? ring[c]! / rim : 0;
    }
    return {
        direction: [toward[0]! / length, toward[1]! / length, toward[2]! / length],
        color: [energy[0]! / Math.PI, energy[1]! / Math.PI, energy[2]! / Math.PI],
        skyIrradiance: Array.from(projectIrradianceSH({ width: W, height: H, rgb: sky })),
    };
}

/** What an import measured about itself — the numbers an author weighs quality against. */
export interface EnvironmentImportReport {
    sourceWidth: number;
    sourceHeight: number;
    /** Mip 0's face edge, in texels, and how many mips follow it. */
    faceSize: number;
    mipCount: number;
    /** The sky texture's size; 0 when none was written. */
    skyWidth: number;
    skyHeight: number;
    atlasBytes: number;
    skyBytes: number;
    /** The radiance the RGBM encoding tops out at. */
    maxRange: number;
    /** The share of source texels with a channel above {@link maxRange}: what the sky and the
     *  reflections clip, which a diffuse term (summed from the unclipped source) does not. */
    clippedFraction: number;
    /** The brightest channel in the source, so a clip can be told apart from a dim exposure. */
    peak: number;
}

/** Everything a panorama becomes, less the reference the caller has to resolve. */
export interface ImportedEnvironment {
    /** `<stem>_env.png` — the octahedral atlas. */
    atlasName: string;
    atlasBytes: Uint8Array;
    /** `<stem>_sky.png` — the panorama the sky is drawn from; null when the import
     *  was asked for none (`skyWidth: 0`). */
    sky: { name: string; bytes: Uint8Array } | null;
    /** The `.esenv` document, with `specular` still empty. */
    document: EnvironmentAssetData;
    /** What the source says that this import had to reinterpret. */
    warnings: string[];
    report: EnvironmentImportReport;
}

/** The most an import is allowed to ask for: past these the memory and time are not a
 *  quality setting but a way to run out of both. */
export const ENV_MAX_FACE_SIZE = 1024;
export const ENV_MAX_SKY_WIDTH = 8192;

export interface EnvironmentImportOptions {
    faceSize?: number;
    mipCount?: number;
    skyWidth?: number;
}

/** Turn a Radiance panorama into the assets a scene can reference. */
export function importEnvironment(bytes: Uint8Array, stem: string,
                                  options: EnvironmentImportOptions = {}): ImportedEnvironment {
    return importEnvironmentFromPanorama(decodeRadianceHdr(bytes), stem, options);
}

/**
 * Turn a panorama in linear light into the assets a scene can reference.
 *
 * @param faceSize Mip 0's face size; smaller is faster and is what tests use.
 * @param skyWidth The sky texture's widest edge; 0 writes none.
 */
export function importEnvironmentFromPanorama(panorama: Panorama, stem: string,
                                              options: EnvironmentImportOptions = {}): ImportedEnvironment {
    const warnings: string[] = [];
    let faceSize = options.faceSize ?? ENV_FACE_SIZE;
    if (faceSize > ENV_MAX_FACE_SIZE) {
        warnings.push(`faceSize ${faceSize} is past the ${ENV_MAX_FACE_SIZE} an import allows; it was imported at ${ENV_MAX_FACE_SIZE}`);
        faceSize = ENV_MAX_FACE_SIZE;
    }
    let skyWidth = options.skyWidth ?? ENV_SKY_MAX_WIDTH;
    if (skyWidth > ENV_MAX_SKY_WIDTH) {
        warnings.push(`skyWidth ${skyWidth} is past the ${ENV_MAX_SKY_WIDTH} an import allows; it was imported at ${ENV_MAX_SKY_WIDTH}`);
        skyWidth = ENV_MAX_SKY_WIDTH;
    }
    const mipCount = mipCountFor(faceSize, options.mipCount ?? ENV_MIP_COUNT);
    // Equirectangular is 2:1 by construction. Another ratio still bakes, but the
    // sphere it wraps onto is not the one the file draws — said, not guessed at.
    if (Math.abs(panorama.width - panorama.height * 2) > 1) {
        warnings.push(`the panorama is ${panorama.width}x${panorama.height}, not the 2:1 an`
            + ' equirectangular projection is; it was wrapped as if it were');
    }
    let clipped = 0, peak = 0;
    for (let i = 0; i < panorama.rgb.length; i += 3) {
        const m = Math.max(panorama.rgb[i]!, panorama.rgb[i + 1]!, panorama.rgb[i + 2]!);
        if (m > peak) peak = m;
        if (m > ENV_MAX_RANGE) clipped++;
    }
    const clippedFraction = clipped / Math.max(1, panorama.rgb.length / 3);
    if (clipped > 0) {
        warnings.push(`${(clippedFraction * 100).toFixed(2)}% of the source is brighter than the ${ENV_MAX_RANGE}`
            + ` the sky and reflections store (peak ${peak.toFixed(1)}); those texels clip there, and the diffuse light does not`);
    }
    const irradiance = projectIrradianceSH(panorama);
    const sun = separateSun(panorama);
    const atlas = prefilterOctahedral(panorama, faceSize, mipCount, ENV_MAX_RANGE);
    const sky = skyWidth > 0 ? encodeSkyPanorama(panorama, skyWidth, ENV_MAX_RANGE) : null;
    const atlasBytes = encodeRgbaPng(atlas.width, atlas.height, atlas.rgba);
    const skyBytes = sky ? encodeRgbaPng(sky.width, sky.height, sky.rgba) : null;
    return {
        atlasName: `${stem}_env.png`,
        atlasBytes,
        sky: sky && skyBytes ? { name: `${stem}_sky.png`, bytes: skyBytes } : null,
        warnings,
        report: {
            sourceWidth: panorama.width, sourceHeight: panorama.height, faceSize, mipCount,
            skyWidth: sky?.width ?? 0, skyHeight: sky?.height ?? 0,
            atlasBytes: atlasBytes.length, skyBytes: skyBytes?.length ?? 0,
            maxRange: ENV_MAX_RANGE, clippedFraction, peak,
        },
        document: {
            version: ENVIRONMENT_FORMAT_VERSION,
            irradiance: Array.from(irradiance),
            specular: '',
            faceSize,
            mipCount,
            maxRange: ENV_MAX_RANGE,
            ...(sun ? { sun } : {}),
        },
    };
}
