// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  water-caustic-energy.mjs — caustics move the sun's light about the floor and add none.
 *
 * A wavy surface focuses light into threads and leaves gaps between them, but the floor under it takes as much light on average as under
 * flat water. This renders the same floor with caustics on and off (the material's strength 1 and 0) and compares their mean light and their
 * contrast, inside the measured caustic window and past it, where the receivers take the procedural pattern instead:
 *   - the mean ratio on/off must be 1 within MEAN_TOL in both regions;
 *   - the pattern past the window must be about as strong as the measured one (the ratio of their standard deviations within CONTRAST_TOL),
 *     or the edge of the window shows as a square once a tone map averages the two differently.
 * Measured in LINEAR light, no tone map, with a sun dim enough that no thread reaches 1: a tone map squashes bright threads more than dark
 * gaps, and through one this measured a 4 to 9% 'loss' that was not there.
 *
 *   node tools/water-caustic-energy.mjs --write     writes the scenes into fixtures/scenes/water-energy/
 *   node tools/water-caustic-energy.mjs [--backend webgpu] [--no-build]
 */
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { runElectron } from './lib/electronRun.mjs';
import { runTool } from './lib/runTool.mjs';
import { readPNG } from './lib/png.mjs';

const DIR = path.join(ROOT, 'fixtures', 'scenes', 'water-energy');
const SIZE = 480;
const MEAN_TOL = 0.025;
/** Past the window the box is as wide as the floor and still holds only a few hundred of the pattern's cells: its mean is uncertain by about
 *  3%. The fault this guards against measured 8% (calm) and 17% (waves). */
const FAR_MEAN_TOL = 0.04;
const CONTRAST_TOL = [0.7, 1.4];
/** The cases: calm water (ripples only) and waves of 20 cm on a 6 m length. */
const CASES = [{ name: 'calm', waveHeight: 0 }, { name: 'waves', waveHeight: 20 }];

const q = (pitchDeg) => { const h = (pitchDeg * Math.PI) / 360; return { x: Math.sin(h), y: 0, z: 0, w: Math.cos(h) }; };
const roll = (deg) => { const h = (deg * Math.PI) / 360; return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) }; };
let nextId = 0;
const ent = (name, components) => ({ id: nextId++, name, parent: null, children: [], visible: true, components });
const tf = (p, r, s) => ({ type: 'Transform', data: { position: { x: p[0], y: p[1], z: p[2] }, ...(r ? { rotation: r } : {}), ...(s ? { scale: { x: s[0], y: s[1], z: s[2] } } : {}) } });

/** A floor sloping from the shore under 4 m of water, an ocean over it, seen straight down from 30 m with a 60 degree lens. */
function sceneFor(waveHeight, strength) {
  nextId = 0;
  const slope = (Math.atan(410 / 3000) * 180) / Math.PI;
  return { version: 4, name: `water-energy-${waveHeight}-${strength}`, entities: [
    ent('Camera', [tf([0, 3000, 0], q(-89.9)), { type: 'Camera', data: { projectionType: 0, fov: 60, nearPlane: 5, farPlane: 20000, isActive: true, priority: 0 } },
      { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects: [{ type: 'skyAtmosphere', enabled: true, uniforms: { u_intensity: 1, u_haze: 0.6, u_sunBrightness: 30, u_clouds: 0, u_unitsPerKm: 100000 } }] } }]),
    ent('Sun', [tf([0, 0, 0], { x: -0.4030, y: 0.2725, z: 0.1271, w: 0.8644 }), { type: 'Light', data: { type: 1, color: { r: 1, g: 0.96, b: 0.9, a: 1 }, intensity: 0.25, meshShadows: true, shadowExtent: 6000, enabled: true } }]),
    ent('Floor', [tf([0, -200, 0], roll(-slope), [32, 1, 32]), { type: 'MeshRenderer', data: { mesh: 'builtin:plane', color: { r: 0.42, g: 0.37, b: 0.28, a: 1 }, lit: true, opaque: true, enabled: true, castShadows: true } }]),
    ent('Zone', [tf([0, 0, 0]), { type: 'WaterZone', data: { sizeX: 4000, sizeZ: 4000, resolution: 256, material: `/scenes/water-energy/strength-${strength}.esmaterial`, waveLength: 600, waveSpeed: 1, waveDirection: 30, surf: 0, ripples: 0, farDistance: false, cellSize: 20, cells: 64, rings: 6 } }]),
    ent('Sea', [tf([0, 0, 0]), { type: 'WaterBody', data: { form: 0, waveHeight, shoreWidth: 150, affectsTerrain: false } }]),
  ] };
}
const sceneName = (c, strength) => `${c.name}-${strength}`;

