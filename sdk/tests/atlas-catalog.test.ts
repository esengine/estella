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
        expect(catalog.getAtlasFrame('@uuid:ABC')).toEqual(frame);
        expect(frame.atlas).toBe('page.ktx2');
        expect(frame.uvOffset).toEqual([0, 0.5]);
        expect(frame.uvScale).toEqual([0.5, 0.5]);
    });

    // A mini-game scene named its sprites by bare uuid, and every packed sprite
    // drew as the whole atlas page.
    it('serves a frame to any spelling of its uuid', () => {
        const uuid = '92f1ab5f-28f4-4b95-bb82-7182fdb33494';
        const fields = atlasCatalogFields(
            { frame: { x: 0, y: 0, width: 4, height: 4 }, pageWidth: 8, pageHeight: 8 },
            'page.png',
        );
        const catalog = Catalog.fromJson({
            version: 1,
            entries: { [`@uuid:${uuid}`]: { type: 'texture', buildPath: 'page.png', ...fields } },
        });
        for (const ref of [`@uuid:${uuid}`, uuid, uuid.toUpperCase(), `@uuid:${uuid.toUpperCase()}`]) {
            expect(catalog.getAtlasFrame(ref)?.uvScale, ref).toEqual([0.5, 0.5]);
        }
        expect(catalog.getAtlasFrame('page.png')).toBeNull();
    });

    it('resolves clip siblings and preserves existing project refs, aliases and external URLs', () => {
        const doc = 'assets/anims/hero.esanim';
        const entry = { type: 'texture' };
        const catalog = Catalog.fromJson({ version: 1, addresses: { badge: 'frames/badge.png' },
            entries: { 'frames/badge.png': entry, 'assets/anims/frames/badge.png': entry, 'assets/anims/run.png': entry } });
        for (const [ref, expected] of [
            ['frames/badge.png', 'frames/badge.png'], ['badge', 'frames/badge.png'], ['run.png', 'assets/anims/run.png'],
            ['../art/step.png', 'assets/art/step.png'], ['./new.png', 'assets/anims/new.png'],
            ['..\\art\\step.png', 'assets/art/step.png'],
            ['legacy/image.png', 'legacy/image.png'], ['https://art.test/eye.png', 'https://art.test/eye.png'],
        ]) expect(catalog.resolveDocumentRef(doc, ref)).toBe(expected);
    });
});
