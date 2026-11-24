// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { makeStreamTail, STREAM_TAIL_EDGE } from '../src/assets/streamTail';
import { joinMipLevels, readKtx2Layout, wantsMipChain } from '../src/assets/ktx2Mips';
import { loadTextureEncoder } from '../src/assets/textureCook';

/** A `w` x `h` image whose left half is red and right half blue. */
function halves(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba.set(x < w / 2 ? [220, 20, 20, 255] : [20, 20, 220, 255], i);
  }
  return rgba;
}

function expectMipBytes(source: Uint8Array, preview: Uint8Array, first: number): void {
  const original = readKtx2Layout(source)!.levels.slice(first);
  const levels = readKtx2Layout(preview)!.levels;
  expect(levels).toHaveLength(original.length);
  for (const [i, level] of levels.entries()) {
    const from = original[i];
    expect(preview.subarray(level.offset, level.offset + level.length)).toEqual(source.subarray(from.offset, from.offset + from.length));
  }
}

describe('the small copy of a 3D texture', () => {
  it('is a PNG no larger than the start edge, the same picture, for a PNG', async () => {
    const png = new PNG({ width: 1024, height: 512 });
    png.data = Buffer.from(halves(1024, 512));
    const tail = await makeStreamTail(new Uint8Array(PNG.sync.write(png)), '.png', true);
    expect(tail).not.toBeNull();
    expect([tail!.width, tail!.height, tail!.fullWidth, tail!.fullHeight]).toEqual([STREAM_TAIL_EDGE, STREAM_TAIL_EDGE / 2, 1024, 512]);
    const back = PNG.sync.read(Buffer.from(tail!.bytes));
    expect(back.width).toBe(STREAM_TAIL_EDGE);
    expect([...back.data.subarray(0, 3)]).toEqual([220, 20, 20]);
    const right = ((STREAM_TAIL_EDGE / 4) * STREAM_TAIL_EDGE + STREAM_TAIL_EDGE - 1) * 4;
    expect([...back.data.subarray(right, right + 3)]).toEqual([20, 20, 220]);
  });

  it('is a JPEG for a JPEG', async () => {
    const source = jpeg.encode({ data: halves(2048, 2048), width: 2048, height: 2048 }, 90).data;
    const tail = await makeStreamTail(new Uint8Array(source), '.jpg', true);
    expect(tail!.ext).toBe('.jpg');
    const back = jpeg.decode(tail!.bytes, { useTArray: true });
    expect([back.width, back.height]).toEqual([STREAM_TAIL_EDGE, STREAM_TAIL_EDGE]);
    expect(back.data[0]).toBeGreaterThan(180);
    expect(tail!.bytes.byteLength).toBeLessThan(source.byteLength / 8);
  });

  it('is not made for a texture small enough already, or one it cannot read', async () => {
    const png = new PNG({ width: 512, height: 512 });
    png.data = Buffer.from(halves(512, 512));
    expect(await makeStreamTail(new Uint8Array(PNG.sync.write(png)), '.png', true)).toBeNull();
    expect(await makeStreamTail(new Uint8Array(16), '.ktx2', true)).toBeNull();
  });

  it.each([false, true])('keeps authored UASTC mip bytes, including their own colours (supercompressed %s)', async (supercompress) => {
    const { module: enc } = await loadTextureEncoder();
    const part = (width: number, height: number, value: number, mipmaps: boolean) => {
      const data = new Uint8Array(width * height * 4).fill(value);
      return enc.encodeToKtx2({ type: enc.ImageType.RGBA, data, width, height },
        { mode: 'uastc', srgb: false, mipmaps, supercompress });
    };
    const full = joinMipLevels([await part(1025, 128, 255, false), await part(512, 64, 255, false), await part(256, 32, 48, true)]);
    const tail = await makeStreamTail(full, '.ktx2', true);
    expect(tail).toMatchObject({ width: 256, height: 32, fullWidth: 1025, fullHeight: 128 });
    const source = readKtx2Layout(full)!;
    const result = readKtx2Layout(tail!.bytes)!;
    expect(result).toMatchObject({ width: 256, height: 32, srgb: false, scheme: source.scheme });
    expectMipBytes(full, tail!.bytes, 2);
    expect((await enc.transcodeKtx2ToRgba(tail!.bytes)).pixels[0]).toBeCloseTo(48, -1);
  });

  it.each(['uastc', 'etc1s'])('builds a preview for a single-level %s texture with project compression off', async (mode) => {
    const { module: enc } = await loadTextureEncoder();
    const source = await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: halves(1024, 64), width: 1024, height: 64 },
      { mode, srgb: true, mipmaps: false });
    const tail = await makeStreamTail(source, '.ktx2', false);
    expect(tail).toMatchObject({ width: 256, height: 16 });
    const decoded = await enc.transcodeKtx2ToRgba(tail!.bytes);
    expect(decoded.pixels[0]).toBeGreaterThan(180);
    expect(decoded.pixels[(decoded.width - 1) * 4 + 2]).toBeGreaterThan(180);
  });

  it('keeps a single-layer array out of the ordinary 2D mip and preview paths', async () => {
    const { module: enc } = await loadTextureEncoder();
    const array = await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: halves(1024, 4), width: 1024, height: 4 },
      { mode: 'uastc', mipmaps: false });
    new DataView(array.buffer, array.byteOffset, array.byteLength).setUint32(32, 1, true);
    expect(wantsMipChain(readKtx2Layout(array))).toBe(false);
    expect(await makeStreamTail(array, '.ktx2', true)).toBeNull();
  });

  it('carries the original ETC1S mip slices and their shared codebooks, including alpha', async () => {
    const { module: enc } = await loadTextureEncoder();
    const data = halves(1024, 64);
    for (let i = 3; i < data.length; i += 8) data[i] = 32;
    const source = await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data, width: 1024, height: 64 }, { mode: 'etc1s', mipmaps: true });
    const tail = await makeStreamTail(source, '.ktx2', true);
    expectMipBytes(source, tail!.bytes, 2);
    const decoded = await enc.transcodeKtx2ToRgba(tail!.bytes);
    expect([decoded.width, decoded.height]).toEqual([256, 16]);
    expect(decoded.pixels[0]).toBeGreaterThan(180);
    expect(decoded.pixels[3]).toBeGreaterThan(64);
    expect(decoded.pixels[3]).toBeLessThan(224);
  });
});
