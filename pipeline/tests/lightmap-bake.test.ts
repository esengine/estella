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
import { encodeMesh, unwrapLightmapUV, decodeLightmap, MeshChannel, MeshChannelType,
         type MeshData, type BakeLight } from 'esengine';
import { bakeSceneLightmap, type SceneBakeSurface } from '../src/assets/lightmapBake';
import { encodeRgbaPng } from '../src/assets/png';
import { decodeRgbaPng } from '../src/assets/tilesetExtrude';

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
    // A texture that is HALF white and half black: its mean is a middle grey no
    // single pixel of it is, so an average that read one texel would be wrong.
    const half = new Uint8Array(4 * 4 * 4).fill(255);
    for (let i = 8; i < 16; i++) { half[i * 4] = 0; half[i * 4 + 1] = 0; half[i * 4 + 2] = 0; }
    await writeFile(path.join(dir, 'half.png'), encodeRgbaPng(4, 4, half));
    // Half of it there and half a hole, as a leaf card is.
    const holes = new Uint8Array(4 * 4 * 4).fill(255);
    for (let i = 8; i < 16; i++) holes[i * 4 + 3] = 0;
    await writeFile(path.join(dir, 'holes.png'), encodeRgbaPng(4, 4, holes));
    await writeFile(path.join(dir, 'roof.esmesh'), encodeMesh(unwrapLightmapUV(floor(1)).mesh));
    // The same quad twice over, the second copy laid on the first's lightmap UVs.
    const one = unwrapLightmapUV(floor(2)).mesh;
    const doubled = new Uint8Array(one.vertices.length * 2);
    doubled.set(one.vertices, 0);
    doubled.set(one.vertices, one.vertices.length);
    const dv = new DataView(doubled.buffer);
    const pos = one.channels.find((c) => c.semantic === MeshChannel.Position)!;
    for (let i = one.vertexCount; i < one.vertexCount * 2; i++) {
        dv.setFloat32(i * one.vertexStride + pos.offset, dv.getFloat32(i * one.vertexStride + pos.offset, true) + 10, true);
    }
    await writeFile(path.join(dir, 'stacked.esmesh'), encodeMesh({ ...one, vertices: doubled, vertexCount: one.vertexCount * 2,
        indices: Uint32Array.from([...one.indices, ...Array.from(one.indices, (v) => v + one.vertexCount)]) }));
    await writeFile(path.join(dir, 'cutout.esmaterial'), JSON.stringify(
        { version: '1.0', type: 'material', shader: 'builtin:model', properties: { u_alphaCutoff: 0.5 } }));
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const surface = (file: string, label: string, x = 0,
                baseColor: [number, number, number] = [0.8, 0.8, 0.8]): SceneBakeSurface => ({
    meshFile: path.join(dir, file),
    label,
    transform: [...IDENTITY.slice(0, 12), x, 0, 0, 1],
    baseColor,
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

    it('takes a surface\'s colour from its factor AND its texture', () => {
        // A shader multiplies the two, so a bounce that read only one drops the
        // colour whenever the other holds it. Read back through the warning the
        // guess would have produced: with a texture there is nothing to guess.
        const withTexture = bakeSceneLightmap({
            surfaces: [{
                ...surface('unwrapped.esmesh', 'Floor'),
                baseColor: undefined,
                baseColorTexture: path.join(dir, 'half.png'),
            }],
            lights: LAMP,
            options: SMALL,
        });
        expect(withTexture.warnings.join(' ')).not.toContain('neutral grey');

        // And an unreadable one falls back to the factor, saying so rather than
        // pretending the surface is white.
        const broken = bakeSceneLightmap({
            surfaces: [{
                ...surface('unwrapped.esmesh', 'Floor'),
                baseColorTexture: path.join(dir, 'raw.esmesh'),
            }],
            lights: LAMP,
            options: SMALL,
        });
        expect(broken.warnings.join(' ')).toContain('could not be read');
    });

    it('lights stock geometry, which has no file at all', () => {
        // Most scenes are built out of builtin primitives, and none of them is a
        // .esmesh anyone could turn an import setting on for. Their UVs are
        // derived per bake instead — nothing on disk is rewritten.
        const result = bakeSceneLightmap({
            surfaces: [{
                meshFile: '', builtinRef: 'builtin:cube', label: 'Crate',
                transform: IDENTITY, baseColor: [0.8, 0.8, 0.8],
            }],
            lights: LAMP,
            options: SMALL,
        });
        expect(result.warnings.join(' ')).not.toContain('no second UV set');
        expect(result.lumels).toBeGreaterThan(0);
        expect(result.scaleOffset[0]).not.toBeNull();
    });

    it('names stock geometry this build does not have', () => {
        const result = bakeSceneLightmap({
            surfaces: [{ meshFile: '', builtinRef: 'builtin:dodecahedron', label: 'Odd',
                         transform: IDENTITY }],
            lights: LAMP,
            options: SMALL,
        });
        expect(result.warnings.join(' ')).toContain('not stock geometry');
    });

    it('says when it had to guess what a surface reflects', () => {
        // Neutral grey is a guess, and a bounce off a red wall that arrives grey
        // is the kind of wrong that looks like the bake simply being dull.
        const result = bakeSceneLightmap({
            surfaces: [{ ...surface('unwrapped.esmesh', 'Floor'), baseColor: undefined }],
            lights: LAMP,
            options: SMALL,
        });
        expect(result.warnings.join(' ')).toContain('neutral grey');
    });

    it('lets the sky through a cutout by the share of it that is a hole', () => {
        // The floor's patch as a whole, under a roof that is solid, half holes, or
        // gone: a leaf card is the second, and baked as the first it walls in
        // everything under it.
        const under = (roof: Partial<SceneBakeSurface> | null): number => {
            const result = bakeSceneLightmap({
                surfaces: [surface('unwrapped.esmesh', 'Floor'),
                           ...(roof ? [{ ...surface('roof.esmesh', 'Roof'),
                                         transform: [...IDENTITY.slice(0, 12), 0, 0.5, 0, 1],
                                         baseColorTexture: path.join(dir, 'holes.png'), ...roof }] : [])],
                lights: [], options: { ...SMALL, samples: 128, ambient: [1, 1, 1] },
            });
            const image = decodeRgbaPng(result.atlasBytes);
            const [su, sv, ou, ov] = result.scaleOffset[0]!;
            let sum = 0;
            for (let y = Math.floor(ov * image.width); y < Math.ceil((ov + sv) * image.width); y++) {
                for (let x = Math.floor(ou * image.width); x < Math.ceil((ou + su) * image.width); x++) {
                    sum += decodeLightmap(image.rgba, y * image.width + x)[0];
                }
            }
            return sum;
        };
        const solid = under({});
        const cut = under({ material: path.join(dir, 'cutout.esmaterial') });
        const open = under(null);
        expect(solid).toBeLessThan(open * 0.95);
        expect(cut).toBeGreaterThan(solid + (open - solid) * 0.3);
        expect(cut).toBeLessThan(solid + (open - solid) * 0.7);
    });

    it('names a surface whose lightmap UVs lie on themselves', () => {
        const result = bakeSceneLightmap({
            surfaces: [surface('unwrapped.esmesh', 'Floor'), surface('stacked.esmesh', 'Curb', 20)],
            lights: LAMP, options: SMALL,
        });
        expect(result.warnings.filter((w) => w.includes('over one another'))).toEqual([
            expect.stringMatching(/^Curb: its lightmap UVs lay \d+% of its texels over one another/),
        ]);
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
