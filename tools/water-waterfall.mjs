// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  water-waterfall.mjs — a Waterfall alone is drawn, ends where it should, and its water falls as gravity has it fall.
 *
 * A scene with a Waterfall and no other water (the water plugin's systems once stopped after the first frame there, and no sheet was
 * ever built), seen face on through an orthographic camera:
 *   - the sheet is drawn, and its foot is maxDrop under the lip, within FOOT_TOL pixels;
 *   - its pattern, which rides down with the water, moves down at g t where the water has fallen for t seconds, within SPEED_TOL, at
 *     two places down the fall (frames one sixtieth of a second apart, matched by blocks; the pattern made fine enough to match).
 *
 *   node tools/water-waterfall.mjs --write     writes the scene into fixtures/scenes/water-fall/
 *   node tools/water-waterfall.mjs [--backend webgpu] [--no-build]
 */
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { runElectron } from './lib/electronRun.mjs';
import { runTool } from './lib/runTool.mjs';
import { readPNG } from './lib/png.mjs';

const DIR = path.join(ROOT, 'fixtures', 'scenes', 'water-fall');
const LIP = 2000, SPEED = 500, MAX_DROP = 2500, SIZE = 600, HALF = 1500, CY = 800, G = 980;
/** Measured 99.6% and 98.2% of g t; the foot on its row. */
const SPEED_TOL = 0.08, FOOT_TOL = 3;

let nextId = 0;
const ent = (name, components) => ({ id: nextId++, name, parent: null, children: [], visible: true, components });
const tf = (p, r) => ({ type: 'Transform', data: { position: { x: p[0], y: p[1], z: p[2] }, ...(r ? { rotation: r } : {}) } });

if (process.argv.includes('--write')) {
  mkdirSync(DIR, { recursive: true });
  // The stock shader with short strands, so a block of the sheet is something to find again a frame later.
  writeFileSync(path.join(DIR, 'fine.esmaterial'), JSON.stringify({ version: '1.0', type: 'material', shader: 'builtin:waterfall', blendMode: 1, depthTest: true,
    depthWrite: false, cull: 0, properties: { u_run: 20, u_strands: 12, u_veil: 0.3 } }, null, 2) + '\n');
  writeFileSync(path.join(DIR, 'fall.esscene'), JSON.stringify({ version: 4, name: 'water-fall', entities: [
    // Looking along +z at the lip's face; the throw comes toward the camera.
    ent('Camera', [tf([0, CY, -5000], { x: 0, y: 1, z: 0, w: 0 }), { type: 'Camera', data: { projectionType: 1, orthoSize: HALF, nearPlane: 5, farPlane: 20000, isActive: true, priority: 0 } }]),
    ent('Sun', [tf([0, 0, 0], { x: -0.403, y: 0.2725, z: 0.1271, w: 0.8644 }), { type: 'Light', data: { type: 1, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 3, enabled: true } }]),
    ent('Fall', [tf([0, LIP, 0]), { type: 'Waterfall', data: { width: 800, speed: SPEED, flare: 0, sheets: 1, sheetGap: 90, maxDrop: MAX_DROP, rows: 128, across: 6 } },
      { type: 'MeshRenderer', data: { material: '/scenes/water-fall/fine.esmaterial', enabled: true } }]),
  ] }, null, 1) + '\n');
  console.log(`water-waterfall: wrote the scene into ${path.relative(ROOT, DIR)}`);
  process.exit(0);
}

const backend = process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : 'webgl2';
if (!process.argv.includes('--no-build')) runTool('node', ['tools/render-host/build.mjs'], { cwd: ROOT, encoding: 'utf8' });
const work = mkdtempSync(path.join(tmpdir(), 'water-fall-'));
const unit = (2 * HALF) / SIZE;
const rowOf = (y) => SIZE / 2 - (y - CY) / unit;

function shoot(steps) {
  const out = path.join(work, `fall${steps}.png`);
  const r = runElectron(['tools/render-host/run.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 240000, env: {
    ESTELLA_VERIFY_HOST: 'engine', ESTELLA_VERIFY_TIMEOUT_MS: '200000', ESTELLA_VERIFY_BACKEND: backend,
    ESTELLA_VERIFY_SCENE: '/scenes/water-fall/fall.esscene', ESTELLA_VERIFY_W: String(SIZE), ESTELLA_VERIFY_H: String(SIZE),
    ESTELLA_VERIFY_STEPS: String(steps), ESTELLA_VERIFY_OUT: out } });
  if (!/\[verify:render\] PASS/.test(`${r.stdout}${r.stderr}`)) throw new Error(`the fall did not render:\n${`${r.stdout}${r.stderr}`.slice(-2000)}`);
  return readPNG(readFileSync(out));
}
const lum = (img, x, y) => { const [r, g, b] = img.px(Math.round(x), Math.round(y)); return r + g + b; };
/** Where the block of `a` round (cx, cy) is in `b`, in pixels, to a fraction of one. */
function match(a, b, cx, cy, P = 24, R = 14) {
  let best = [Infinity, 0, 0];
  const cost = new Map();
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let s = 0;
      for (let y = -P / 2; y < P / 2; y++) for (let x = -P / 2; x < P / 2; x++) { const e = lum(a, cx + x, cy + y) - lum(b, cx + x + dx, cy + y + dy); s += e * e; }
      cost.set(`${dx},${dy}`, s);
      if (s < best[0]) best = [s, dx, dy];
    }
  }
  const sub = (k0, k1, k2) => { const d = k0 - 2 * k1 + k2; return d > 0 ? (0.5 * (k0 - k2)) / d : 0; };
  const [, bx, by] = best;
  return by + sub(cost.get(`${bx},${by - 1}`), cost.get(`${bx},${by}`), cost.get(`${bx},${by + 1}`));
}

let failed = 0;
try {
  const a = shoot(60), b = shoot(61);
  // The foot: the lowest row down the middle that is not background.
  let foot = -1;
  for (let y = SIZE - 1; y >= 0 && foot < 0; y--) if (lum(a, SIZE / 2, y) > 30) foot = y;
  const footOk = foot >= 0 && Math.abs(foot - rowOf(LIP - MAX_DROP)) <= FOOT_TOL;
  if (!footOk) failed++;
  console.log(`${footOk ? '✓' : '✗'} water-waterfall (${backend}) ${foot < 0 ? 'no sheet drawn' : `foot on row ${foot}, ${MAX_DROP} under the lip is row ${rowOf(LIP - MAX_DROP).toFixed(1)}`}`);
  if (foot >= 0) {
    for (const drop of [1000, 2000]) {
      const t = Math.sqrt((2 * drop) / G), want = G * t;
      const down = (match(a, b, SIZE / 2, rowOf(LIP - drop)) * unit) * 60;
      const ok = Math.abs(down / want - 1) <= SPEED_TOL;
      if (!ok) failed++;
      console.log(`${ok ? '✓' : '✗'} water-waterfall (${backend}) ${drop} under the lip, ${t.toFixed(3)} s down: the water's pattern falls at ${down.toFixed(0)},`
        + ` g t is ${want.toFixed(0)} (${(100 * down / want).toFixed(1)}%, tolerance ${100 * SPEED_TOL}%)`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
process.exit(failed ? 1 : 0);
