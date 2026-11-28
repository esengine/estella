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
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bakeRunner, jobLength, encodeMesh, unwrapLightmapUV, decodeLightmap, MeshChannel, MeshChannelType,
         type MeshData, type BakeLight } from 'esengine';
import { bakeSceneLightmap, bakeSceneLightmapParallel, claimLightmapImage, statsOf, resolveEnvironmentSun,
         bakeTextureFingerprint,
         type SceneBakeInput, type SceneBakeSurface } from '../src/assets/lightmapBake';
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
    it('fingerprints only the selected texture and effective cutoff, independently of scene order', async () => {
        const texture = path.join(dir, 'fingerprint.png');
        const parent = path.join(dir, 'fingerprint-parent.esmaterial');
        const child = path.join(dir, 'fingerprint-child.esmaterial');
        const paint = (red: number) => writeFile(texture, encodeRgbaPng(1, 1, new Uint8Array([red, 0, 0, 255])));
        const material = (cutoff: number, extra = {}) => writeFile(parent, JSON.stringify({
            type: 'material', shader: 'builtin:foliage', properties: {
                u_albedo: './fingerprint.png', u_useTexture: 1, u_alphaCutoff: cutoff, ...extra,
            },
        }));
        await Promise.all([paint(50), material(0.5), writeFile(child, JSON.stringify({
            type: 'material', instanceOf: './fingerprint-parent.esmaterial', properties: {},
        }))]);
        const surfaces = [
            { ...surface('roof.esmesh', 'Roof'), material: child },
            surface('unwrapped.esmesh', 'Floor'),
        ];
        const project = { root: dir };
        const first = await bakeTextureFingerprint('scene', { surfaces, materialProject: project });
        expect(first).not.toBe('scene');
        expect(await bakeTextureFingerprint('scene', { surfaces: [...surfaces].reverse(), materialProject: project })).toBe(first);
        await material(0.5, { u_roughness: 0.1 });
        expect(await bakeTextureFingerprint('scene', { surfaces, materialProject: project })).toBe(first);
        await paint(90);
        expect(await bakeTextureFingerprint('scene', { surfaces, materialProject: project })).not.toBe(first);
        await paint(50);
        await material(0.7);
        expect(await bakeTextureFingerprint('scene', { surfaces, materialProject: project })).not.toBe(first);
    });

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
                    sum += decodeLightmap(image.rgba, (image.width - 1 - y) * image.width + x)[0];
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

    it('bakes a cutout through inherited UUID and sibling refs, including a zero override', async () => {
        const materialDir = path.join(dir, 'materials');
        await mkdir(materialDir);
        const parent = '11111111-1111-4111-8111-111111111111';
        const material = (properties: object, instanceOf?: string) => JSON.stringify({ type: 'material', properties, instanceOf });
        await Promise.all([
            writeFile(path.join(materialDir, 'base.esmaterial'), material({ u_alphaCutoff: 0.5 })),
            writeFile(path.join(dir, 'base.esmaterial'), material({ u_alphaCutoff: 0 })),
            writeFile(path.join(materialDir, 'middle.esmaterial'), material({}, 'base.esmaterial')),
            writeFile(path.join(materialDir, 'child.esmaterial'), material({}, '@uuid:' + parent.toUpperCase())),
            writeFile(path.join(materialDir, 'solid.esmaterial'), material({ u_alphaCutoff: 0 }, '@uuid:' + parent)),
        ]);
        const materialProject = { root: dir, assets: [
            { uuid: parent, path: 'materials/middle.esmaterial' },
            { uuid: 'sibling', path: 'materials/base.esmaterial' },
            { uuid: 'root', path: 'base.esmaterial' },
        ] };
        const inputFor = (materialFile?: string): SceneBakeInput => ({
            materialProject,
            surfaces: [surface('unwrapped.esmesh', 'Floor'), {
                ...surface('roof.esmesh', 'Roof'),
                transform: [...IDENTITY.slice(0, 12), 0, 0.5, 0, 1],
                material: materialFile,
                baseColorTexture: path.join(dir, 'holes.png'),
            }],
            lights: [], options: { ...SMALL, samples: 64, ambient: [1, 1, 1] },
        });
        const bake = (materialFile?: string) => Buffer.from(bakeSceneLightmap(inputFor(materialFile)).atlasBytes);

        const cutout = bake(path.join(dir, 'cutout.esmaterial'));
        const solid = bake();
        const child = path.join(materialDir, 'child.esmaterial');
        expect(cutout.equals(solid)).toBe(false);
        expect(bake(child).equals(cutout)).toBe(true);
        expect(bake(path.join(materialDir, 'solid.esmaterial')).equals(solid)).toBe(true);
        let run: ReturnType<typeof bakeRunner> | undefined;
        const parallel = await bakeSceneLightmapParallel(inputFor(child), {
            async run(step) {
                run ??= bakeRunner(step.scene);
                run(step.job, 0, jobLength(step));
            },
            async textureStats(files, cutoffs) {
                expect(cutoffs).toEqual([0.5]);
                return files.map((file, i) => statsOf(file, cutoffs[i]));
            },
        });
        expect(Buffer.from(parallel.atlasBytes).equals(cutout)).toBe(true);
    });

    it('bakes the inherited foliage image from its declaring material and honors texture overrides', async () => {
        const library = path.join(dir, 'foliage-library');
        await mkdir(library);
        const parentId = '22222222-2222-4222-8222-222222222222';
        const material = (properties: object, instanceOf?: string) => JSON.stringify({
            type: 'material', shader: 'builtin:foliage', properties, instanceOf,
        });
        const base = path.join(library, 'leaf.esmaterial');
        const child = path.join(dir, 'foliage-instance.esmaterial');
        const holes = path.join(library, 'holes.png');
        await Promise.all([
            writeFile(holes, await readFile(path.join(dir, 'holes.png'))),
            writeFile(base, material({ u_albedo: './holes.png', u_useTexture: 1 })),
            writeFile(child, material({}, '@uuid:' + parentId)),
        ]);
        const materialProject = { root: dir, assets: [{ uuid: parentId, path: 'foliage-library/leaf.esmaterial' }] };
        const inputFor = (roof: Partial<SceneBakeSurface>): SceneBakeInput => ({
            materialProject,
            surfaces: [surface('unwrapped.esmesh', 'Floor'), {
                ...surface('roof.esmesh', 'Roof'),
                transform: [...IDENTITY.slice(0, 12), 0, 0.5, 0, 1],
                ...roof,
            }],
            lights: [], options: { ...SMALL, samples: 64, ambient: [1, 1, 1] },
        });
        const bake = (roof: Partial<SceneBakeSurface>) => Buffer.from(bakeSceneLightmap(inputFor(roof)).atlasBytes);
        const cutout = bake({ material: path.join(dir, 'cutout.esmaterial'), baseColorTexture: holes });
        const solid = bake({});
        expect(cutout.equals(solid)).toBe(false);
        expect(bake({ material: child }).equals(cutout)).toBe(true);

        let run: ReturnType<typeof bakeRunner> | undefined;
        const parallel = await bakeSceneLightmapParallel(inputFor({ material: child }), {
            async run(step) {
                run ??= bakeRunner(step.scene);
                run(step.job, 0, jobLength(step));
            },
            async textureStats(files, cutoffs) {
                expect(files).toEqual([holes]);
                expect(cutoffs).toEqual([0.5]);
                return files.map((file, i) => statsOf(file, cutoffs[i]));
            },
        });
        expect(Buffer.from(parallel.atlasBytes).equals(cutout)).toBe(true);

        for (const overrides of [{ u_useTexture: 0 }, { u_albedo: 0 }]) {
            await writeFile(child, material(overrides, '@uuid:' + parentId));
            expect(bake({ material: child, baseColorTexture: holes }).equals(solid)).toBe(true);
        }

        await Promise.all([
            writeFile(path.join(library, 'leaves.esshader'), '#pragma shader "Leaf Card"\n'
                + '#pragma param u_albedo texture default(white)\n#pragma param u_alphaCutoff float default(0.5)\n'),
            writeFile(base, JSON.stringify({ type: 'material', shader: './leaves.esshader', properties: { u_albedo: './holes.png' } })),
            writeFile(child, material({ u_useTexture: 0 }, '@uuid:' + parentId)),
        ]);
        expect(bake({ material: child }).equals(cutout)).toBe(true);
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

describe('the atlas file a bake writes', () => {
    it('is imported as irradiance at full size, on its first bake and every one after', async () => {
        const png = path.join(dir, 'claimed_lightmap.png');
        await writeFile(png, encodeRgbaPng(1, 1, new Uint8Array([0, 0, 0, 255])));
        const meta = async () => JSON.parse(await readFile(`${png}.meta`, 'utf8'));

        await claimLightmapImage(png, 1024);
        const first = await meta();
        expect(first.importer).toMatchObject({ sRGB: false, compress: 'off', wrapMode: 'clamp', maxSize: 2048 });

        await writeFile(`${png}.meta`, JSON.stringify({ ...first, importer: { ...first.importer, sRGB: true, maxSize: 1024 } }));
        await claimLightmapImage(png, 4096);
        const grown = await meta();
        expect(grown.uuid).toBe(first.uuid);
        expect(grown.importer).toMatchObject({ sRGB: false, maxSize: 4096 });

        await claimLightmapImage(png, 1024);
        expect((await meta()).importer.maxSize).toBe(4096);
    });
});

describe('a light following the environment\'s sun, in a bake', () => {
    const sky = Array.from({ length: 27 }, (_, i) => i / 10);
    const withoutSun = Array.from({ length: 27 }, (_, i) => i / 100);
    const environment = {
        document: { version: 1, irradiance: sky, specular: '', faceSize: 8, mipCount: 1, maxRange: 8,
                    sun: { direction: [0.6, 0.8, 0] as [number, number, number], color: [2, 1, 0.5] as [number, number, number],
                           skyIrradiance: withoutSun } },
        atlasPng: new Uint8Array(), rotation: 90,
    };
    const follower = { kind: 'directional' as const, direction: [0, 0, -1] as const, color: [1, 1, 1] as const,
                       intensity: 3, followsEnvironmentSun: true };
    const lamp = { kind: 'point' as const, position: [0, 0, 0] as const, color: [1, 1, 1] as const, intensity: 1 };

    it('casts the sun as the frame does, and bakes the sky without it', () => {
        const warnings: string[] = [];
        const out = resolveEnvironmentSun([follower, lamp], environment, [0.5, 0.5, 0.5], warnings);
        // Turned 90 degrees about +Y the sun stands toward -Z; the light travels away from it.
        const [x, y, z] = out.lights[0]!.direction!;
        expect([x, y, z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-0, -0.8, 0.6]);
        expect(out.lights[0]!.color).toEqual([1, 0.5, 0.25]);
        expect(out.lights[0]!.intensity).toBe(3);
        expect(out.lights[1]).toEqual(lamp);
        expect(out.environment!.document.irradiance).toBe(withoutSun);
        expect(warnings).toEqual([]);
    });

    it('leaves a follower out, and says so, where the environment has no sun', () => {
        const warnings: string[] = [];
        const noSun = { ...environment, document: { ...environment.document, sun: undefined } };
        const out = resolveEnvironmentSun([follower, lamp], noSun, [1, 1, 1], warnings);
        expect(out.lights).toEqual([lamp]);
        expect(out.environment!.document.irradiance).toBe(sky);
        expect(warnings[0]).toMatch(/environment has none/);
    });
});

