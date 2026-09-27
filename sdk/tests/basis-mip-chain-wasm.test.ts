// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The transcoder returns every level a KTX2 carries.
 *
 * The cook's encoder writes a mip chain into every texture. This encodes with
 * that encoder and transcodes with the built side module, so neither half is a
 * stand-in. Requires build/wasm/web/basis.wasm.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { transcoderFromModule, type BasisWasmModule } from '../src/asset/basisTranscoder';
import { CompressedTextureFormat, type BasisTranscoder } from '../src/asset/compressed';

const ROOT = path.resolve(__dirname, '../..');
const MODULE = path.join(ROOT, 'build/wasm/web/basis.js');
const SIDE = 64;

describe.skipIf(!existsSync(MODULE))('a KTX2 mip chain through the built transcoder', () => {
    let transcoder: BasisTranscoder;
    let ktx2: Uint8Array;

    beforeAll(async () => {
        // The glue is CommonJS inside a package that reads `.js` as ESM.
        const cjs = path.join(mkdtempSync(path.join(tmpdir(), 'basis-')), 'basis.cjs');
        writeFileSync(cjs, readFileSync(MODULE));
        const factory = createRequire(__filename)(cjs) as (o: object) => Promise<BasisWasmModule>;
        transcoder = transcoderFromModule(await factory({ locateFile: (f: string) => path.join(path.dirname(MODULE), f) }));
        const encoder = await import(path.join(ROOT, 'build-tools/basis/encoder.mjs'));
        const rgba = new Uint8Array(SIDE * SIDE * 4).map((_, i) => (i * 37) & 0xff);
        ktx2 = await encoder.encodeToKtx2(
            { type: encoder.ImageType.RGBA, data: rgba, width: SIDE, height: SIDE }, { mode: 'uastc', mipmaps: true });
    });

    const sides = [64, 32, 16, 8, 4, 2, 1];

    it('comes back with every level, each half the one before', () => {
        const t = transcoder.transcode(ktx2, CompressedTextureFormat.ASTC_4x4)!;
        expect(t.levels?.map((l) => l.width)).toEqual(sides);
        // ASTC 4x4: one 16-byte block per 4x4, and a level smaller than a block still takes one.
        expect(t.levels?.map((l) => l.data.byteLength)).toEqual(sides.map((s) => Math.ceil(s / 4) ** 2 * 16));
    });

    it('decodes every level to RGBA as well', () => {
        const r = transcoder.transcodeToRgba(ktx2)!;
        expect(r.levels?.map((l) => l.data.byteLength)).toEqual(sides.map((s) => s * s * 4));
    });
});
