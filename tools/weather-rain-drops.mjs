// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  weather-rain-drops.mjs — the 3D rain falls in the world: down the picture seen level, out from the middle seen from above, and
 *        not under a roof.
 *
 * Rain was once streaks painted on the screen, straight down the picture whichever way the camera looked: seen from above, falling
 * rain was vertical lines across the ground. The drops are now streaks in the world (sdk/src/postprocess/rainDrops.ts). Under a
 * Weather that drives only the rain, over a ground with a roof standing over part of it:
 *   - seen level, a streak runs down the picture: the mean |cos| between a streak's own direction and the vertical beats the same
 *     against the horizontal by LEVEL_MARGIN (thin streaks a pixel wide measure about 0.8 against the vertical, not 1);
 *   - seen straight down, a streak runs out from the middle of the picture (where the rain falls away from the eye): the same streaks
 *     line up with the line to the middle better than with the picture's vertical, by DOWN_MARGIN (streaks painted down the screen
 *     do the opposite);
 *   - under the roof, looking up at it, no drop falls between the eye and the roof (none of its streak pixels, where with no roof the
 *     same view has more than OPEN_MIN);
 *   - snow (the weather's Snow) falls as flakes, not streaks: seen level, what moves has no direction down the picture to speak of
 *     (its mean |cos| against the vertical beats the horizontal's by less than FLAKE_MARGIN, where rain's beats it by LEVEL_MARGIN);
 *     and none falls under the roof either, where with none the view has more than OPEN_MIN.
 * A streak pixel is one brighter by more than STREAK_STEP than the next frame (what stands still cancels: the horizon, the ground;
 * where a streak or a flake went is darker, so only where it was is kept); a streak's direction is the principal axis of the streak pixels within RADIUS of it, where they make a line.
 *
 *   node tools/weather-rain-drops.mjs --write     writes the scenes into fixtures/scenes/weather-rain/
 *   node tools/weather-rain-drops.mjs [--backend webgpu] [--no-build]
 */
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { runElectron } from './lib/electronRun.mjs';
import { runTool } from './lib/runTool.mjs';
import { readPNG } from './lib/png.mjs';

const DIR = path.join(ROOT, 'fixtures', 'scenes', 'weather-rain');
const W = 640, H = 400, STREAK_STEP = 30, RADIUS = 8;
const LEVEL_MARGIN = 0.25, DOWN_MARGIN = 0.1, OPEN_MIN = 200, FLAKE_MARGIN = 0.15;

let nextId = 0;
const ent = (name, components) => ({ id: nextId++, name, parent: null, children: [], visible: true, components });
const tf = (p, r, s) => ({ type: 'Transform', data: { position: { x: p[0], y: p[1], z: p[2] }, ...(r ? { rotation: r } : {}), ...(s ? { scale: { x: s[0], y: s[1], z: s[2] } } : {}) } });
const pitch = (deg) => ({ x: Math.sin((deg * Math.PI) / 360), y: 0, z: 0, w: Math.cos((deg * Math.PI) / 360) });
const VIEWS = {
  level: { eye: [0, 170, 900], turn: pitch(-5), roof: true },
  down: { eye: [0, 1200, 0], turn: pitch(-89.9), roof: true },
  under: { eye: [-250, 60, 0], turn: pitch(89.9), roof: true },
  open: { eye: [-250, 60, 0], turn: pitch(89.9), roof: false },
  'snow-level': { eye: [0, 170, 900], turn: pitch(-5), roof: true, snow: true },
  'snow-under': { eye: [-250, 60, 0], turn: pitch(89.9), roof: true, snow: true },
  'snow-open': { eye: [-250, 60, 0], turn: pitch(89.9), roof: false, snow: true },
};

function sceneFor(view) {
  nextId = 0;
  const v = VIEWS[view];
  return { version: 4, name: `weather-rain-${view}`, entities: [
    ent('Camera', [tf(v.eye, v.turn), { type: 'Camera', data: { projectionType: 0, fov: 60, nearPlane: 5, farPlane: 20000, isActive: true, priority: 0 } },
      { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects: [{ type: 'skyAtmosphere', enabled: true,
        uniforms: { u_intensity: 1, u_haze: 0.6, u_sunBrightness: 10, u_clouds: 0, u_unitsPerKm: 100000 } }] } }]),
    ent('Sun', [tf([0, 0, 0], { x: -0.403, y: 0.2725, z: 0.1271, w: 0.8644 }), { type: 'Light', data: { type: 1, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 2, enabled: true } }]),
    // Rain alone: the weather's lights, fog and grade would change the picture under the streaks.
    ent('Weather', [tf([0, 0, 0]), { type: 'Weather', data: { preset: v.snow ? 5 : 3, target: -1, progress: 0, drive: 4 } }]),
    ent('Ground', [tf([0, 0, 0], null, [60, 1, 60]), { type: 'MeshRenderer', data: { mesh: 'builtin:plane', color: { r: 0.25, g: 0.25, b: 0.27, a: 1 }, lit: true, opaque: true, enabled: true, castShadows: true } }]),
    // builtin:cube is a metre on a side: a roof 3 by 6 m, 10 cm thick, 2.5 m up.
    ...(v.roof ? [ent('Roof', [tf([-250, 250, 0], null, [3, 0.1, 6]), { type: 'MeshRenderer', data: { mesh: 'builtin:cube', color: { r: 0.5, g: 0.2, b: 0.15, a: 1 }, lit: true, opaque: true, enabled: true, castShadows: true } }])] : []),
  ] };
}

