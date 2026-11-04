// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * What a large project's textures cost to move: the bytes the cook ships for real
 * photographic art, not for flat fills a compressor flatters.
 *
 * The fixtures are 256px crops of 24 of Amazon Lumberyard Bistro's 2048px textures
 * (ORCA, CC-BY 4.0 — see the NOTICE beside them), BaseColor and Normal alike. The whole
 * scene's textures are ~1.3GB through the editor protocol, so the bytes each one costs
 * is what opening it waits on.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cookTexture, loadTextureEncoder } from '../src/assets/textureCook';
import { readKtx2Layout } from '../src/assets/ktx2Mips';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/bistro-crops');
const SCHEME_ZSTD = 2;

/** What the 24 crops cost under zstd, measured; the budget is this plus headroom for an encoder update. */
const MEASURED_ZSTD_BYTES = 1111520;
const HEADROOM = 1.03;

describe('Bistro texture crops, cooked as a build ships them', () => {
  it('ship under zstd, within the byte budget, and decode to the pixels plain UASTC gives', async () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
    expect(files).toHaveLength(24);
    const encoder = await loadTextureEncoder();
    const root = mkdtempSync(path.join(tmpdir(), 'estella-supercompress-'));
    let shipped = 0, plainBytes = 0;
    try {
      for (const f of files) {
        const png = new Uint8Array(readFileSync(path.join(DIR, f)));
        const cooked = await cookTexture({
          root, path: `t/${f}`, data: png, ext: '.png', importer: { compress: 'on', alphaIsTransparency: false },
          encoder, compressTextures: true, atlasTextures: false, drawnIn3D: false,
        });
        expect(cooked.ext, f).toBe('.ktx2');
        const layout = readKtx2Layout(cooked.data)!;
        expect(layout.scheme, `${f} ships without zstd`).toBe(SCHEME_ZSTD);
        const plain = await encoder.module.encodeToKtx2({ type: encoder.module.ImageType.PNG, data: png },
          { mode: 'uastc', srgb: layout.srgb });
        const [a, b] = await Promise.all([encoder.module.transcodeKtx2ToRgba(cooked.data), encoder.module.transcodeKtx2ToRgba(plain)]);
        expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels)), `${f} decodes differently under zstd`).toBe(true);
        shipped += cooked.data.length;
        plainBytes += plain.length;
      }
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
    console.log(`bistro crops: ${shipped} bytes under zstd, ${plainBytes} plain (${((1 - shipped / plainBytes) * 100).toFixed(1)}% saved)`);
    expect(shipped).toBeLessThanOrEqual(MEASURED_ZSTD_BYTES * HEADROOM);
  }, 120000);
});
