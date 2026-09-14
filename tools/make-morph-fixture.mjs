// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regenerate the morph-target fixture: one quad, and one shape that moves the
 * WHOLE of it a hundred units right. That much on purpose — a target that
 * nudges a vertex passes whether or not the deltas reached the GPU.
 *
 *   node tools/make-morph-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeMesh, packChannels, MeshChannel, MeshChannelType } from '../sdk/dist/index.node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'fixtures', 'scenes', 'morph-quad.esmesh');

/** Centred on (-50, 0) so the authored shape sits in the frame's left half. */
const POSITIONS = [
  [-70, -20, 0], [-30, -20, 0], [-30, 20, 0], [-70, 20, 0],
];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const SHIFT = 100;

const { channels, vertexStride } = packChannels([
  { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
  { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
  { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
]);

const vertices = new Uint8Array(POSITIONS.length * vertexStride);
const view = new DataView(vertices.buffer);
POSITIONS.forEach((p, i) => {
  const at = i * vertexStride;
  for (let c = 0; c < 3; c++) view.setFloat32(at + channels[0].offset + c * 4, p[c], true);
  view.setFloat32(at + channels[1].offset, UVS[i][0], true);
  view.setFloat32(at + channels[1].offset + 4, UVS[i][1], true);
  for (let c = 0; c < 4; c++) view.setUint8(at + channels[2].offset + c, 255);
});

const deltas = new Float32Array(POSITIONS.length * 3);
for (let i = 0; i < POSITIONS.length; i++) deltas[i * 3] = SHIFT;

writeFileSync(OUT, encodeMesh({
  channels, vertexStride, vertexCount: POSITIONS.length, vertices,
  indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  aabbMin: [-70, -20, 0], aabbMax: [-30, 20, 0],
  morph: { names: ['Shift'], hasNormals: false, deltas },
}));
console.log(`wrote ${path.relative(ROOT, OUT)}`);
