// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { DATA_TEXTURE_FIELDS, readsTextureAsNumbers } from '../src/asset/textureUse';
import { Terrain } from '../src/terrain/terrainPlugin';
import { Foliage } from '../src/foliage/foliagePlugin';

describe('the fields that read a texture as numbers', () => {
    it('are texture fields their components declare', () => {
        const declared: Record<string, { assetFields?: Array<{ field: string; type: string }> }> = { Terrain: Terrain as never, Foliage: Foliage as never };
        for (const [component, fields] of Object.entries(DATA_TEXTURE_FIELDS)) {
            const assets = (declared[component] as unknown as { assetFields?: Array<{ field: string; type: string }> }).assetFields ?? [];
            for (const field of fields) expect(assets.some((a) => a.field === field && a.type === 'texture'), `${component}.${field}`).toBe(true);
        }
    });

    it('answer for one field', () => {
        expect(readsTextureAsNumbers('Terrain', 'heightmap')).toBe(true);
        expect(readsTextureAsNumbers('Terrain', 'splatmap')).toBe(true);
        expect(readsTextureAsNumbers('Terrain', 'material')).toBe(false);
        expect(readsTextureAsNumbers('Sprite', 'texture')).toBe(false);
    });
});
