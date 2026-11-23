// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  water-ripple-gpu.mjs — the ripples the GPU steps are the wave equation RippleField steps, cell for cell.
 *
 * The water's ripples are stepped on the GPU (sdk/src/water/rippleGpu.ts) in passes over a float texture, which the Water shader draws
 * from and which is read back for Waters.rippleAt. RippleField is the same arithmetic on the CPU. This renders an ocean that keeps
 * ripples, disturbs it once the way a script does (Waters.disturb), steps it, takes the grid as read back (and the frame it is the state
 * after), and steps a RippleField through the same frames with the same disturbance: their heights must agree within the precision a
 * half float carries, RMS within RMS_TOL and every cell within MAX_TOL of the reference's peak.
 *
 *   node tools/water-ripple-gpu.mjs --write     writes the scene into fixtures/scenes/water-ripples/
 *   node tools/water-ripple-gpu.mjs [--backend webgpu] [--no-build]
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ROOT } from './lib/repo.mjs';
import { runElectron } from './lib/electronRun.mjs';
import { runTool } from './lib/runTool.mjs';

const DIR = path.join(ROOT, 'fixtures', 'scenes', 'water-ripples');
const N = 64, SIZE = 2000, SPEED = 600, DAMPING = 0.8, FOAM_FADE = 0.4;
/** The disturbance: x, z, radius, strength (a dip of 30 cm over 1.5 m). */
const DROP = [100, -50, 150, -30];
const STEPS = 40;
/** A half float holds about three decimal digits, and forty steps of the scheme carry its rounding along: measured 1.1% and 5.4%. */
const RMS_TOL = 0.02, MAX_TOL = 0.08;

let nextId = 0;
const ent = (name, components) => ({ id: nextId++, name, parent: null, children: [], visible: true, components });
const tf = (p, r) => ({ type: 'Transform', data: { position: { x: p[0], y: p[1], z: p[2] }, ...(r ? { rotation: r } : {}) } });

if (process.argv.includes('--write')) {
  const down = { x: Math.sin((-89.9 * Math.PI) / 360), y: 0, z: 0, w: Math.cos((-89.9 * Math.PI) / 360) };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, 'ocean.esscene'), JSON.stringify({ version: 4, name: 'water-ripples', entities: [
    ent('Camera', [tf([0, 2500, 0], down), { type: 'Camera', data: { projectionType: 0, fov: 50, nearPlane: 5, farPlane: 20000, isActive: true, priority: 0 } }]),
    ent('Sun', [tf([0, 0, 0], { x: -0.403, y: 0.2725, z: 0.1271, w: 0.8644 }), { type: 'Light', data: { type: 1, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 3, enabled: true } }]),
    ent('Zone', [tf([0, 0, 0]), { type: 'WaterZone', data: { sizeX: 4000, sizeZ: 4000, resolution: 128, waveLength: 600, surf: 0, ripples: N, rippleSize: SIZE,
      rippleSpeed: SPEED, rippleDamping: DAMPING, foamFade: FOAM_FADE, farDistance: false } }]),
    ent('Sea', [tf([0, 0, 0]), { type: 'WaterBody', data: { form: 0, waveHeight: 20, affectsTerrain: false } }]),
  ] }, null, 1) + '\n');
  console.log(`water-ripple-gpu: wrote the scene into ${path.relative(ROOT, DIR)}`);
  process.exit(0);
}

const backend = process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : 'webgl2';
if (!process.argv.includes('--no-build')) runTool('node', ['tools/render-host/build.mjs'], { cwd: ROOT, encoding: 'utf8' });
const work = mkdtempSync(path.join(tmpdir(), 'water-ripples-'));
let failed = false;
try {
  // The reference, built from the SDK's source as it stands.
  const reference = path.join(work, 'ripples.mjs');
  await build({ entryPoints: [path.join(ROOT, 'sdk/src/water/ripples.ts')], bundle: true, format: 'esm', platform: 'node', outfile: reference, logLevel: 'warning' });
  const { RippleField } = await import(pathToFileURL(reference).href);

  const r = runElectron(['tools/render-host/run.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 240000, env: {
    ESTELLA_VERIFY_HOST: 'engine', ESTELLA_VERIFY_TIMEOUT_MS: '200000', ESTELLA_VERIFY_BACKEND: backend,
    ESTELLA_VERIFY_SCENE: '/scenes/water-ripples/ocean.esscene', ESTELLA_VERIFY_W: '320', ESTELLA_VERIFY_H: '320',
    ESTELLA_VERIFY_STEPS: String(STEPS), ESTELLA_VERIFY_WARM: '1', ESTELLA_VERIFY_OUT: path.join(work, 'frame.png'),
    ESTELLA_VERIFY_WATER_DISTURB: JSON.stringify(DROP), ESTELLA_VERIFY_WATER_PROBE: '[[0,0]]' } });
  const text = `${r.stdout}${r.stderr}`;
  const at = Number(text.match(/\[verify:water-disturb\] (-?\d+)/)?.[1]);
  const gpu = JSON.parse(text.match(/\[verify:water-ripples\] (.*)/)?.[1] ?? 'null');
  if (!gpu || !(at > 0)) throw new Error(`no ripples read back (disturbance taken in frame ${at}):\n${text.slice(-2000)}`);

  const field = new RippleField(gpu.n, gpu.size);
  field.originX = gpu.originX;
  field.originZ = gpu.originZ;
  field.limit = gpu.limit;
  for (let frame = 1; frame <= gpu.frame; frame++) {
    if (frame === at) field.disturb(DROP[0], DROP[1], DROP[2], DROP[3]);
    field.step(1 / 60, SPEED, DAMPING, FOAM_FADE);
  }
  let squares = 0, worst = 0, peak = 0;
  for (let j = 0; j < gpu.n; j++) {
    for (let i = 0; i < gpu.n; i++) {
      const want = field.heightAt(gpu.originX + (i + 0.5) * field.cell, gpu.originZ + (j + 0.5) * field.cell);
      const e = gpu.heights[j * gpu.n + i] - want;
      squares += e * e;
      worst = Math.max(worst, Math.abs(e));
      peak = Math.max(peak, Math.abs(want));
    }
  }
  const rms = Math.sqrt(squares / (gpu.n * gpu.n));
  failed = !(peak > 0.5) || rms > RMS_TOL * peak || worst > MAX_TOL * peak;
  console.log(`${failed ? '✗' : '✓'} water-ripple-gpu (${backend}): disturbed in frame ${at}, read back after frame ${gpu.frame}; reference peak ${peak.toFixed(3)},`
    + ` GPU off it by ${(100 * rms / peak).toFixed(2)}% RMS (tolerance ${100 * RMS_TOL}%), ${(100 * worst / peak).toFixed(2)}% at most (tolerance ${100 * MAX_TOL}%)`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
process.exit(failed ? 1 : 0);
