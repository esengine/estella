// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { bakeModelFiles } from '../src/modeling/modelFiles';
import { validateModelSource, type ModelStep } from '../src/modeling';

const slab: ModelStep = { id: 'dense', op: 'box', size: [2, 0.4, 2], color: [0.5, 0.5, 0.5], tag: 'slab' };
const thin: ModelStep = { op: 'decimate', from: 'dense', ratio: 1 };
const text = (bytes: Uint8Array): Record<string, unknown> => JSON.parse(new TextDecoder().decode(bytes));

describe('the files a still model bakes to', () => {
    it('are its mesh alone where nothing asks for more', async () => {
        const { files, renderer } = await bakeModelFiles({ version: 1, steps: [slab] }, 'crate');
        expect(files.map((f) => f.name)).toEqual(['crate.esmesh']);
        expect(renderer).toMatchObject({ mesh: 'crate.esmesh', lit: true, opaque: true, cullBackfaces: true });
    });

    it('are named by the stem, with the maps the bake asks for and the material that reads them', async () => {
        const { files, renderer } = await bakeModelFiles({
            version: 1, normalBake: { from: 'dense', size: 128, color: true, surface: true, occlusion: true },
            steps: [{ ...slab, id: 'box' }, { id: 'dense', op: 'paint', faces: '+y', glow: 1 }, thin],
        }, 'crate');
        expect(files.map((f) => f.name)).toEqual(['crate.esmesh', 'crate_normal.png', 'crate_color.png', 'crate_surface.png', 'crate_emissive.png', 'crate_occlusion.png', 'crate.esmaterial']);
        const properties = text(files.at(-1)!.bytes).properties as Record<string, unknown>;
        expect(properties).toMatchObject({ u_normalMap: 'crate_normal.png', u_metallicRoughnessMap: 'crate_surface.png', u_occlusionMap: 'crate_occlusion.png', u_emissiveMap: 'crate_emissive.png' });
        expect(renderer).toMatchObject({ material: 'crate.esmaterial', texture: 'crate_color.png' });
    });

    it('marks every map as data and as large as it was baked, so a build does not ship it smaller', async () => {
        const { files } = await bakeModelFiles({
            version: 1, normalBake: { from: 'dense', size: 256, color: true, occlusion: { size: 128 } }, steps: [slab, thin],
        }, 'crate');
        const maps = Object.fromEntries(files.filter((f) => f.name.endsWith('.png')).map((f) => [f.name, f.importer]));
        expect(maps).toEqual({
            'crate_normal.png': { sRGB: false, maxSize: 256 },
            'crate_color.png': { sRGB: false, maxSize: 256 },
            'crate_occlusion.png': { sRGB: false, maxSize: 128 },
        });
    });

    it('writes a clear coat the source asks for, and none it does not', async () => {
        const coated = await bakeModelFiles({ version: 1, material: { roughness: 0.5, coat: 0.6 }, steps: [slab] }, 'crate');
        expect(text(coated.files.at(-1)!.bytes).properties).toMatchObject({ u_clearcoat: 0.6, u_clearcoatRoughness: 0.1 });
        const tuned = await bakeModelFiles({ version: 1, material: { coat: 1, coatRoughness: 0.3 }, steps: [slab] }, 'crate');
        expect(text(tuned.files.at(-1)!.bytes).properties).toMatchObject({ u_clearcoat: 1, u_clearcoatRoughness: 0.3 });
        const plain = await bakeModelFiles({ version: 1, material: { roughness: 0.5 }, steps: [slab] }, 'crate');
        expect(text(plain.files.at(-1)!.bytes).properties).not.toHaveProperty('u_clearcoat');
        expect(() => validateModelSource({ version: 1, material: { coat: 2 }, steps: [slab] })).toThrow(/material\.coat must be 0\.\.1/);
    });

    it('draws the contact sheet when asked', async () => {
        const { sheet } = await bakeModelFiles({ version: 1, steps: [slab] }, 'crate', { sheet: true });
        expect(Array.from(sheet!.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    });

    it('leaves a model with a rig to the editor, and says so', async () => {
        await expect(bakeModelFiles({
            version: 1, rig: { joints: [{ name: 'root', at: [0, 0, 0] }, { name: 'tip', at: [0, 1, 0], parent: 'root' }] },
            steps: [{ op: 'cylinder', radius: 0.2, height: 1, at: [0, 0.5, 0] }],
        }, 'arm')).rejects.toThrow(/has a rig/);
    });
});
