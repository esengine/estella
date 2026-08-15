// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Writes public/scenes/two-triangles.esmesh — the fixture behind the
 *        `mesh-asset` pixel gate.
 *
 * The geometry is the one scenes/mesh2d.esscene inlines, so the gate can assert
 * the SAME points: a file that draws what the inline payload draws is the whole
 * claim, and it would not be one if the two were different shapes. Written by
 * the engine's own encoder, so the fixture cannot encode a format the loader
 * does not read.
 *
 *   node scripts/make-mesh-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshChannel, MeshChannelType, packChannels, encodeMesh } from 'esengine';

const positions = [-200, -100, -40, -100, -120, 100, 40, -100, 200, -100, 120, 100];
const colors = [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1], [0, 1, 0, 1], [0, 1, 0, 1], [0, 1, 0, 1]];
const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);

const { channels, vertexStride } = packChannels([
  { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
  { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
  { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
]);

const count = positions.length / 2;
const vertices = new Uint8Array(count * vertexStride);
const view = new DataView(vertices.buffer);
const min = [Infinity, Infinity, 0];
const max = [-Infinity, -Infinity, 0];
for (let i = 0; i < count; i++) {
  const base = i * vertexStride;
  const x = positions[i * 2];
  const y = positions[i * 2 + 1];
  view.setFloat32(base + channels[0].offset, x, true);
  view.setFloat32(base + channels[0].offset + 4, y, true);
  view.setFloat32(base + channels[0].offset + 8, 0, true);
  view.setFloat32(base + channels[1].offset, 0, true);
  view.setFloat32(base + channels[1].offset + 4, 0, true);
  const c = colors[i];
  for (let k = 0; k < 4; k++) view.setUint8(base + channels[2].offset + k, Math.round(c[k] * 255));
  min[0] = Math.min(min[0], x);
  min[1] = Math.min(min[1], y);
  max[0] = Math.max(max[0], x);
  max[1] = Math.max(max[1], y);
}

const bytes = encodeMesh({
  channels, vertexStride, vertexCount: count, vertices, indices, aabbMin: min, aabbMax: max,
});
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
                         '..', 'public', 'scenes', 'two-triangles.esmesh');
writeFileSync(out, bytes);
console.log(`${path.basename(out)}: ${bytes.byteLength} bytes, stride ${vertexStride}, ${channels.length} channels`);
