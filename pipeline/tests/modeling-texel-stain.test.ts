// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { bakeModel, bakeNormalMap, modelMaterialDoc, prepareModeling, validateModelSource, type ModelStep, type NormalMap } from '../src/modeling';

beforeAll(() => prepareModeling());

const BLUE = [0, 0, 1], RED = [1, 0, 0];
const slab: ModelStep = { id: 'slab', op: 'box', size: [4, 0.4, 4], color: BLUE, tag: 'slab' };
const thin: ModelStep = { op: 'decimate', from: 'slab', ratio: 1 };

function bake(steps: ModelStep[], normalBake: Record<string, unknown> = {}, material?: Record<string, unknown>): NormalMap {
    return bakeNormalMap(bakeModel({ version: 1, ...(material ? { material } : {}), normalBake: { from: 'dense', size: 256, color: true, surface: true, ...normalBake }, steps }));
}

function shares(map: NormalMap): { red: number; blue: number; mixed: number } {
    const c = map.colorRgba!;
    let red = 0, blue = 0, mixed = 0;
    for (let i = 0; i < c.length; i += 4) {
        if (c[i]! > 250 && c[i + 2]! < 5) red++;
        else if (c[i]! < 5 && c[i + 2]! > 250) blue++;
        else if (c[i]! + c[i + 2]! > 0) mixed++;
    }
    const all = red + blue + mixed;
    return { red: red / all, blue: blue / all, mixed: mixed / all };
}

describe('a texel stain', () => {
    it('is laid on the map and not on the faces: the dense surface keeps its triangles and its paint', () => {
        const steps: ModelStep[] = [{ ...slab, id: 'dense' }, { op: 'stain', texel: true, pattern: 'bumps', scale: 0.2, color: RED }, { op: 'decimate', from: 'dense', ratio: 1 }];
        const model = bakeModel({ version: 1, normalBake: { from: 'dense', size: 256, color: true }, steps });
        expect(model.detail!.high.faces.length).toBe(6);
        expect(model.detail!.high.faces.every((f) => f.color![2] === 1 && f.color![0] === 0)).toBe(true);
        expect(model.detail!.stains).toHaveLength(1);
        const { red, blue, mixed } = shares(bakeNormalMap(model));
        expect(red).toBeGreaterThan(0.1);
        expect(blue).toBeGreaterThan(0.1);
        expect(mixed).toBeGreaterThan(0.05);
    });

    it('is as fine as the map: a pattern far smaller than a face comes out as that many spots', () => {
        const map = bake([{ ...slab, id: 'dense' }, { op: 'stain', texel: true, faces: '+y', pattern: 'bumps', scale: 0.15, octaves: 1, softness: 0.02, color: RED }, { op: 'decimate', from: 'dense', ratio: 1 }], { size: 512 });
        const c = map.colorRgba!;
        let most = 0;
        for (let y = 0; y < 512; y++) {
            let changes = 0;
            for (let x = 1; x < 512; x++) if ((c[(y * 512 + x) * 4]! > 127) !== (c[(y * 512 + x - 1) * 4]! > 127)) changes++;
            most = Math.max(most, changes);
        }
        expect(most).toBeGreaterThan(20);
    });

    it('a hard disc covers the share of the surface its radius says', () => {
        const flat: ModelStep = { id: 'dense', op: 'plane', size: 4, color: BLUE, tag: 'sheet' };
        const map = bake([flat, { op: 'stain', texel: true, near: { at: [0, 0, 0], radius: 1 }, hard: true, color: RED }, { op: 'decimate', from: 'dense', ratio: 1 }], { surface: false });
        const { red, blue } = shares(map);
        expect(red / (red + blue)).toBeGreaterThan(Math.PI / 16 * 0.9);
        expect(red / (red + blue)).toBeLessThan(Math.PI / 16 * 1.1);
    });

    it('`where` reads the shape at each texel: wear on what stands out, dirt in what is sunken, nothing on the flat', () => {
        const plated: ModelStep[] = [slab, { id: 'dense', op: 'panels', faces: '+y', size: 1.3, gap: 0.16, height: 0.12, seed: 3, tag: 'plate' }];
        const wear = shares(bake([...plated, { op: 'stain', texel: true, faces: 'plate', where: 'edges', reach: 0.12, softness: 0.02, color: RED }, thin]));
        const dirt = shares(bake([...plated, { op: 'stain', texel: true, faces: 'slab', where: 'cavity', reach: 0.12, softness: 0.02, color: RED }, thin]));
        expect(wear.red + wear.mixed).toBeGreaterThan(0.01);
        expect(wear.blue).toBeGreaterThan(0.5);
        expect(dirt.red + dirt.mixed).toBeGreaterThan(0.01);
        expect(dirt.blue).toBeGreaterThan(0.5);
        const flat = shares(bake([{ ...slab, id: 'dense' }, { op: 'stain', texel: true, faces: '+y', where: 'cavity', reach: 0.12, softness: 0.02, color: RED }, { op: 'decimate', from: 'dense', ratio: 1 }]));
        expect(flat.red + flat.mixed).toBe(0);
    });

    it('`fray` moves the line of wear by the pattern, where without it the pattern only cuts holes in it', () => {
        const plated: ModelStep[] = [slab, { id: 'dense', op: 'panels', faces: '+y', size: 1.3, gap: 0.16, height: 0.12, seed: 3, tag: 'plate' }];
        const stain = { op: 'stain', texel: true, faces: 'plate', where: 'edges', reach: 0.12, softness: 0.02, color: RED };
        const band = shares(bake([...plated, stain, thin])).red;
        const holed = shares(bake([...plated, { ...stain, pattern: 'bumps', scale: 0.1 }, thin])).red;
        const frayed = shares(bake([...plated, { ...stain, pattern: 'bumps', scale: 0.1, fray: 1 }, thin])).red;
        expect(holed).toBeLessThan(band * 0.8);
        expect(frayed).toBeGreaterThan(holed);
    });

    it('lays roughness and metal on the surface map, and leaves what it was not told alone', () => {
        const map = bake([{ ...slab, id: 'dense' }, { op: 'stain', texel: true, near: { at: [0, 0.2, 0], radius: 5 }, hard: true, roughness: 0.2, metallic: 1 }, { op: 'decimate', from: 'dense', ratio: 1 }], {}, { roughness: 0.8, metallic: 0 });
        const s = map.surfaceRgba!, c = map.colorRgba!;
        let touched = 0;
        for (let i = 0; i < s.length; i += 4) if (c[i + 2]! > 250 && s[i + 1] === 51 && s[i + 2] === 255) touched++;
        expect(touched).toBeGreaterThan(256 * 256 * 0.5);
        expect(shares(map).red).toBe(0);
    });

    it('goes on after the paint of the faces, in the order written', () => {
        const over = (first: number[], second: number[]): NormalMap => bake([
            { ...slab, id: 'dense' },
            { op: 'stain', texel: true, near: { at: [0, 0, 0], radius: 9 }, hard: true, color: first },
            { op: 'stain', texel: true, near: { at: [0, 0, 0], radius: 9 }, hard: true, color: second },
            { op: 'decimate', from: 'dense', ratio: 1 },
        ]);
        expect(shares(over(BLUE, RED)).red).toBeGreaterThan(0.99);
        expect(shares(over(RED, BLUE)).blue).toBeGreaterThan(0.99);
    });

    it('needs a map to be laid on, and says so at its step', () => {
        const steps: ModelStep[] = [{ ...slab, id: 'dense' }, { op: 'stain', texel: true, pattern: 'bumps', scale: 0.2, color: RED }, { op: 'decimate', from: 'dense', ratio: 1 }];
        expect(() => bakeModel({ version: 1, steps })).toThrow(/step 1 \(stain\).*normalBake/);
        expect(() => bakeModel({ version: 1, normalBake: { from: 'dense', size: 256 }, steps })).toThrow(/normalBake with `color` or `surface`/);
        expect(() => bakeModel({ version: 1, normalBake: { from: 'dense', size: 256, color: true }, steps: [steps[0]!, { op: 'stain', texel: true, faces: 'hull', pattern: 'bumps', scale: 0.2, color: RED }, steps[2]!] })).toThrow(/matched no face/);
        expect(() => validateModelSource({ version: 1, steps: [slab, { op: 'stain', fray: 0.5, pattern: 'bumps', scale: 1, color: RED }] })).not.toThrow();
        expect(() => bakeModel({ version: 1, steps: [slab, { op: 'stain', fray: 0.5, pattern: 'bumps', scale: 1, color: RED }] })).toThrow(/fray/);
    });
});

