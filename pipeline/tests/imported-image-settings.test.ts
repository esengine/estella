// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  An image several materials share gets every setting its references ask for.
 */
import { describe, it, expect } from 'vitest';
import { importedImageSettings, type ImportedMesh } from '../src/assets/modelImport';

const mesh = (material: ImportedMesh['material']) => ({ material }) as ImportedMesh;

describe('settings of images materials share', () => {
    it('a cutout and a blended material on one atlas keep the cutout\'s coverage', () => {
        const got = importedImageSettings([
            mesh({ baseColorTexture: { file: 'atlas.png', external: true, settings: { mipCoverage: 0.5 } } } as never),
            mesh({ baseColorTexture: { file: 'atlas.png', external: true, settings: { sRGB: true } },
                normalTexture: { file: 'n.png', external: true, settings: { sRGB: false } } } as never),
        ]);
        expect(got.get('atlas.png')).toEqual({ external: true, settings: { mipCoverage: 0.5, sRGB: true } });
        expect(got.get('n.png')).toEqual({ external: true, settings: { sRGB: false } });
    });

    it('the first reference to name a key keeps it', () => {
        const got = importedImageSettings([
            mesh({ baseColorTexture: { file: 'a.png', external: false, settings: { sRGB: true } } } as never),
            mesh({ occlusionTexture: { file: 'a.png', external: false, settings: { sRGB: false } } } as never),
        ]);
        expect(got.get('a.png')?.settings).toEqual({ sRGB: true });
    });
});
