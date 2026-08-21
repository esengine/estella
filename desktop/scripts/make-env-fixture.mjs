// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Writes the two sources behind the environment render gates, then imports
 *        them through the shipped tools.
 *
 * The panorama is generated rather than checked in as a photograph: a gate has to
 * state what a pixel should be, and only a sky whose halves are two flat colours
 * lets it. Sky above, ground below, and a bright patch at +Z — the direction a
 * head-on surface reflects, which is what tells a mirror from a flat term.
 *
 *   node scripts/make-env-fixture.mjs
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scenes = path.join(HERE, '..', '..', 'fixtures', 'scenes');
const cli = path.join(HERE, '..', '..', 'pipeline', 'bin', 'estella.mjs');

const W = 64;
const H = 32;

/** Radiance RGBE, flat encoding. The run marker is (1,1,1,n), so no pixel here
 *  may encode to that — none does: every colour below has a zero channel. */
function radianceHdr(pixel) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`);
  const body = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pixel(x, y);
      const peak = Math.max(r, g, b);
      let e = 0;
      let scale = 0;
      if (peak > 1e-9) {
        e = Math.ceil(Math.log2(peak)) + 128;
        scale = 256 / Math.pow(2, e - 128);
      }
      const at = (y * W + x) * 4;
      body[at] = Math.min(255, Math.floor(r * scale));
      body[at + 1] = Math.min(255, Math.floor(g * scale));
      body[at + 2] = Math.min(255, Math.floor(b * scale));
      body[at + 3] = e;
    }
  }
  return Buffer.concat([header, body]);
}

writeFileSync(path.join(scenes, 'studio.hdr'), radianceHdr((x, y) => {
  // The green patch spans the equator at the image centre, so a mirror facing the
  // camera sees it while the two hemispheres stay the diffuse claim.
  if (Math.abs(x - W / 2) < 5 && Math.abs(y - H / 2) < 5) return [0, 0.9, 0];
  return y < H / 2 ? [0, 0, 0.6] : [0.6, 0, 0];
}));

// Two coplanar triangles facing the camera, one white colour, NORMALS pointing up
// and down. Only a shader reading an environment by direction can tell the halves
// apart — a flat ambient term draws them identically.
const positions = new Float32Array([
  -200, -100, 0, -40, -100, 0, -120, 100, 0,
  40, -100, 0, 200, -100, 0, 120, 100, 0,
]);
const normals = new Float32Array([
  0, 1, 0, 0, 1, 0, 0, 1, 0,
  0, -1, 0, 0, -1, 0, 0, -1, 0,
]);
const colors = new Float32Array(24).fill(1);
const indices = new Uint16Array([0, 1, 2, 3, 4, 5]);
const buffer = Buffer.concat([positions, normals, colors, indices].map(
  (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));

writeFileSync(path.join(scenes, 'env-triangles.gltf'), `${JSON.stringify({
  asset: { version: '2.0', generator: 'estella test fixture' },
  buffers: [{
    byteLength: buffer.byteLength,
    uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
  }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
    { buffer: 0, byteOffset: 72, byteLength: normals.byteLength },
    { buffer: 0, byteOffset: 144, byteLength: colors.byteLength },
    { buffer: 0, byteOffset: 240, byteLength: indices.byteLength },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 6, type: 'VEC3',
      min: [-200, -100, 0], max: [200, 100, 0] },
    { bufferView: 1, componentType: 5126, count: 6, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: 6, type: 'VEC4' },
    { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
  ],
  meshes: [{
    name: 'EnvTriangles',
    primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, mode: 4 }],
  }],
  nodes: [{ mesh: 0 }],
  scenes: [{ nodes: [0] }],
  scene: 0,
}, null, 1)}\n`);

for (const [command, source, ...extra] of [
  ['import-gltf', 'env-triangles.gltf'],
  // A small face keeps the checked-in atlas small; the gate probes flat regions,
  // where the prefilter's resolution is not what it is measuring.
  ['import-hdr', 'studio.hdr', '--face-size', '32'],
]) {
  const run = spawnSync(process.execPath,
    [cli, command, path.join(scenes, source), '--project', path.join(HERE, '..', 'public'),
     ...extra], {
      stdio: 'inherit',
      cwd: path.join(HERE, '..', '..'),
    });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
