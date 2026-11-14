// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { DATA_TEXTURE_FIELDS, readsTextureAsNumbers } from '../src/asset/textureUse';
import { Terrain } from '../src/terrain/terrainPlugin';
import { Foliage } from '../src/foliage/foliagePlugin';

describe('the fields that read a texture as numbers', () => {
    it('are texture or image fields their components declare', () => {
        const declared: Record<string, { assetFields?: Array<{ field: string; type: string }> }> = { Terrain: Terrain as never, Foliage: Foliage as never };
        for (const [component, fields] of Object.entries(DATA_TEXTURE_FIELDS)) {
            const assets = (declared[component] as unknown as { assetFields?: Array<{ field: string; type: string }> }).assetFields ?? [];
            for (const field of fields) expect(assets.some((a) => a.field === field && (a.type === 'texture' || a.type === 'image')), `${component}.${field}`).toBe(true);
        }
    });

    it('include every image field, which is read from its file and never drawn', () => {
        const declared = { Terrain, Foliage } as unknown as Record<string, { assetFields: Array<{ field: string; type: string }> }>;
        const images = Object.entries(declared).flatMap(([component, def]) => def.assetFields.filter((a) => a.type === 'image').map((a) => `${component}.${a.field}`));
        expect(images.sort()).toEqual(['Foliage.densityMap', 'Foliage.scaleMap', 'Terrain.heightmap', 'Terrain.splatmap', 'Terrain.splatmap2']);
        for (const name of images) {
            const [component, field] = name.split('.') as [string, string];
            expect(readsTextureAsNumbers(component, field), name).toBe(true);
        }
    });

    it('answer for one field', () => {
        expect(readsTextureAsNumbers('Terrain', 'heightmap')).toBe(true);
        expect(readsTextureAsNumbers('Terrain', 'splatmap')).toBe(true);
        expect(readsTextureAsNumbers('Terrain', 'occlusionMap')).toBe(true);
        expect(readsTextureAsNumbers('Terrain', 'colorMap')).toBe(false);
        expect(readsTextureAsNumbers('Terrain', 'material')).toBe(false);
        expect(readsTextureAsNumbers('Sprite', 'texture')).toBe(false);
    });
});
