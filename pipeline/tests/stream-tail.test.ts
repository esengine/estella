// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { makeStreamTail, STREAM_TAIL_EDGE } from '../src/assets/streamTail';

/** A `w` x `h` image whose left half is red and right half blue. */
function halves(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba.set(x < w / 2 ? [220, 20, 20, 255] : [20, 20, 220, 255], i);
  }
  return rgba;
}

describe('the small copy of a 3D texture', () => {
  it('is a PNG no larger than the start edge, the same picture, for a PNG', async () => {
    const png = new PNG({ width: 1024, height: 512 });
    png.data = Buffer.from(halves(1024, 512));
    const tail = await makeStreamTail(new Uint8Array(PNG.sync.write(png)), '.png', true, null);
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
    const tail = await makeStreamTail(new Uint8Array(source), '.jpg', true, null);
    expect(tail!.ext).toBe('.jpg');
    const back = jpeg.decode(tail!.bytes, { useTArray: true });
    expect([back.width, back.height]).toEqual([STREAM_TAIL_EDGE, STREAM_TAIL_EDGE]);
    expect(back.data[0]).toBeGreaterThan(180);
    expect(tail!.bytes.byteLength).toBeLessThan(source.byteLength / 8);
  });

  it('is not made for a texture small enough already, or one it cannot read', async () => {
    const png = new PNG({ width: 512, height: 512 });
    png.data = Buffer.from(halves(512, 512));
    expect(await makeStreamTail(new Uint8Array(PNG.sync.write(png)), '.png', true, null)).toBeNull();
    expect(await makeStreamTail(new Uint8Array(16), '.ktx2', true, null)).toBeNull();
  });
});