describe('glow', () => {
    const lit: ModelStep[] = [
        { ...slab, id: 'blockout' },
        { op: 'box', size: [1, 0.1, 1], at: [0, 0.25, 0], color: [1, 0.5, 0.25], tag: 'lamp' },
        { id: 'dense', op: 'paint', faces: 'lamp', glow: 1 },
        { op: 'decimate', from: 'dense', ratio: 1 },
    ];

    it('is written as a map of the paint that glows, and black where nothing does', () => {
        const map = bake(lit, { surface: false });
        const e = map.emissiveRgba!;
        let lamp = 0, dark = 0;
        for (let i = 0; i < e.length; i += 4) {
            if (e[i] === 255 && e[i + 1]! > 120 && e[i + 1]! < 135 && e[i + 2]! > 58 && e[i + 2]! < 70) lamp++;
            else if (e[i] === 0 && e[i + 1] === 0 && e[i + 2] === 0) dark++;
        }
        expect(lamp).toBeGreaterThan(100);
        expect(dark).toBeGreaterThan(lamp);
    });

    it('is not written where nothing glows', () => {
        expect(bake([{ ...slab, id: 'dense' }, { op: 'decimate', from: 'dense', ratio: 1 }]).emissiveRgba).toBeUndefined();
    });

    it('a texel stain can light a spot or put one out', () => {
        const spot = bake([{ ...slab, id: 'dense' }, { op: 'stain', texel: true, near: { at: [0, 0.2, 0], radius: 0.5 }, hard: true, color: RED, glow: 1 }, { op: 'decimate', from: 'dense', ratio: 1 }]);
        let on = 0;
        for (let i = 0; i < spot.emissiveRgba!.length; i += 4) if (spot.emissiveRgba![i] === 255) on++;
        expect(on).toBeGreaterThan(20);
        const out = bake([...lit.slice(0, 3), { op: 'stain', texel: true, near: { at: [0, 0.3, 0], radius: 9 }, hard: true, glow: 0 }, lit[3]!]);
        expect(out.emissiveRgba!.every((b, i) => i % 4 === 3 || b === 0)).toBe(true);
    });

    it('the material reads the map, times the emissive the source gives or 1', () => {
        const source = validateModelSource({ version: 1, material: { emissive: [6, 6, 6] }, steps: lit });
        const named = modelMaterialDoc(source, true, { emissive: 'a_emissive.png', color: 'a_color.png' })!.properties as Record<string, unknown>;
        expect(named.u_emissiveMap).toBe('a_emissive.png');
        expect(named.u_emissive).toEqual({ r: 6, g: 6, b: 6, a: 1 });
        const plain = modelMaterialDoc(validateModelSource({ version: 1, steps: lit }), true, { emissive: 'a_emissive.png' })!.properties as Record<string, unknown>;
        expect(plain.u_emissive).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });
});
