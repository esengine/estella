// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  water-surface-height.mjs — the waves drawn stand where Waters.sample says they do, at the same instant.
 *
 * A floating body is held up by Waters.sample (the CPU's sum of the wave set), while the surface is drawn by the Water shader's vertex
 * code: if the two drift apart in shape, height or time, a boat floats above or sinks into the waves it is drawn on. This draws an ocean
 * through a slice: a camera DIST away looking level, its near plane cut at z = Z0, and an unlit red wall just behind it, so what is not
 * wall in a column is the surface at z = Z0. The first row from the top that is not the wall's red is the drawn height there; the
 * host prints what Waters.sample says at the same points at the instant of that frame. They must agree within RMS_TOL and with no
 * bias past BIAS_TOL; the zone keeps its default mesh and waves. The camera is moved along x between runs, so the tiles fall
 * differently each time. The underwater effect is off: it draws a waterline of its own across the lens, which is not the mesh.
 *
 *   node tools/water-surface-height.mjs --write     writes the scenes into fixtures/scenes/water-surface/
 *   node tools/water-surface-height.mjs [--backend webgpu] [--no-build]
 */
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { runElectron } from './lib/electronRun.mjs';
import { runTool } from './lib/runTool.mjs';
import { readPNG } from './lib/png.mjs';

const DIR = path.join(ROOT, 'fixtures', 'scenes', 'water-surface');
const W = 1200, H = 600, HALF = 150, EYE_Y = 100, Z0 = 137, DIST = 400, SLAB = 1;
const WAVE_HEIGHT = 40;
/** Measured 0.5 to 1.2 RMS and -0.5 to 1.1 bias. Sampling every wave the set has, as Waters.sample did before it faded the ones the
 *  mesh cannot draw, stands 6.9 above the drawn surface on average with this zone's mesh. */
const RMS_TOL = 2.5, BIAS_TOL = 2;
/** Camera x and steps (1/60 s each) per run. */
const RUNS = [[0, 30], [300, 30], [-500, 240]];

let nextId = 0;
const ent = (name, components) => ({ id: nextId++, name, parent: null, children: [], visible: true, components });
const tf = (p, s) => ({ type: 'Transform', data: { position: { x: p[0], y: p[1], z: p[2] }, ...(s ? { scale: { x: s[0], y: s[1], z: s[2] } } : {}) } });

function sceneFor(camX) {
  nextId = 0;
  return { version: 4, name: `water-surface-${camX}`, entities: [
    ent('Camera', [tf([camX, EYE_Y, Z0 + DIST]), { type: 'Camera', data: { projectionType: 0, fov: (2 * Math.atan(HALF / DIST) * 180) / Math.PI, nearPlane: DIST - SLAB, farPlane: 6000, isActive: true, priority: 0 } }]),
    ent('Sun', [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, rotation: { x: -0.403, y: 0.2725, z: 0.1271, w: 0.8644 } } }, { type: 'Light', data: { type: 1, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 6, enabled: true } }]),
    // builtin:cube is a metre (100 world units) on a side: the wall is one unit thick, its face at Z0 - SLAB.
    ent('Wall', [tf([camX, 0, Z0 - SLAB - 0.5], [4000, 2000, 0.01]), { type: 'MeshRenderer', data: { mesh: 'builtin:cube', color: { r: 1, g: 0, b: 0, a: 1 }, lit: false, opaque: true, enabled: true } }]),
    // Edge Softness 0: the soft edge fades water that stands this near a solid to nothing.
    ent('Zone', [tf([0, 0, 0]), { type: 'WaterZone', data: { sizeX: 4000, sizeZ: 4000, resolution: 256, material: '/scenes/water-surface/hard.esmaterial', waveSpeed: 1, waveDirection: 30, surf: 0, ripples: 0, farDistance: false } }]),
    // The underwater effect off: it draws its own waterline across the lens, from the baked surface, and that line is not the mesh.
    ent('Sea', [tf([0, 0, 0]), { type: 'WaterBody', data: { form: 0, waveHeight: WAVE_HEIGHT, affectsTerrain: false, underwaterEnabled: false } }]),
  ] };
}

if (process.argv.includes('--write')) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, 'hard.esmaterial'), JSON.stringify({ version: '1.0', type: 'material', shader: 'builtin:water', blendMode: 0, depthTest: true, depthWrite: true, cull: 0, properties: { u_edgeSoftness: 0 } }, null, 2) + '\n');
  for (const [camX] of RUNS) writeFileSync(path.join(DIR, `slice${camX}.esscene`), JSON.stringify(sceneFor(camX), null, 1) + '\n');
  console.log(`water-surface-height: wrote ${RUNS.length} scenes into ${path.relative(ROOT, DIR)}`);
  process.exit(0);
}

const backend = process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : 'webgl2';
if (!process.argv.includes('--no-build')) runTool('node', ['tools/render-host/build.mjs'], { cwd: ROOT, encoding: 'utf8' });
const work = mkdtempSync(path.join(tmpdir(), 'water-surface-'));
let failed = 0;
try {
  for (const [camX, steps] of RUNS) {
    const columns = [];
    for (let c = 10; c < W; c += 20) columns.push(c);
    const worldX = (c) => camX + ((c + 0.5) / W * 2 - 1) * HALF * (W / H);
    const out = path.join(work, `slice${camX}.png`);
    const r = runElectron(['tools/render-host/run.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 240000, env: {
      ESTELLA_VERIFY_HOST: 'engine', ESTELLA_VERIFY_TIMEOUT_MS: '200000', ESTELLA_VERIFY_BACKEND: backend,
      ESTELLA_VERIFY_SCENE: `/scenes/water-surface/slice${camX}.esscene`, ESTELLA_VERIFY_W: String(W), ESTELLA_VERIFY_H: String(H),
      ESTELLA_VERIFY_STEPS: String(steps), ESTELLA_VERIFY_WARM: '1', ESTELLA_VERIFY_OUT: out,
      ESTELLA_VERIFY_WATER_PROBE: JSON.stringify(columns.map((c) => [worldX(c), Z0])) } });
    const text = `${r.stdout}${r.stderr}`;
    const probe = text.match(/\[verify:water\] (.*)/);
    if (!probe) throw new Error(`slice${camX} did not render:\n${text.slice(-2000)}`);
    const water = JSON.parse(probe[1]);
    const img = readPNG(readFileSync(out));
    const errors = [];
    columns.forEach((c, i) => {
      let top = -1;
      for (let y = 0; y < H && top < 0; y++) { const [red, g, b] = img.px(c, y); if (!(red >= 253 && g <= 2 && b <= 2)) top = y; }
      if (top >= 0 && water.heights[i] != null) errors.push(EYE_Y + (0.5 - (top + 0.5) / H) * 2 * HALF - water.heights[i]);
    });
    const bias = errors.reduce((s, e) => s + e, 0) / Math.max(errors.length, 1);
    const rms = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / Math.max(errors.length, 1));
    const ok = errors.length >= columns.length * 0.9 && rms <= RMS_TOL && Math.abs(bias) <= BIAS_TOL;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} water-surface-height (${backend}) camera x ${camX}, t ${water.time.toFixed(3)} s: ${errors.length}/${columns.length} columns,`
      + ` drawn minus sampled ${bias.toFixed(2)} on average (tolerance ${BIAS_TOL}), ${rms.toFixed(2)} RMS (tolerance ${RMS_TOL}), waves ${2 * WAVE_HEIGHT} high`);
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
process.exit(failed ? 1 : 0);
