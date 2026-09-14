// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regenerate the baked-light fixture: one quad with TWO UV sets, and a four-texel
 * atlas, red half then blue half. The second UV set is the TRANSPOSE of the first,
 * so a bake read through the wrong channel comes out turned ninety degrees.
 *
 *   node tools/make-lightmap-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeMesh, packChannels, MeshChannel, MeshChannelType } from '../sdk/dist/index.node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MESH = path.join(ROOT, 'fixtures', 'scenes', 'lightmap-quad.esmesh');
const ATLAS = path.join(ROOT, 'fixtures', 'scenes', 'lightmap-atlas.png');

/** Wide enough that every gate point lands well inside the quad. */
const HALF = 80;
const POSITIONS = [
  [-HALF, -HALF, 0], [HALF, -HALF, 0], [HALF, HALF, 0], [-HALF, HALF, 0],
];
const UV0 = [[0, 0], [1, 0], [1, 1], [0, 1]];
/** (u, v) -> (v, u): the atlas's left-to-right becomes the quad's bottom-to-top. */
const UV1 = UV0.map(([u, v]) => [v, u]);

const { channels, vertexStride } = packChannels([
  { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
  { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
  { semantic: MeshChannel.TexCoord1, components: 2, type: MeshChannelType.Float32 },
  { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
]);
const at = (semantic) => channels.find((c) => c.semantic === semantic).offset;

const vertices = new Uint8Array(POSITIONS.length * vertexStride);
const view = new DataView(vertices.buffer);
POSITIONS.forEach((p, i) => {
  const base = i * vertexStride;
  for (let c = 0; c < 3; c++) view.setFloat32(base + at(MeshChannel.Position) + c * 4, p[c], true);
  view.setFloat32(base + at(MeshChannel.TexCoord0), UV0[i][0], true);
  view.setFloat32(base + at(MeshChannel.TexCoord0) + 4, UV0[i][1], true);
  view.setFloat32(base + at(MeshChannel.TexCoord1), UV1[i][0], true);
  view.setFloat32(base + at(MeshChannel.TexCoord1) + 4, UV1[i][1], true);
  for (let c = 0; c < 4; c++) view.setUint8(base + at(MeshChannel.Color) + c, 255);
});

writeFileSync(MESH, encodeMesh({
  channels, vertexStride, vertexCount: POSITIONS.length, vertices,
  indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  aabbMin: [-HALF, -HALF, 0], aabbMax: [HALF, HALF, 0],
}));

/** Four texels, not two: every gate point then sits between two texels of ONE
 *  colour, so linear filtering cannot put the answer on a boundary. */
const TEXELS = [[255, 0, 0], [255, 0, 0], [0, 0, 255], [0, 0, 255]];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(TEXELS.length, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;    // bit depth
ihdr[9] = 6;    // RGBA
const raw = Buffer.concat([
  Buffer.from([0]),  // filter: none
  ...TEXELS.map(([r, g, b]) => Buffer.from([r, g, b, 255])),
]);
writeFileSync(ATLAS, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]));

console.log(`wrote ${path.relative(ROOT, MESH)} and ${path.relative(ROOT, ATLAS)}`);
