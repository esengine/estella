// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regenerate the KTX2 orientation fixture: one asymmetric image, written twice —
 * once as PNG and once as KTX2.
 *
 * Asymmetric on purpose. Compressed textures shipped upside down for several
 * releases and nothing caught it, because the fixture guarding that path was a
 * solid green square: it looks the same either way up. A top-red/bottom-blue
 * image cannot pass a flipped upload, and the PNG beside it is the control —
 * the claim is not "KTX2 looks right", it is "KTX2 and PNG agree".
 *
 *   node tools/make-orientation-fixture.mjs desktop/public/scenes/ktx2-test
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { encodeToKtx2, ImageType } from '../build-tools/basis/encoder.mjs';

const W = 64, H = 64;
// Vertically ASYMMETRIC on purpose: the whole reason the flip bug survived is
// that the fixture guarding it looked the same either way up.
const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const top = y < H / 2;
    px[i] = top ? 220 : 20;       // R: top red
    px[i + 1] = 20;
    px[i + 2] = top ? 20 : 220;   // B: bottom blue
    px[i + 3] = 255;
  }
}

// Minimal PNG (no filter, one IDAT).
const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(process.argv[2] + '/updown.png', png);

const ktx2 = await encodeToKtx2({ type: ImageType.RGBA, data: new Uint8Array(px), width: W, height: H }, { mode: 'uastc', mipmaps: false });
writeFileSync(process.argv[2] + '/updown.ktx2', Buffer.from(ktx2));
console.log('wrote updown.png', png.length, 'and updown.ktx2', ktx2.length);