if (process.argv.includes('--write')) {
  mkdirSync(DIR, { recursive: true });
  for (const view of Object.keys(VIEWS)) writeFileSync(path.join(DIR, `${view}.esscene`), JSON.stringify(sceneFor(view), null, 1) + '\n');
  console.log(`weather-rain-drops: wrote ${Object.keys(VIEWS).length} scenes into ${path.relative(ROOT, DIR)}`);
  process.exit(0);
}

const backend = process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : 'webgl2';
if (!process.argv.includes('--no-build')) runTool('node', ['tools/render-host/build.mjs'], { cwd: ROOT, encoding: 'utf8' });
const work = mkdtempSync(path.join(tmpdir(), 'weather-rain-'));

function shoot(view, steps) {
  const out = path.join(work, `${view}${steps}.png`);
  const r = runElectron(['tools/render-host/run.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 240000, env: {
    ESTELLA_VERIFY_HOST: 'engine', ESTELLA_VERIFY_TIMEOUT_MS: '200000', ESTELLA_VERIFY_BACKEND: backend,
    ESTELLA_VERIFY_SCENE: `/scenes/weather-rain/${view}.esscene`, ESTELLA_VERIFY_W: String(W), ESTELLA_VERIFY_H: String(H),
    ESTELLA_VERIFY_STEPS: String(steps), ESTELLA_VERIFY_OUT: out } });
  if (!/\[verify:render\] PASS/.test(`${r.stdout}${r.stderr}`)) throw new Error(`${view} did not render:\n${`${r.stdout}${r.stderr}`.slice(-2000)}`);
  return readPNG(readFileSync(out));
}

/** The streak pixels of a view, within a box of it: what moved between two frames a sixtieth of a second apart. */
function streaks(view, [x0, y0, x1, y1] = [8, 8, W - 8, H - 8]) {
  const a = shoot(view, 40), b = shoot(view, 41);
  const l = (img, x, y) => { const [r, g, bl] = img.px(x, y); return r + g + bl; };
  const out = new Uint8Array(W * H);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Where it was brighter the frame before: what fell is there in that frame (where it went is not), so a flake stays round.
      if (l(a, x, y) - l(b, x, y) > STREAK_STEP) { out[y * W + x] = 1; n++; }
    }
  }
  return { mask: out, n };
}

