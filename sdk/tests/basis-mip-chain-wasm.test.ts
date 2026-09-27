// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The transcoder returns every level a KTX2 carries.
 *
 * The cook's encoder writes a mip chain into every texture. This encodes with
 * that encoder and transcodes with the built side module, so neither half is a
 * stand-in.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { transcoderFromModule, type BasisWasmModule } from '../src/asset/basisTranscoder';
import { hasSideModule, loadSideModule } from './helpers/loadWasm';
import { CompressedTextureFormat, type BasisTranscoder } from '../src/asset/compressed';
import { readKtx2Layout, halveRgba, spliceMipChain } from '../../pipeline/src/assets/ktx2Mips';

const ROOT = path.resolve(__dirname, '../..');
const SIDE = 64;

describe.skipIf(!hasSideModule('basis'))('a KTX2 mip chain through the built transcoder', () => {
    let transcoder: BasisTranscoder;
    let ktx2: Uint8Array;

    beforeAll(async () => {
        transcoder = transcoderFromModule(await loadSideModule<BasisWasmModule>('basis'));
        const encoder = await import(path.join(ROOT, 'build-tools/basis/encoder.mjs'));
        const rgba = new Uint8Array(SIDE * SIDE * 4).map((_, i) => (i * 37) & 0xff);
        ktx2 = await encoder.encodeToKtx2(
            { type: encoder.ImageType.RGBA, data: rgba, width: SIDE, height: SIDE }, { mode: 'uastc', mipmaps: true });
    });

    const sides = [64, 32, 16, 8, 4, 2, 1];

    it('comes back with every level, each half the one before', async () => {
        const t = (await transcoder.transcode(ktx2, CompressedTextureFormat.ASTC_4x4))!;
        expect(t.levels?.map((l) => l.width)).toEqual(sides);
        // ASTC 4x4: one 16-byte block per 4x4, and a level smaller than a block still takes one.
        expect(t.levels?.map((l) => l.data.byteLength)).toEqual(sides.map((s) => Math.ceil(s / 4) ** 2 * 16));
    });

    it('decodes every level to RGBA as well', async () => {
        const r = (await transcoder.transcodeToRgba(ktx2))!;
        expect(r.levels?.map((l) => l.data.byteLength)).toEqual(sides.map((s) => s * s * 4));
    });

    // What the cook makes of an authored single-level KTX2 (pipeline ktx2Mips).
    it('decodes every level of a chain spliced under an authored level 0', async () => {
        const encoder = await import(path.join(ROOT, 'build-tools/basis/encoder.mjs'));
        const rgba = new Uint8Array(SIDE * SIDE * 4).map((_, i) => (i * 11) & 0xff);
        const authored = await encoder.encodeToKtx2(
            { type: encoder.ImageType.RGBA, data: rgba, width: SIDE, height: SIDE }, { mode: 'uastc', mipmaps: false, supercompress: true });
        const decoded = await encoder.transcodeKtx2ToRgba(authored);
        const half = halveRgba(decoded.pixels, decoded.width, decoded.height, readKtx2Layout(authored)!.srgb);
        const below = await encoder.encodeToKtx2({ type: encoder.ImageType.RGBA, data: half.rgba, width: half.width, height: half.height },
            { mode: 'uastc', mipmaps: true, yFlip: false, uastcLevel: 0, supercompress: true });
        const t = (await transcoder.transcode(spliceMipChain(authored, below), CompressedTextureFormat.ASTC_4x4))!;
        expect(t.levels?.map((l) => l.width)).toEqual(sides);
    });
});
