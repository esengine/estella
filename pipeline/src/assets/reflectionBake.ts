// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    reflectionBake.ts
 * @brief   The scene's reflection probes as ONE atlas, column 0 the sky.
 *
 * @details A probe's pyramid is built by the environment importer's own
 *          prefilter, from a panorama the bake captured instead of one a camera
 *          photographed — so a baked room and an imported sky are the same
 *          format, read by the same shader expression, at the same roughness.
 *
 *          Columns and not textures, because a texture is a BIND: the renderer
 *          carries which column an object reflects as a number per instance, and
 *          a hundred shiny things in a room still merge into one draw.
 */
import { type CapturedPanorama, flatSky, type SkyRadiance } from 'esengine';
import { atlasLayout, decodeRgbm, mipCountFor, octEncode, prefilterOctahedral,
         type EnvironmentAssetData } from './environmentImport';
import { encodeRgbaPng } from './png';
import { decodeRgbaPng } from './tilesetExtrude';

/** The scene's sky, as the bake found it on disk. */
export interface BakeEnvironment {
    /** The `.esenv` document beside the atlas. */
    document: EnvironmentAssetData;
    /** The atlas PNG it names. */
    atlasPng: Uint8Array;
}

export interface ReflectionBakeInput {
    /** One captured sphere per probe, in the order their columns are numbered. */
    panoramas: readonly CapturedPanorama[];
    /** The environment the scene is lit by, whose FORMAT this bake adopts and
     *  whose pyramid becomes column 0. Absent leaves column 0 the flat ambient. */
    environment?: BakeEnvironment | null;
    /** What column 0 holds without an environment: the scene's ambient term. */
    ambient?: readonly [number, number, number];
}

export interface ReflectionBakeResult {
    atlasBytes: Uint8Array;
    /** The `.esenv` document naming that atlas, less the `specular` ref, which
     *  only the caller knows the name it will write the file under. */
    document: EnvironmentAssetData;
    /** Columns in the atlas, the sky's included. */
    columns: number;
    warnings: string[];
}

/** Face size a bake uses when no environment states one. Small: what it holds is
 *  a room seen through a rough lobe, not a photograph. */
export const REFLECTION_FACE_SIZE = 32;
export const REFLECTION_MIP_COUNT = 3;
export const REFLECTION_MAX_RANGE = 8;

/** The nine coefficients a document must carry, when the sky did not supply them. */
const ZERO_SH = new Array<number>(27).fill(0);

/**
 * Reads the sky along a direction out of an imported environment's atlas.
 *
 * Mip 0 and nearest: a ray that escapes the scene is one texel of a panorama the
 * prefilter is about to blur anyway, and a bilinear tap here would cost every
 * ray for a difference no roughness shows.
 */
export function environmentSky(environment: BakeEnvironment): SkyRadiance | null {
    const face = environment.document.faceSize ?? 0;
    const maxRange = environment.document.maxRange ?? REFLECTION_MAX_RANGE;
    if (!(face > 0)) return null;
    let image;
    try {
        image = decodeRgbaPng(environment.atlasPng);
    } catch {
        return null;
    }
    if (image.width < face + 2) return null;
    return (dx, dy, dz, out, at) => {
        const [u, v] = octEncode(dx, dy, dz);
        const x = Math.min(face - 1, Math.max(0, Math.floor(u * face)));
        const y = Math.min(face - 1, Math.max(0, Math.floor(v * face)));
        const p = ((y + 1) * image.width + (x + 1)) * 4;
        const [r, g, b] = decodeRgbm(image.rgba[p]!, image.rgba[p + 1]!, image.rgba[p + 2]!,
                                     image.rgba[p + 3]!, maxRange);
        out[at] = r; out[at + 1] = g; out[at + 2] = b;
    };
}

/** The sky a capture should use: the environment's own where there is one. */
export function bakeSky(environment: BakeEnvironment | null | undefined,
                        ambient: readonly [number, number, number]): SkyRadiance {
    return (environment && environmentSky(environment)) ?? flatSky(ambient);
}

/**
 * Packs the captured spheres into one atlas: column 0 the sky, then a probe each.
 *
 * The FORMAT is the environment's when the scene has one, so column 0 is that
 * atlas copied texel for texel rather than a resampling of it — what a surface
 * outside every probe reflects must not change because a bake ran.
 */
export function bakeSceneReflections(input: ReflectionBakeInput): ReflectionBakeResult {
    const warnings: string[] = [];
    const env = input.environment ?? null;
    const ambient = input.ambient ?? [0, 0, 0];

    const faceSize = env?.document.faceSize || REFLECTION_FACE_SIZE;
    const mipCount = mipCountFor(faceSize, env?.document.mipCount || REFLECTION_MIP_COUNT);
    const maxRange = env?.document.maxRange || REFLECTION_MAX_RANGE;

    const { width: colWidth, height } = atlasLayout(faceSize, mipCount);
    const columns = 1 + input.panoramas.length;
    const rgba = new Uint8Array(colWidth * columns * height * 4);

    /** Writes one column's pyramid at `column`, row for row. */
    const place = (column: number, pixels: Uint8Array): void => {
        for (let y = 0; y < height; y++) {
            const from = y * colWidth * 4;
            const to = (y * colWidth * columns + column * colWidth) * 4;
            rgba.set(pixels.subarray(from, from + colWidth * 4), to);
        }
    };

    let sky: Uint8Array | null = null;
    if (env) {
        try {
            const image = decodeRgbaPng(env.atlasPng);
            if (image.width === colWidth && image.height === height) sky = image.rgba;
            else {
                warnings.push(`the environment's atlas is ${image.width}x${image.height}, not the`
                    + ` ${colWidth}x${height} its own document describes — column 0 was rebuilt`
                    + ' from the ambient term instead of copied');
            }
        } catch {
            warnings.push('the environment names an atlas this bake could not read; column 0 is'
                + ' the ambient term');
        }
    }
    if (sky) place(0, sky);
    else {
        place(0, prefilterOctahedral({ width: 4, height: 2,
                                       rgb: Float32Array.from([...ambient, ...ambient, ...ambient,
                                                               ...ambient, ...ambient, ...ambient,
                                                               ...ambient, ...ambient]) },
                                     faceSize, mipCount, maxRange).rgba);
    }

    input.panoramas.forEach((panorama, i) => {
        place(i + 1, prefilterOctahedral(panorama, faceSize, mipCount, maxRange).rgba);
    });

    return {
        atlasBytes: encodeRgbaPng(colWidth * columns, height, rgba),
        document: {
            version: 1,
            irradiance: env?.document.irradiance ?? ZERO_SH,
            // Filled by the caller, which is the one that knows what it will name
            // the file it writes beside this document.
            specular: '',
            faceSize,
            mipCount,
            maxRange,
            columns,
        },
        columns,
        warnings,
    };
}
