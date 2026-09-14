// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a bake says what it could not light, and lights the rest anyway.
 *
 * Silence is the failure mode that matters here. A mesh with no second UV set
 * looks, in the result, exactly like one the bake simply missed — and the fix
 * (an import setting, then a reimport) is one only the author can apply.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeMesh, unwrapLightmapUV, MeshChannel, MeshChannelType,
         type MeshData, type BakeLight } from 'esengine';
import { bakeSceneLightmap, type SceneBakeSurface } from '../src/assets/lightmapBake';

let dir = '';

/** A quad on the XZ plane facing +Y. */
function floor(half: number): MeshData {
    const p = [[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]];
    const stride = 24;
    const vertices = new Uint8Array(p.length * stride);
    const view = new DataView(vertices.buffer);
    p.forEach((q, i) => {
        for (let k = 0; k < 3; k++) view.setFloat32(i * stride + k * 4, q[k], true);
        view.setFloat32(i * stride + 16, 1, true);
    });
    return {
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
        ],
        vertexStride: stride,
        vertexCount: 4,
        vertices,
        indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
        aabbMin: [-half, 0, -half],
        aabbMax: [half, 0, half],
    };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const LAMP: BakeLight[] = [
    { kind: 'point', position: [0, 4, 0], color: [1, 1, 1], intensity: 6, radius: 40 },
];
const SMALL = { atlasSize: 128, texelsPerUnit: 2, bounces: 0, samples: 8, dilate: 0 };

beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'estella-bake-'));
    await writeFile(path.join(dir, 'unwrapped.esmesh'), encodeMesh(unwrapLightmapUV(floor(4)).mesh));
    await writeFile(path.join(dir, 'raw.esmesh'), encodeMesh(floor(4)));
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const surface = (file: string, label: string, x = 0): SceneBakeSurface => ({
    meshFile: path.join(dir, file),
    label,
    transform: [...IDENTITY.slice(0, 12), x, 0, 0, 1],
});

describe('baking a scene', () => {
    it('names the object it could not light, and lights the others', () => {
        const result = bakeSceneLightmap({
            surfaces: [surface('unwrapped.esmesh', 'Floor', -6), surface('raw.esmesh', 'Slab', 6)],
            lights: LAMP,
            options: SMALL,
        });
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('Slab');
        expect(result.warnings[0]).toContain('Generate Lightmap UVs');
        expect(result.lumels).toBeGreaterThan(0);
    });

    it('lines its answers up with what it was given', () => {
        // The skipped object keeps its slot as null. A result that closed the gap
        // would hand every rectangle after it to the wrong entity.
        const result = bakeSceneLightmap({
            surfaces: [surface('raw.esmesh', 'Slab'), surface('unwrapped.esmesh', 'Floor')],
            lights: LAMP,
            options: SMALL,
        });
        expect(result.scaleOffset).toHaveLength(2);
        expect(result.scaleOffset[0]).toBeNull();
        expect(result.scaleOffset[1]).not.toBeNull();
    });

    it('says so when nothing in the scene can take a bake', () => {
        const result = bakeSceneLightmap({
            surfaces: [surface('raw.esmesh', 'Slab')], lights: LAMP, options: SMALL,
        });
        expect(result.lumels).toBe(0);
        expect(result.warnings.join(' ')).toContain('nothing in this scene');
    });

    it('writes a PNG the editor can adopt as an asset', () => {
        const result = bakeSceneLightmap({
            surfaces: [surface('unwrapped.esmesh', 'Floor')], lights: LAMP, options: SMALL,
        });
        expect(Array.from(result.atlasBytes.subarray(0, 8)))
            .toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(result.size).toBe(128);
    });
});
