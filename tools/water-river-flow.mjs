// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  water-river-flow.mjs — a river runs at its Flow Speed along its course, and what is on it is carried at that speed.
 *
 * A straight river 30 km long and 5 km wide, its course 40 degrees off the x axis, Flow Speed 300: in the middle of it
 *   - Waters.sample's current (what carries a floating body) must be 300 along the course, within CURRENT_TOL;
 *   - a disturbance's rings, stepped on the GPU, must be carried with it: the middle of the rings (weighted by height squared) must
 *     have moved flow x time after the drop, within DRIFT_TOL of that distance and DIRECTION_TOL degrees of its heading. Without the
 *     current in the ripple passes they spread about the place they were dropped and this reads 0.
 *
 *   node tools/water-river-flow.mjs --write     writes the scene into fixtures/scenes/water-river/
 *   node tools/water-river-flow.mjs [--backend webgpu] [--no-build]
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { runElectron } from './lib/electronRun.mjs';
import { runTool } from './lib/runTool.mjs';

const DIR = path.join(ROOT, 'fixtures', 'scenes', 'water-river');
const SPEED = 300, HEADING = 40, STEPS = 40;
/** Measured 0.967 of the distance (the rings lag about a frame behind the current) and 0.1 degree. */
const CURRENT_TOL = 0.01, DRIFT_TOL = 0.06, DIRECTION_TOL = 3;

let nextId = 0;
const ent = (name, components) => ({ id: nextId++, name, parent: null, children: [], visible: true, components });
const tf = (p, r) => ({ type: 'Transform', data: { position: { x: p[0], y: p[1], z: p[2] }, ...(r ? { rotation: r } : {}) } });
const yaw = (HEADING * Math.PI) / 180;

if (process.argv.includes('--write')) {
  const down = { x: Math.sin((-89.9 * Math.PI) / 360), y: 0, z: 0, w: Math.cos((-89.9 * Math.PI) / 360) };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, 'river.esscene'), JSON.stringify({ version: 4, name: 'water-river', entities: [
    ent('Camera', [tf([0, 2500, 0], down), { type: 'Camera', data: { projectionType: 0, fov: 50, nearPlane: 5, farPlane: 20000, isActive: true, priority: 0 } }]),
    ent('Sun', [tf([0, 0, 0], { x: -0.403, y: 0.2725, z: 0.1271, w: 0.8644 }), { type: 'Light', data: { type: 1, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 3, enabled: true } }]),
    ent('Zone', [tf([0, 0, 0]), { type: 'WaterZone', data: { sizeX: 40000, sizeZ: 40000, resolution: 256, surf: 0, ripples: 64, rippleSize: 2000,
      rippleSpeed: 600, rippleDamping: 0.8, foamFade: 0.4, farDistance: false } }]),
    ent('River', [tf([0, 0, 0]), { type: 'Spline', data: { points: [-15000, 15000].map((s) => ({ x: s * Math.cos(yaw), y: 0, z: s * Math.sin(yaw), width: 5000 })), closed: false } },
      { type: 'WaterBody', data: { form: 2, flowSpeed: SPEED, waveHeight: 0, shoreWidth: 60, affectsTerrain: false } }]),
  ] }, null, 1) + '\n');
  console.log(`water-river-flow: wrote the scene into ${path.relative(ROOT, DIR)}`);
  process.exit(0);
}

const backend = process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : 'webgl2';
if (!process.argv.includes('--no-build')) runTool('node', ['tools/render-host/build.mjs'], { cwd: ROOT, encoding: 'utf8' });
const work = mkdtempSync(path.join(tmpdir(), 'water-river-'));
let failed = false;
try {
  const r = runElectron(['tools/render-host/run.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 240000, env: {
    ESTELLA_VERIFY_HOST: 'engine', ESTELLA_VERIFY_TIMEOUT_MS: '200000', ESTELLA_VERIFY_BACKEND: backend,
    ESTELLA_VERIFY_SCENE: '/scenes/water-river/river.esscene', ESTELLA_VERIFY_W: '320', ESTELLA_VERIFY_H: '320',
    ESTELLA_VERIFY_STEPS: String(STEPS), ESTELLA_VERIFY_WARM: '1', ESTELLA_VERIFY_OUT: path.join(work, 'frame.png'),
    ESTELLA_VERIFY_WATER_DISTURB: JSON.stringify([0, 0, 150, -30]), ESTELLA_VERIFY_WATER_PROBE: '[[0,0]]' } });
  const text = `${r.stdout}${r.stderr}`;
  const at = Number(text.match(/\[verify:water-disturb\] (-?\d+)/)?.[1]);
  const water = JSON.parse(text.match(/\[verify:water\] (.*)/)?.[1] ?? 'null');
  const grid = JSON.parse(text.match(/\[verify:water-ripples\] (.*)/)?.[1] ?? 'null');
  if (!water || !grid || !(at > 0)) throw new Error(`no current or ripples read back:\n${text.slice(-2000)}`);

  const want = [SPEED * Math.cos(yaw), SPEED * Math.sin(yaw)];
  const flow = water.flows[0];
  const currentOk = Math.hypot(flow[0] - want[0], flow[1] - want[1]) <= CURRENT_TOL * SPEED;

  const cell = grid.size / grid.n;
  let sw = 0, sx = 0, sz = 0;
  for (let j = 0; j < grid.n; j++) {
    for (let i = 0; i < grid.n; i++) {
      const w = grid.heights[j * grid.n + i] ** 2;
      sw += w; sx += w * (grid.originX + (i + 0.5) * cell); sz += w * (grid.originZ + (j + 0.5) * cell);
    }
  }
  // The drop goes in on frame `at` and every frame from it to the one read back steps the rings a sixtieth of a second along.
  const t = (grid.frame - at + 1) / 60;
  const moved = Math.hypot(sx / sw, sz / sw), expected = SPEED * t;
  const off = Math.abs((Math.atan2(sz / sw, sx / sw) * 180) / Math.PI - HEADING);
  const driftOk = sw > 0 && Math.abs(moved / expected - 1) <= DRIFT_TOL && off <= DIRECTION_TOL;
  failed = !currentOk || !driftOk;
  console.log(`${currentOk ? '✓' : '✗'} water-river-flow (${backend}) current (${flow[0].toFixed(1)}, ${flow[1].toFixed(1)}), want (${want[0].toFixed(1)}, ${want[1].toFixed(1)})`);
  console.log(`${driftOk ? '✓' : '✗'} water-river-flow (${backend}) rings moved ${moved.toFixed(1)} in ${t.toFixed(3)} s, ${(100 * moved / expected).toFixed(1)}% of the current's`
    + ` ${expected.toFixed(1)} (tolerance ${100 * DRIFT_TOL}%), ${off.toFixed(1)} degrees off its heading (tolerance ${DIRECTION_TOL})`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
process.exit(failed ? 1 : 0);
