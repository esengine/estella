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
import { bakeLightmap, decodeMesh, MeshChannel,
         type BakeSurface, type BakeLight, type BakeOptions } from 'esengine';
import { encodeRgbaPng } from './png';

/** One placed object, as the editor's world describes it. */
export interface SceneBakeSurface {
    /** Absolute path of the `.esmesh` this object draws. */
    meshFile: string;
    /** How it is named where a warning has to be readable. */
    label: string;
    /** Column-major 4x4 world transform. */
    transform: number[];
    albedo?: [number, number, number];
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

    for (let i = 0; i < input.surfaces.length; i++) {
        const s = input.surfaces[i];
        let mesh;
        try {
            mesh = decodeMesh(new Uint8Array(readFileSync(s.meshFile)));
        } catch (err) {
            warnings.push(`${s.label}: ${(err as Error).message}`);
            continue;
        }
        if (!mesh.channels.some((c) => c.semantic === MeshChannel.TexCoord1)) {
            warnings.push(`${s.label}: no second UV set, so it receives no baked light —`
                + ' turn on Generate Lightmap UVs in its model\'s import settings and reimport');
            continue;
        }
        slot.push(i);
        surfaces.push({ mesh, transform: s.transform, albedo: s.albedo });
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
