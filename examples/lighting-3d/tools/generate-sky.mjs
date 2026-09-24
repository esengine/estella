// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The example's sky, written rather than photographed: a Radiance `.hdr`
 *        panorama of a clear day — a blue zenith, a warm horizon, the ground
 *        below, and a sun. It is looked at directly as well as lit by, so it is
 *        written at a resolution a viewport can magnify.
 *
 *   node examples/lighting-3d/tools/generate-sky.mjs [width]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = Number(process.argv[2]) || 1024;
const HEIGHT = WIDTH / 2;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'env', 'sky.hdr');

const ZENITH = [0.30, 0.45, 0.85];
const HORIZON = [0.83, 0.74, 0.61];
const GROUND = [0.39, 0.355, 0.30];
const NADIR = [0.23, 0.21, 0.18];
// As bright as it has to be for the irradiance the scene is lit by: a small disc
// carries its light in radiance, and the screen clips it to white either way.
const SUN = { elevation: 49, azimuth: 49, radius: 2.5, radiance: [357, 331, 283] };

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Radiance toward a direction, as the importer reads one: +Z at the centre, row 0 up. */
function radiance(dx, dy, dz) {
  const elevation = Math.asin(Math.max(-1, Math.min(1, dy))) * 180 / Math.PI;
  let c = elevation >= 0
    ? mix(ZENITH, HORIZON, (1 - elevation / 90) ** 3.2)
    : mix(GROUND, NADIR, (-elevation / 90) ** 0.5);
  const se = SUN.elevation * Math.PI / 180, sa = SUN.azimuth * Math.PI / 180;
  const sun = [Math.sin(sa) * Math.cos(se), Math.sin(se), Math.cos(sa) * Math.cos(se)];
  const angle = Math.acos(Math.max(-1, Math.min(1, dx * sun[0] + dy * sun[1] + dz * sun[2]))) * 180 / Math.PI;
  // A disc with a soft limb, then a glow that fades over a few degrees.
  const disc = Math.max(0, Math.min(1, (SUN.radius + 0.5 - angle) / 1.0));
  const glow = Math.exp(-angle / 6) * 0.35;
  c = c.map((v, i) => v + SUN.radiance[i] * disc + v * glow);
  return c;
}

function rgbe([r, g, b]) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) return [0, 0, 0, 0];
  const e = Math.ceil(Math.log2(m) + 1e-9);
  const scale = 256 / 2 ** e;
  return [Math.min(255, Math.floor(r * scale)), Math.min(255, Math.floor(g * scale)),
          Math.min(255, Math.floor(b * scale)), e + 128];
}

/** One scanline in the adaptive-RLE encoding: each channel apart, runs where they repeat. */
function encodeScanline(pixels) {
  const out = [2, 2, (WIDTH >> 8) & 0xff, WIDTH & 0xff];
  for (let c = 0; c < 4; c++) {
    const ch = pixels.map((p) => p[c]);
    let i = 0;
    while (i < WIDTH) {
      let run = 1;
      while (i + run < WIDTH && run < 127 && ch[i + run] === ch[i]) run++;
      if (run >= 4) {
        out.push(128 + run, ch[i]);
        i += run;
        continue;
      }
      let lit = 0;
      while (i + lit < WIDTH && lit < 128) {
        const j = i + lit;
        if (j + 3 < WIDTH && ch[j] === ch[j + 1] && ch[j] === ch[j + 2] && ch[j] === ch[j + 3]) break;
        lit++;
      }
      out.push(lit, ...ch.slice(i, i + lit));
      i += lit;
    }
  }
  return out;
}

const header = `#?RADIANCE\n# generated for estella examples/lighting-3d (tools/generate-sky.mjs)\nFORMAT=32-bit_rle_rgbe\n\n-Y ${HEIGHT} +X ${WIDTH}\n`;
const body = [];
for (let y = 0; y < HEIGHT; y++) {
  const theta = (y + 0.5) / HEIGHT * Math.PI;
  const row = [];
  for (let x = 0; x < WIDTH; x++) {
    const phi = ((x + 0.5) / WIDTH - 0.5) * 2 * Math.PI;
    row.push(rgbe(radiance(Math.sin(phi) * Math.sin(theta), Math.cos(theta), Math.cos(phi) * Math.sin(theta))));
  }
  body.push(...encodeScanline(row));
}
writeFileSync(OUT, Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(body)]));
console.log(`${path.relative(process.cwd(), OUT)}: ${WIDTH}x${HEIGHT}`);
