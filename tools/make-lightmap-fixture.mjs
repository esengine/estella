// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regenerate the baked-light fixtures: a quad whose UV1 is its UV0 TRANSPOSED (and a
 * copy with a normal), a red|blue four-texel atlas, and one differing only by ROW,
 * written by `lightmapImage` as a bake is, so a loader reading v = 0 wrong mirrors it.
 *
 *   node tools/make-lightmap-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeMesh, packChannels, encodeLightmap, lightmapImage, MeshChannel, MeshChannelType }
  from '../sdk/dist/index.node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MESH = path.join(ROOT, 'fixtures', 'scenes', 'lightmap-quad.esmesh');
const MESH_LIT = path.join(ROOT, 'fixtures', 'scenes', 'lightmap-quad-lit.esmesh');
const ATLAS = path.join(ROOT, 'fixtures', 'scenes', 'lightmap-atlas.png');
const ROWS = path.join(ROOT, 'fixtures', 'scenes', 'lightmap-rows.png');

/** Wide enough that every gate point lands well inside the quad. */
const HALF = 80;
const POSITIONS = [
  [-HALF, -HALF, 0], [HALF, -HALF, 0], [HALF, HALF, 0], [-HALF, HALF, 0],
];
const UV0 = [[0, 0], [1, 0], [1, 1], [0, 1]];
/** (u, v) -> (v, u): the atlas's left-to-right becomes the quad's bottom-to-top. */
const UV1 = UV0.map(([u, v]) => [v, u]);

/** The quad, and the same quad carrying a normal: an imported model has one, and
 *  that is a different program for every material drawn on it. */
function quad(file, withNormal) {
  const { channels, vertexStride } = packChannels([
    { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    ...(withNormal ? [{ semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 }] : []),
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
    if (withNormal) view.setFloat32(base + at(MeshChannel.Normal) + 8, 1, true);
    view.setFloat32(base + at(MeshChannel.TexCoord0), UV0[i][0], true);
    view.setFloat32(base + at(MeshChannel.TexCoord0) + 4, UV0[i][1], true);
    view.setFloat32(base + at(MeshChannel.TexCoord1), UV1[i][0], true);
    view.setFloat32(base + at(MeshChannel.TexCoord1) + 4, UV1[i][1], true);
    for (let c = 0; c < 4; c++) view.setUint8(base + at(MeshChannel.Color) + c, 255);
  });

  writeFileSync(file, encodeMesh({
    channels, vertexStride, vertexCount: POSITIONS.length, vertices,
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    aabbMin: [-HALF, -HALF, 0], aabbMax: [HALF, HALF, 0],
  }));
}
quad(MESH, false);
quad(MESH_LIT, true);

/** Four texels, not two: every gate point then sits between two texels of ONE
 *  colour, so linear filtering cannot put the answer on a boundary. Irradiance,
 *  encoded the way a bake writes it. */
const TEXELS = [[1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, 1]];
const encoded = encodeLightmap(Float32Array.from(TEXELS.flat()), TEXELS.length);

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

/** An RGBA8 PNG of `width` x `height`, rows top first. */
function writePng(file, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]), Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)));
  }
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
writePng(ATLAS, TEXELS.length, 1, encoded);

/** Texel rows 0-1 (v below one half) red, rows 2-3 blue. Square, as a bake's
 *  atlas is, and repeated across so the rows are the only thing that differs. */
const SIDE = 4;
const rowsTexels = new Float32Array(SIDE * SIDE * 3);
for (let y = 0; y < SIDE; y++) {
  for (let x = 0; x < SIDE; x++) rowsTexels.set(y < SIDE / 2 ? [1, 0, 0] : [0, 0, 1], (y * SIDE + x) * 3);
}
writePng(ROWS, SIDE, SIDE, lightmapImage(encodeLightmap(rowsTexels, SIDE * SIDE), SIDE));

console.log(`wrote ${path.relative(ROOT, MESH)}, ${path.relative(ROOT, MESH_LIT)}, ${path.relative(ROOT, ATLAS)} and ${path.relative(ROOT, ROWS)}`);
