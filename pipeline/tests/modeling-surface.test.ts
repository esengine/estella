// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** What a surface is made of: said by faces, kept by a map in the packing the engine's material reads, and named by a material. */
import { beforeAll, describe, expect, it } from 'vitest';
import { MeshChannel } from 'esengine';
import { applyModelEdits, bakeModel, bakeNormalMap, modelMaterialDoc, prepareModeling, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';

beforeAll(() => prepareModeling());

const ball: ModelStep = { id: 'form', op: 'sphere', radius: 1, rings: 32, sides: 64, tag: 'ball' };
const thin: ModelStep = { op: 'decimate', from: 'form', triangles: 300, error: 0.5 };
const SIZE = 128;

function surfaceAt(m: BakedModel, rgba: Uint8Array, triangle: number): { texel: number[]; at: number[] } {
    const { data } = m;
    const channel = (semantic: number) => data.channels.find((c) => c.semantic === semantic)!.offset;
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const mean = (offset: number, k: number): number => [0, 1, 2].reduce((sum, c) => sum + view.getFloat32(data.indices[triangle * 3 + c]! * data.vertexStride + offset + k * 4, true), 0) / 3;
    const [u, v] = [mean(channel(MeshChannel.TexCoord0), 0), mean(channel(MeshChannel.TexCoord0), 1)];
    const i = (Math.floor((1 - v) * SIZE) * SIZE + Math.floor(u * SIZE)) * 4;
    return { texel: [...rgba.subarray(i, i + 4)], at: [0, 1, 2].map((k) => mean(channel(MeshChannel.Position), k)) };
}

describe('paint and stain say what a surface is made of', () => {
    it('paint sets them on what it names, and leaves colour alone', () => {
        const m = bakeModel({ version: 1, steps: [{ op: 'box', size: 1, color: [0.5, 0.5, 0.5] }, { op: 'paint', faces: '+y', roughness: 0.2, metallic: 1 }] });
        for (const f of m.poly.faces) {
            expect(f.color).toEqual([0.5, 0.5, 0.5, 1]);
            if (f.roughness !== undefined) expect([f.roughness, f.metallic]).toEqual([0.2, 1]);
        }
        expect(m.poly.faces.filter((f) => f.metallic === 1)).toHaveLength(1);
    });

    it('stain mixes toward them by `amount`, from what the source says everything is', () => {
        const m = bakeModel({ version: 1, material: { roughness: 0.8, metallic: 0 }, steps: [{ op: 'plane', size: 1 }, { op: 'stain', near: { at: [0, 0, 0], radius: 10 }, hard: true, amount: 0.5, roughness: 0.2, metallic: 1, detail: 5 }] });
        expect(m.poly.faces[0]!.roughness).toBeCloseTo(0.5, 6);
        expect(m.poly.faces[0]!.metallic).toBeCloseTo(0.5, 6);
        expect(m.poly.faces[0]!.color).toBeUndefined();
    });

    it('refuse a step that says nothing, and values out of range', () => {
        expect(() => bakeModel({ version: 1, steps: [ball, { op: 'paint', faces: 'all' }] })).toThrow(/at least one of color, roughness, metallic/);
        expect(() => bakeModel({ version: 1, steps: [ball, { op: 'stain', facing: [0, 1, 0] }] })).toThrow(/at least one of color, roughness, metallic/);
        expect(() => bakeModel({ version: 1, steps: [ball, { op: 'paint', faces: 'all', roughness: 2 }] })).toThrow(/roughness 2 must be 0..1/);
        expect(() => validateModelSource({ steps: [ball], material: { roughness: 2 } })).toThrow(/material.roughness must be 0..1/);
        expect(() => validateModelSource({ steps: [ball], material: { shiny: 1 } })).toThrow(/unknown field "shiny"/);
    });

    it('survive a decimate on the side they were on', () => {
        const m = bakeModel({ version: 1, steps: [ball, { op: 'stain', faces: { within: { min: [null, 0, null] } }, facing: [0, 1, 0], metallic: 1, threshold: 0 }, { op: 'decimate', ratio: 0.3, error: 0.2 }] });
        const metal = m.poly.faces.filter((f) => (f.metallic ?? 0) > 0.5);
        expect(metal.length).toBeGreaterThan(5);
        for (const f of metal) expect(f.v.reduce((sum, v) => sum + m.poly.positions[v]![1], 0) / 3).toBeGreaterThan(-0.2);
    });

    it('warn when nothing carries them, and say what would', () => {
        const m = bakeModel({ version: 1, steps: [ball, { op: 'paint', faces: 'all', metallic: 1 }] });
        expect(m.report.warnings.join()).toMatch(/nothing carries that: give normalBake `surface: true`, or say it once in `material`/);
    });
});

describe('normalBake surface', () => {
    it('packs as the material reads it: full red, roughness in green, metal in blue, and where it was painted', () => {
        const m = bakeModel({ version: 1, normalBake: { size: SIZE, surface: true }, steps: [ball, { op: 'stain', near: { at: [0, 1, 0], radius: 1.2 }, hard: true, roughness: 0.2, metallic: 1 }, thin] });
        const map = bakeNormalMap(m);
        expect(map.surfaceRgba).toBeDefined();
        const seen = { steel: 0, chalk: 0 };
        for (let t = 0; t < m.data.indices.length / 3; t++) {
            const { texel, at } = surfaceAt(m, map.surfaceRgba!, t);
            if (at[1]! > 0.5) { expect(texel).toEqual([255, 51, 255, 255]); seen.steel++; }
            if (at[1]! < -0.5) { expect(texel).toEqual([255, 255, 0, 255]); seen.chalk++; }
        }
        expect(seen.steel).toBeGreaterThan(3);
        expect(seen.chalk).toBeGreaterThan(3);
    });

    it('takes the source\'s `material` for faces that say nothing, and for texels no surface reached', () => {
        const steps: ModelStep[] = [{ op: 'plane', size: 4, at: [0, 5, 0] }, { id: 'away', op: 'transform', scale: 1 }, { op: 'delete', faces: 'all' }, { op: 'plane', size: 1 }];
        const missed = bakeModel({ version: 1, material: { roughness: 0.4, metallic: 0.5 }, normalBake: { size: SIZE, surface: true, from: 'away', distance: 0.1 }, steps });
        const map = bakeNormalMap(missed);
        expect(map.report.missed).toBe(1);
        expect(surfaceAt(missed, map.surfaceRgba!, 0).texel).toEqual([255, 102, 128, 255]);
        const hit = bakeModel({ version: 1, material: { roughness: 0.4, metallic: 0.5 }, normalBake: { size: SIZE, surface: true }, steps: [ball, thin] });
        expect(surfaceAt(hit, bakeNormalMap(hit).surfaceRgba!, 0).texel).toEqual([255, 102, 128, 255]);
    });

    it('is not written unless asked for', () => {
        const m = bakeModel({ version: 1, normalBake: { size: 64 }, steps: [ball, thin] });
        expect(bakeNormalMap(m).surfaceRgba).toBeUndefined();
    });

    it('`surface` must be true or false, and an edit can take a material away', () => {
        expect(() => validateModelSource({ steps: [ball, thin], normalBake: { surface: 1 } })).toThrow(/surface must be true or false/);
        const source = validateModelSource({ steps: [ball], material: { metallic: 1 } });
        expect(applyModelEdits(source, [{ op: 'settings', fields: { material: null as never } }]).material).toBeUndefined();
    });
});

describe('normalBake occlusion', () => {
    /** The occlusion map at the point of the thin mesh nearest @p want. */
    function at(m: BakedModel, map: { size: number; rgba: Uint8Array }, want: readonly number[]): number {
        const { data } = m;
        const offset = (semantic: number) => data.channels.find((c) => c.semantic === semantic)!.offset;
        const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
        let best = Infinity, u = 0, v = 0;
        for (let t = 0; t < data.indices.length / 3; t++) {
            const mean = (o: number, k: number): number => [0, 1, 2].reduce((sum, c) => sum + view.getFloat32(data.indices[t * 3 + c]! * data.vertexStride + o + k * 4, true), 0) / 3;
            const d = Math.hypot(mean(offset(MeshChannel.Position), 0) - want[0]!, mean(offset(MeshChannel.Position), 1) - want[1]!, mean(offset(MeshChannel.Position), 2) - want[2]!);
            if (d < best) { best = d; u = mean(offset(MeshChannel.TexCoord0), 0); v = mean(offset(MeshChannel.TexCoord0), 1); }
        }
        return map.rgba[(Math.floor((1 - v) * map.size) * map.size + Math.floor(u * map.size)) * 4]!;
    }

    it('is white over a ball, which nothing shades, and on any open flat', () => {
        const m = bakeModel({ version: 1, normalBake: { size: 256, occlusion: true }, steps: [ball, thin] });
        const { occlusion } = bakeNormalMap(m);
        expect(occlusion!.size).toBe(128);
        expect(at(m, occlusion!, [0, 1, 0])).toBeGreaterThan(245);
        expect(at(m, occlusion!, [1, 0, 0])).toBeGreaterThan(245);
    });

    it('is dark at the bottom of a deep slot, and light on the open face beside it', () => {
        const m = bakeModel({ version: 1, normalBake: { size: 512, from: 'form', occlusion: { reach: 1, samples: 64 } }, steps: [
            { id: 'form', op: 'organic', resolution: 80, blend: 0.01, parts: [
                { shape: 'box', size: [3, 2, 2] }, { shape: 'box', size: [0.3, 3, 1.4], at: [0, 0, 0.75], subtract: true, blend: 0.01 },
            ] },
        ] });
        const { occlusion } = bakeNormalMap(m);
        const inSlot = at(m, occlusion!, [0, 0, 0.05]);
        const open = at(m, occlusion!, [1, 0, 1]);
        expect(open).toBeGreaterThan(200);
        expect(inSlot).toBeLessThan(open * 0.6);
    }, 60000);

    it('sees where two parts meet, and not one far away', () => {
        const bake = (gap: number) => {
            const m = bakeModel({ version: 1, normalBake: { size: 256, from: 'high', occlusion: { reach: 0.5, samples: 36, size: 128 } }, steps: [
                { op: 'box', size: [4, 0.2, 4], at: [0, -0.1, 0], tag: 'floor' }, { op: 'sphere', radius: 0.5, rings: 24, sides: 48, at: [0, 0.5 + gap, 0], tag: 'ball' }, { id: 'high', op: 'tag', faces: 'floor', tag: 'floor' },
            ] });
            return at(m, bakeNormalMap(m).occlusion!, [0.2, 0, 0.1]);
        };
        expect(bake(0)).toBeLessThan(bake(3) * 0.75);
    }, 60000);

    it('fills past the charts\' edges, and is the same every time', () => {
        const source = { version: 1, normalBake: { size: 256, occlusion: { samples: 9 } }, steps: [ball, thin] };
        const a = bakeNormalMap(bakeModel(source)).occlusion!;
        const b = bakeNormalMap(bakeModel(source)).occlusion!;
        expect(a.rgba).toEqual(b.rgba);
        expect(a.rgba.every((_, i) => i % 4 !== 3 || a.rgba[i] === 255)).toBe(true);
    });

    it('is not worked out unless asked for', () => {
        expect(bakeNormalMap(bakeModel({ version: 1, normalBake: { size: 64 }, steps: [ball, thin] })).occlusion).toBeUndefined();
    });

    it('refuses what cannot be meant', () => {
        const steps = [ball, thin];
        expect(() => validateModelSource({ steps, normalBake: { occlusion: 1 } })).toThrow(/occlusion must be true, false or/);
        expect(() => validateModelSource({ steps, normalBake: { occlusion: { rays: 9 } } })).toThrow(/unknown field "rays"/);
        expect(() => validateModelSource({ steps, normalBake: { occlusion: { samples: 0 } } })).toThrow(/samples must be 1..256/);
        expect(() => validateModelSource({ steps, normalBake: { occlusion: { size: 100 } } })).toThrow(/power of two/);
        expect(() => validateModelSource({ steps, normalBake: { occlusion: { strength: 2 } } })).toThrow(/strength must be 0..1/);
    });
});

describe('the material a model writes', () => {
    it('is none where a MeshRenderer says it all', () => {
        expect(modelMaterialDoc(validateModelSource({ steps: [ball] }), true, {})).toBeNull();
        expect(modelMaterialDoc(validateModelSource({ steps: [ball] }), true, { normal: 'a_normal.png' })).toBeNull();
    });

    it('holds constants, and the normal map a renderer would otherwise hold', () => {
        const doc = modelMaterialDoc(validateModelSource({ steps: [ball], material: { roughness: 0.3, metallic: 1 } }), true, { normal: 'a_normal.png' })!;
        expect(doc.shader).toBe('builtin:model');
        expect(doc.properties).toEqual({ u_normalMap: 'a_normal.png', u_roughness: 0.3, u_metallic: 1 });
    });

    it('leaves a map\'s values unscaled: the factors multiply it, so they are 1', () => {
        const doc = modelMaterialDoc(validateModelSource({ steps: [ball, thin], material: { roughness: 0.3, metallic: 0 }, normalBake: { surface: true } }), true, { surface: 'a_surface.png' })!;
        expect(doc.properties).toEqual({ u_metallicRoughnessMap: 'a_surface.png', u_roughness: 1, u_metallic: 1 });
    });

    it('names an occlusion map and its strength, with constants left as they were', () => {
        const doc = modelMaterialDoc(validateModelSource({ steps: [ball, thin], normalBake: { occlusion: { strength: 0.5 } } }), true, { occlusion: 'a_occlusion.png' })!;
        expect(doc.properties).toEqual({ u_occlusionMap: 'a_occlusion.png', u_occlusionStrength: 0.5, u_roughness: 1, u_metallic: 0 });
    });

    it('culls as the surface allows', () => {
        const source = validateModelSource({ steps: [ball], material: { metallic: 1 } });
        expect(modelMaterialDoc(source, true, {})!.cull).not.toBe(modelMaterialDoc(source, false, {})!.cull);
    });
});
