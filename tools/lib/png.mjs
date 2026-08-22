// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  png.mjs — decoding a captured frame.
 *
 * Every verifier that asserts about pixels reads its frame through this, and two
 * of them are the engine's own. It lived in the editor's driver, which made
 * `tools/frameCompare.mjs` fail to load without an editor checkout.
 */
import { inflateSync } from 'node:zlib';

/**
 * Decode an 8-bit RGB/RGBA PNG into `{ w, h, px(x, y) → [r,g,b] }`.
 *
 * Pixel assertions are the point of capturing anything: "the picture changed" is
 * what a byte-length comparison can say, and it is not the same claim as "this
 * is the right colour" — a hidden panel changes bytes too.
 */
export function readPNG(buf) {
  let pos = 8; // skip the signature
  let w = 0, h = 0, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`unsupported bit depth ${data[8]}`);
      colorType = data[9];
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported colour type ${colorType}`);
      if (data[12] !== 0) throw new Error('interlaced PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return {
    w, h,
    px: (x, y) => {
      const i = y * stride + x * bpp;
      return [out[i], out[i + 1], out[i + 2]];
    },
  };
}
