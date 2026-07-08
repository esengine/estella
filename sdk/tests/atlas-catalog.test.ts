// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Catalog atlas fields — the cook-manifest → CatalogEntry derivation the
 *        cooked hosts (web gameHost / wechatRuntime) share.
 */
import { describe, it, expect } from 'vitest';
import { Catalog, atlasCatalogFields } from '../src/asset/Catalog';

describe('atlasCatalogFields', () => {
    it('derives flipY-space uv from an image-space frame (AnimClipLoader convention)', () => {
        const fields = atlasCatalogFields(
            { frame: { x: 8, y: 4, width: 16, height: 8 }, pageWidth: 64, pageHeight: 32 },
            './assets/page0.png',
        );
        expect(fields.atlas).toBe('./assets/page0.png');
        expect(fields.frame).toEqual({ x: 8, y: 4, w: 16, h: 8 });
        // u = x/pageW; v = 1 - (y+h)/pageH — identical to the sprite-sheet math
        // AnimClipLoader has always used for per-frame uvOffset.
        expect(fields.uv).toEqual({
            offset: [8 / 64, 1 - (4 + 8) / 32],
            scale: [16 / 64, 8 / 32],
        });
    });

    it('produces entries Catalog.getAtlasFrame serves back', () => {
        const fields = atlasCatalogFields(
            { frame: { x: 0, y: 0, width: 4, height: 4 }, pageWidth: 8, pageHeight: 8 },
            'page.ktx2',
        );
        const catalog = Catalog.fromJson({
            version: 1,
            entries: { '@uuid:abc': { type: 'texture', buildPath: 'page.ktx2', ...fields } },
        });
        const frame = catalog.getAtlasFrame('@uuid:abc')!;
        expect(frame.atlas).toBe('page.ktx2');
        expect(frame.uvOffset).toEqual([0, 0.5]);
        expect(frame.uvScale).toEqual([0.5, 0.5]);
    });
});
