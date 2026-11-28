// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What an environment looks like, without a scene: its sky as a picture, and the
 *        two spheres every lighting artist reaches for — a diffuse grey one, which
 *        shows the irradiance, and a mirror, which shows the reflection.
 *
 * Read from the products the import wrote (the nine coefficients in the `.esenv` and the
 * RGBM sky image beside it), turned about +Y the way the frame and the bake turn them:
 * `skyRadiance` in the SDK is the authority for that rotation, and the sphere here uses
 * the same one. So the preview answers "which way does this sky face under this
 * rotation" with the engine's own convention, not a second guess at it.
 *
 * A picture to judge by, not a render: linear light is clamped and gamma-encoded, with no
 * tone curve of the project's, so a bright sun reads as white rather than as its true value.
 */
import { evalIrradianceSH, panoramaDirection, panoramaUV } from 'esengine';
import { decodeRgbm } from './environmentImport';

/** An 8-bit RGBM image, row 0 = top: what the import writes for the sky. */
export interface RgbmImage {
    width: number;
    height: number;
    rgba: Uint8Array;
}

export interface EnvironmentPreviewInput {
    /** The nine RGB coefficients, as the `.esenv` stores them. */
    irradiance: readonly number[];
    /** The sky image; null when the import wrote none, and the mirror then shows the
     *  irradiance — the only sky there is. */
    sky: RgbmImage | null;
    /** The RGBM decode range the document names. */
    maxRange: number;
    /** `environmentRotation`, in degrees. */
    rotationDeg: number;
    /** Scales what is shown; a Light's intensity is 1 for a neutral preview. */
    exposure?: number;
}

export interface PreviewImage {
    width: number;
    height: number;
    /** RGBA8, row 0 = top. Transparent outside a sphere. */
    rgba: Uint8Array;
}

const encode = (linear: number): number =>
    Math.round(Math.min(1, Math.max(0, Math.pow(Math.max(0, linear), 1 / 2.2))) * 255);

/** The sky as the frame turns it: a world direction, in the environment's own frame. */
function environmentRotation(rotationDeg: number) {
    const yaw = (rotationDeg * Math.PI) / 180;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return (dx: number, dy: number, dz: number): [number, number, number] => [c * dx + s * dz, dy, -s * dx + c * dz];
}

function skyTexel(rgba: Uint8Array, offset: number, maxRange: number): [number, number, number] {
    return decodeRgbm(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!, maxRange);
}

/** Bilinear read of the RGBM sky in linear light. */
function sampleSky(sky: RgbmImage, maxRange: number, u: number, v: number, out: Float32Array): void {
    const { width, height, rgba } = sky;
    const fx = u * width - 0.5, fy = v * height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const left = ((x0 % width) + width) % width;
    const right = left + 1 === width ? 0 : left + 1;
    const top = Math.max(0, Math.min(height - 1, y0)) * width;
    const bottom = Math.max(0, Math.min(height - 1, y0 + 1)) * width;
    const a = skyTexel(rgba, (top + left) * 4, maxRange);
    const b = skyTexel(rgba, (top + right) * 4, maxRange);
    const c = skyTexel(rgba, (bottom + left) * 4, maxRange);
    const d = skyTexel(rgba, (bottom + right) * 4, maxRange);
    for (let k = 0; k < 3; k++) {
        out[k] = (a[k]! * (1 - tx) + b[k]! * tx) * (1 - ty) + (c[k]! * (1 - tx) + d[k]! * tx) * ty;
    }
}

/** The sky as a flat picture of the WORLD: each texel is the direction `panoramaDirection`
 *  gives it, read through the rotation, so the centre is what faces +Z — as on the spheres. */
export function previewPanorama(input: EnvironmentPreviewInput, width: number): PreviewImage {
    const height = Math.max(1, Math.round(width / 2));
    const rgba = new Uint8Array(width * height * 4);
    const exposure = input.exposure ?? 1;
    const lin = new Float32Array(3);
    const rotate = environmentRotation(input.rotationDeg);
    const { sky, maxRange } = input;
    // Yaw changes longitude independently of latitude. Project one equatorial
    // sample per column with the engine's panorama convention, then reuse it.
    const longitudes = sky ? Float64Array.from({ length: width }, (_, x) =>
        panoramaUV(...rotate(...panoramaDirection((x + 0.5) / width, 0.5)))[0]) : null;
    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
            if (sky && longitudes) sampleSky(sky, maxRange, longitudes[x]!, v, lin);
            else sampleIrradiance(input.irradiance, rotate(...panoramaDirection((x + 0.5) / width, v)), lin);
            const o = (y * width + x) * 4;
            rgba[o] = encode(lin[0]! * exposure); rgba[o + 1] = encode(lin[1]! * exposure);
            rgba[o + 2] = encode(lin[2]! * exposure); rgba[o + 3] = 255;
        }
    }
    return { width, height, rgba };
}

function sampleIrradiance(irradiance: readonly number[], direction: [number, number, number], out: Float32Array): void {
    const [r, g, b] = evalIrradianceSH(irradiance, ...direction);
    out[0] = Math.max(0, r); out[1] = Math.max(0, g); out[2] = Math.max(0, b);
}

/**
 * A sphere seen from +Z, lit by the environment.
 *
 * `diffuse` is a mid-grey matte ball: the irradiance the surface receives along its
 * normal. `mirror` is a perfect reflector: the sky along the reflected view direction, so
 * the centre of the ball shows what faces the viewer — +Z.
 */
export function previewBall(input: EnvironmentPreviewInput, mode: 'diffuse' | 'mirror', size: number): PreviewImage {
    const rgba = new Uint8Array(size * size * 4);
    const exposure = input.exposure ?? 1;
    const lin = new Float32Array(3);
    const albedo = 0.5;
    const rotate = environmentRotation(input.rotationDeg);
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const x = ((px + 0.5) / size) * 2 - 1;
            const y = 1 - ((py + 0.5) / size) * 2;
            const r2 = x * x + y * y;
            if (r2 > 1) continue;
            const nz = Math.sqrt(1 - r2);
            const o = (py * size + px) * 4;
            if (mode === 'diffuse') {
                const [r, g, b] = evalIrradianceSH(input.irradiance, ...rotate(x, y, nz));
                lin[0] = Math.max(0, r) * albedo; lin[1] = Math.max(0, g) * albedo; lin[2] = Math.max(0, b) * albedo;
            } else {
                // The viewer looks along -Z, so the reflection of the view vector v off normal n is
                // v - 2(v.n)n, whose z component is 2 nz^2 - 1.
                const direction = rotate(2 * nz * x, 2 * nz * y, 2 * nz * nz - 1);
                if (input.sky) sampleSky(input.sky, input.maxRange, ...panoramaUV(...direction), lin);
                else sampleIrradiance(input.irradiance, direction, lin);
            }
            rgba[o] = encode(lin[0]! * exposure); rgba[o + 1] = encode(lin[1]! * exposure);
            rgba[o + 2] = encode(lin[2]! * exposure); rgba[o + 3] = 255;
        }
    }
    return { width: size, height: size, rgba };
}