/** Mean |cos| between each streak pixel's local direction and `want(x, y)` (a unit vector), over pixels whose neighbourhood is a line. */
function alignment({ mask }, want) {
  let sum = 0, count = 0;
  for (let y = RADIUS; y < H - RADIUS; y++) {
    for (let x = RADIUS; x < W - RADIUS; x++) {
      if (!mask[y * W + x]) continue;
      let sxx = 0, syy = 0, sxy = 0, k = 0;
      for (let dy = -RADIUS; dy <= RADIUS; dy++) {
        for (let dx = -RADIUS; dx <= RADIUS; dx++) if (mask[(y + dy) * W + x + dx]) { sxx += dx * dx; syy += dy * dy; sxy += dx * dy; k++; }
      }
      if (k < 4) continue;
      // The principal axis of the neighbourhood, where it is clearly longer one way than the other (a line, not a blob or a dot).
      const tr = sxx + syy, det = sxx * syy - sxy * sxy, gap = Math.sqrt(Math.max(tr * tr / 4 - det, 0));
      const big = tr / 2 + gap, small = tr / 2 - gap;
      if (big < 4 * Math.max(small, 1e-6)) continue;
      const ax = sxy, ay = big - sxx, len = Math.hypot(ax, ay) || 1;
      const [ux, uy] = Math.abs(sxy) < 1e-9 ? (sxx >= syy ? [1, 0] : [0, 1]) : [ax / len, ay / len];
      const [wx, wy] = want(x, y);
      sum += Math.abs(ux * wx + uy * wy); count++;
    }
  }
  return { mean: count ? sum / count : 0, count };
}

let failed = 0;
const report = (ok, text) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} weather-rain-drops (${backend}) ${text}`); };
try {
  const seenLevel = streaks('level');
  const level = alignment(seenLevel, () => [0, 1]), across = alignment(seenLevel, () => [1, 0]);
  report(level.count > 50 && level.mean - across.mean > LEVEL_MARGIN, `seen level: ${level.count} streak pixels run down the picture`
    + ` (mean |cos| ${level.mean.toFixed(3)}) rather than across it (${across.mean.toFixed(3)}), by at least ${LEVEL_MARGIN}`);
  const fromAbove = streaks('down');
  const radial = alignment(fromAbove, (x, y) => { const dx = x - W / 2, dy = y - H / 2, d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; });
  const vertical = alignment(fromAbove, () => [0, 1]);
  report(radial.count > 50 && radial.mean - vertical.mean > DOWN_MARGIN, `seen from above: ${radial.count} streak pixels run out from the middle`
    + ` (mean |cos| ${radial.mean.toFixed(3)}) rather than down the picture (${vertical.mean.toFixed(3)}), by at least ${DOWN_MARGIN}`);
  // The roof fills the middle of the picture looking up from under it.
  const box = [140, 40, 500, 360];
  const under = streaks('under', box).n, open = streaks('open', box).n;
  report(under === 0 && open > OPEN_MIN, `under the roof: ${under} streak pixels between the eye and the roof (none allowed); with no roof the same view has ${open} (more than ${OPEN_MIN})`);
  const snowLevel = streaks('snow-level');
  const flakeDown = alignment(snowLevel, () => [0, 1]).mean, flakeAcross = alignment(snowLevel, () => [1, 0]).mean;
  report(snowLevel.n > 50 && flakeDown - flakeAcross < FLAKE_MARGIN, `snow falls as flakes: what moves runs down the picture`
    + ` (${flakeDown.toFixed(3)}) hardly more than across it (${flakeAcross.toFixed(3)}): by less than ${FLAKE_MARGIN}, where rain's does by`
    + ` ${(level.mean - across.mean).toFixed(3)}`);
  const snowUnder = streaks('snow-under', box).n, snowOpen = streaks('snow-open', box).n;
  report(snowUnder === 0 && snowOpen > OPEN_MIN, `snow under the roof: ${snowUnder} moving pixels (none allowed); with no roof ${snowOpen} (more than ${OPEN_MIN})`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
process.exit(failed ? 1 : 0);
