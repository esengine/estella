// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PNG/RGBA → KTX2 encode via the vendored Basis encoder.
 *        Validates the produced KTX2 container and round-trips it back to RGBA to
 *        confirm encode quality (PSNR), proving the cook's compressed-texture
 *        producer end-to-end before it is wired into the pipeline.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  encodeToKtx2, encodePngToKtx2, transcodeKtx2ToRgba, ImageType,
} from '../../build-tools/basis/encoder.mjs';

const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const isKtx2 = (b: Uint8Array): boolean => KTX2_MAGIC.every((m, i) => b[i] === m);

/** Mean-squared-error PSNR over two equal-length RGBA buffers, in dB. */
function psnr(a: Uint8Array, b: Uint8Array): number {
  let sse = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sse += d * d; }
  const mse = sse / a.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** A smooth 64×64 RGBA gradient — UASTC reproduces it at high PSNR. */
function gradient(size = 64): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      px[o] = (x * 255 / (size - 1)) | 0;
      px[o + 1] = (y * 255 / (size - 1)) | 0;
      px[o + 2] = 128;
      px[o + 3] = 255;
    }
  }
  return px;
}

describe('basis KTX2 encoder', () => {
  it('encodes raw RGBA → valid KTX2 and round-trips at high PSNR', async () => {
    const size = 64;
    const src = gradient(size);
    const ktx2 = await encodeToKtx2(
      { type: ImageType.RGBA, data: src, width: size, height: size },
      { mode: 'uastc', mipmaps: false },
    );
    expect(isKtx2(ktx2)).toBe(true);
    expect(ktx2.length).toBeGreaterThan(0);

    const back = await transcodeKtx2ToRgba(ktx2);
    expect(back.width).toBe(size);
    expect(back.height).toBe(size);
    expect(back.pixels.length).toBe(size * size * 4);
    // UASTC on a smooth gradient is near-lossless.
    expect(psnr(src, back.pixels)).toBeGreaterThan(40);
  }, 30_000);

  it('encodes a real PNG asset → valid KTX2 with matching dimensions', async () => {
    const png = new Uint8Array(readFileSync(
      path.resolve(__dirname, '../../examples/audio-demo/thumbnail.png'),
    ));
    const ktx2 = await encodePngToKtx2(png, { mode: 'uastc', mipmaps: true });
    expect(isKtx2(ktx2)).toBe(true);

    const back = await transcodeKtx2ToRgba(ktx2);
    // PNG IHDR width/height (big-endian u32 at offsets 16/20).
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(back.width).toBe(dv.getUint32(16));
    expect(back.height).toBe(dv.getUint32(20));
  }, 30_000);

  it('content of identical sources encodes identically (deterministic)', async () => {
    const src = gradient(32);
    const opts = { mode: 'uastc' as const, mipmaps: false };
    const a = await encodeToKtx2({ type: ImageType.RGBA, data: src, width: 32, height: 32 }, opts);
    const b = await encodeToKtx2({ type: ImageType.RGBA, data: src.slice(), width: 32, height: 32 }, opts);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  }, 30_000);
});