if (process.argv.includes('--write')) {
  mkdirSync(DIR, { recursive: true });
  for (const strength of [0, 1]) {
    writeFileSync(path.join(DIR, `strength-${strength}.esmaterial`), JSON.stringify({ version: '1.0', type: 'material', shader: 'builtin:water', blendMode: 0, depthTest: true, depthWrite: true, cull: 0, properties: { u_causticStrength: strength } }, null, 2) + '\n');
    for (const c of CASES) writeFileSync(path.join(DIR, `${sceneName(c, strength)}.esscene`), JSON.stringify(sceneFor(c.waveHeight, strength), null, 1) + '\n');
  }
  console.log(`water-caustic-energy: wrote ${CASES.length * 2} scenes into ${path.relative(ROOT, DIR)}`);
  process.exit(0);
}

const backend = process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : 'webgl2';
if (!process.argv.includes('--no-build')) runTool('node', ['tools/render-host/build.mjs'], { cwd: ROOT, encoding: 'utf8' });
const work = mkdtempSync(path.join(tmpdir(), 'water-energy-'));

/** The frame's linear luminance at every pixel of a box (fractions of the frame). */
function shoot(name) {
  const out = path.join(work, `${name}.png`);
  const r = runElectron(['tools/render-host/run.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 240000, env: {
    ESTELLA_VERIFY_HOST: 'engine', ESTELLA_VERIFY_TIMEOUT_MS: '200000', ESTELLA_VERIFY_BACKEND: backend, ESTELLA_VERIFY_COLORSPACE: 'linear',
    ESTELLA_VERIFY_SCENE: `/scenes/water-energy/${name}.esscene`, ESTELLA_VERIFY_W: String(SIZE), ESTELLA_VERIFY_H: String(SIZE),
    ESTELLA_VERIFY_STEPS: '30', ESTELLA_VERIFY_WARM: '1', ESTELLA_VERIFY_OUT: out } });
  if (!/\[verify:render\] PASS/.test(`${r.stdout}${r.stderr}`)) throw new Error(`${name} did not render:\n${(r.stdout || '') + (r.stderr || '')}`.slice(0, 2000));
  return readPNG(readFileSync(out));
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function region(on, off, [x0, x1, y0, y1]) {
  const ratios = [];
  let a = 0, b = 0;
  for (let y = Math.round(y0 * SIZE); y < Math.round(y1 * SIZE); y++) {
    for (let x = Math.round(x0 * SIZE); x < Math.round(x1 * SIZE); x++) {
      const l = (img) => { const [r, g, bl] = img.px(x, y); return (lin(r) + lin(g) + lin(bl)) / 3; };
      const p = l(on), s = l(off);
      a += p; b += s; ratios.push(p / Math.max(s, 1e-5));
    }
  }
  const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  const std = Math.sqrt(ratios.reduce((s, v) => s + (v - mean) ** 2, 0) / ratios.length);
  return { ratio: a / b, std };
}
// Frame fractions: the window (18 m in a 38 m view) spans 0.26..0.74; the measured box is its middle, as toward its border the bake runs
// short of light carried in from outside it (0.986 over 0.40..0.60, 0.970 over 0.31..0.69). Past it the box is as wide as the floor:
// a smaller one averages too few of the pattern's 86-unit cells, and its mean wanders by several percent with no bias.
const BAKED = [0.40, 0.60, 0.40, 0.60];
const FALLBACK = [0.77, 0.91, 0.10, 0.90];

let failed = 0;
try {
  for (const c of CASES) {
    const on = shoot(sceneName(c, 1)), off = shoot(sceneName(c, 0));
    const baked = region(on, off, BAKED), fallback = region(on, off, FALLBACK);
    const contrast = fallback.std / Math.max(baked.std, 1e-4);
    const ok = Math.abs(baked.ratio - 1) <= MEAN_TOL && Math.abs(fallback.ratio - 1) <= FAR_MEAN_TOL
      && (baked.std < 0.02 || (contrast >= CONTRAST_TOL[0] && contrast <= CONTRAST_TOL[1]));
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${c.name.padEnd(6)} (${backend}) mean ratio: measured ${baked.ratio.toFixed(3)}, past the window ${fallback.ratio.toFixed(3)};`
      + ` contrast ${baked.std.toFixed(3)} vs ${fallback.std.toFixed(3)} (x${contrast.toFixed(2)})`);
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
process.exit(failed ? 1 : 0);
