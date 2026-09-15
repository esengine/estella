// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lightmapBake.ts
 * @brief   A scene's surfaces and lights become the atlas a `MeshLightmap` reads.
 *
 * The same shape as the environment import: the computation lives here and the
 * caller only writes files. What arrives is already placed — the editor holds
 * the world the transforms come from, and this holds the meshes they name.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { bakeLightmap, decodeMesh, unwrapLightmapUV, builtinMeshTemplate, MeshChannel,
         type MeshData, type BakeSurface, type BakeLight, type BakeOptions } from 'esengine';
import { encodeRgbaPng } from './png';

/** One placed object, as the editor's world describes it. */
export interface SceneBakeSurface {
    /** Absolute path of the `.esmesh` this object draws, or '' when
     *  {@link builtinRef} names the geometry instead. */
    meshFile: string;
    /** `builtin:<id>` for stock geometry, which is built from code and has no
     *  file to read a UV set out of. */
    builtinRef?: string;
    /** How it is named where a warning has to be readable. */
    label: string;
    /** Column-major 4x4 world transform. */
    transform: number[];
    /**
     * The surface's base colour factor — for an imported model this IS the
     * material's `baseColorFactor`, which the import writes onto the component.
     */
    baseColor?: [number, number, number];
    /** Absolute path of the base colour texture, whose average completes the
     *  albedo. A bounce off a red wall has to arrive red, and the colour is in
     *  the texture as often as it is in the factor. */
    baseColorTexture?: string;
}

export interface SceneBakeInput {
    surfaces: SceneBakeSurface[];
    lights: BakeLight[];
    options?: BakeOptions;
}

export interface SceneBakeResult {
    atlasBytes: Uint8Array;
    /** Atlas rectangle per surface, in the order they were given — `null` for one
     *  that was skipped, so a caller can line results up with what it sent. */
    scaleOffset: Array<[number, number, number, number] | null>;
    /** Texels the bake actually solved. Zero means nothing was lit. */
    lumels: number;
    size: number;
    warnings: string[];
}

/** Stock geometry with a lightmap UV set, unwrapped once per bake. */
function builtinGeometry(ref: string, cache: Map<string, MeshData | null>): MeshData | null {
    if (!cache.has(ref)) {
        const template = builtinMeshTemplate(ref);
        cache.set(ref, template ? unwrapLightmapUV(template.build()).mesh : null);
    }
    return cache.get(ref) ?? null;
}

/** sRGB to linear, one channel. A texture stores what a screen shows, and an
 *  average taken before this is decoded is brighter than the surface is. */
function toLinear(v: number): number {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A texture's mean colour in linear light, or null when it cannot be read. */
function averageOf(file: string): [number, number, number] | null {
    const png = PNG.sync.read(readFileSync(file));
    let r = 0, g = 0, b = 0;
    const pixels = png.width * png.height;
    if (pixels === 0) return null;
    for (let i = 0; i < pixels; i++) {
        r += toLinear(png.data[i * 4]);
        g += toLinear(png.data[i * 4 + 1]);
        b += toLinear(png.data[i * 4 + 2]);
    }
    return [r / pixels, g / pixels, b / pixels];
}

/**
 * What fraction of each channel this surface reflects.
 *
 * The factor and the texture BOTH carry it — a shader multiplies them, and a
 * bounce that used only one would drop the colour whenever the other held it.
 * A surface with neither reflects a neutral grey, which is a guess, so it says so.
 */
function albedoOf(s: SceneBakeSurface, cache: Map<string, [number, number, number] | null>,
                  warnings: string[]): [number, number, number] | undefined {
    const factor = s.baseColor;
    if (!s.baseColorTexture) {
        if (!factor) {
            warnings.push(`${s.label}: no base colour, so light bounces off it as neutral grey`);
        }
        return factor;
    }
    if (!cache.has(s.baseColorTexture)) {
        try {
            cache.set(s.baseColorTexture, averageOf(s.baseColorTexture));
        } catch {
            cache.set(s.baseColorTexture, null);
            warnings.push(`${s.label}: its base colour texture could not be read, so light`
                + ' bounces off it by its colour factor alone');
        }
    }
    const mean = cache.get(s.baseColorTexture) ?? null;
    if (!mean) return factor;
    const f = factor ?? [1, 1, 1];
    return [mean[0] * f[0], mean[1] * f[1], mean[2] * f[2]];
}

/**
 * Bakes what the caller placed, skipping what cannot receive light and saying so.
 *
 * A mesh with no second UV set is the case an author has to hear about: the bake
 * cannot invent one here (that would split vertices the scene already references)
 * and silently lighting everything else would look like the bake simply missed it.
 */
export function bakeSceneLightmap(input: SceneBakeInput): SceneBakeResult {
    const warnings: string[] = [];
    const surfaces: BakeSurface[] = [];
    const slot: number[] = [];
    // One decode per texture however many objects share it: a bake reads these
    // once and a scene reuses the same few across most of its surfaces.
    const averages = new Map<string, [number, number, number] | null>();
    // Stock geometry is rebuilt from code every run, so its lightmap UVs are
    // DERIVED here rather than being an asset: unwrapping an imported mesh
    // rewrites a file the scene already references, and this rewrites nothing.
    const builtins = new Map<string, MeshData | null>();

    for (let i = 0; i < input.surfaces.length; i++) {
        const s = input.surfaces[i];
        let mesh;
        try {
            mesh = s.builtinRef ? builtinGeometry(s.builtinRef, builtins)
                                : decodeMesh(new Uint8Array(readFileSync(s.meshFile)));
        } catch (err) {
            warnings.push(`${s.label}: ${(err as Error).message}`);
            continue;
        }
        if (!mesh) {
            warnings.push(`${s.label}: "${s.builtinRef}" is not stock geometry this build has`);
            continue;
        }
        if (!mesh.channels.some((c) => c.semantic === MeshChannel.TexCoord1)) {
            warnings.push(`${s.label}: no second UV set, so it receives no baked light —`
                + ' turn on Generate Lightmap UVs in its model\'s import settings and reimport');
            continue;
        }
        slot.push(i);
        surfaces.push({ mesh, transform: s.transform, albedo: albedoOf(s, averages, warnings) });
    }

    if (surfaces.length === 0) {
        warnings.push('nothing in this scene can receive baked light');
        return {
            atlasBytes: encodeRgbaPng(1, 1, new Uint8Array([0, 0, 0, 255])),
            scaleOffset: input.surfaces.map(() => null),
            lumels: 0, size: 1, warnings,
        };
    }

    const result = bakeLightmap(surfaces, input.lights, input.options);
    const scaleOffset: Array<[number, number, number, number] | null> =
        input.surfaces.map(() => null);
    slot.forEach((at, k) => { scaleOffset[at] = result.scaleOffset[k]; });

    return {
        atlasBytes: encodeRgbaPng(result.size, result.size, result.pixels),
        scaleOffset,
        lumels: result.lumels,
        size: result.size,
        warnings,
    };
}
