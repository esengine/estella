// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-render.mjs — run the pixel gates a tier pays for.
 *
 * One runner over {@link renderScenes.mjs}, so CI and a developer run the same
 * list by the same names. Reports the whole matrix rather than stopping at the
 * first failure: which scenes broke is the useful answer, not which broke first.
 *
 *   node tools/verify-render.mjs --tier pr
 *   node tools/verify-render.mjs --tier pr --backend webgpu --budget 45
 *   node tools/verify-render.mjs --tier nightly --only spine,video
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIERS, SCENES, scenesAtTier, SCENE_WATCHDOG_MS } from './renderScenes.mjs';
import { retryOnDeadGpu, deadGpuVerdict } from './lib/deadGpu.mjs';
import { runTool } from './lib/runTool.mjs';
import { requireCurrentEngine } from './lib/engineBuild.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.join(ROOT, 'desktop');

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const TIER = flag('tier', 'pr');
const ONLY = flag('only', '');
const BACKEND = flag('backend', 'webgl2');
const BUDGET = flag('budget', '');
const NO_BUILD = argv.includes('--no-build');
// CI runners cannot use the SUID sandbox helper (not root-owned in
// node_modules), and a pixel check does not need it.
const XVFB = process.platform === 'linux' && !argv.includes('--no-xvfb');

const only = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;
if (only) {
  const known = new Set(SCENES.map((s) => s.id));
  const bogus = [...only].filter((id) => !known.has(id));
  if (bogus.length) {
    console.error(`verify-render: no such scene(s): ${bogus.join(', ')}`);
    process.exit(2);
  }
}
if (!TIERS.includes(TIER)) {
  console.error(`verify-render: unknown tier "${TIER}" (have: ${TIERS.join(', ')})`);
  process.exit(2);
}

if (!['webgl2', 'webgpu'].includes(BACKEND)) {
  console.error(`verify-render: unknown backend "${BACKEND}" (have: webgl2, webgpu)`);
  process.exit(2);
}
if (BUDGET && !(Number(BUDGET) > 0)) {
  console.error(`verify-render: --budget takes minutes, not "${BUDGET}"`);
  process.exit(2);
}
// Minutes the whole run may spend before it stops and says what it never
// measured. A tier that outgrows its runner is a report either way; without one
// the report is a killed process, which names no scene at all.
const BUDGET_MS = Number(BUDGET || 0) * 60_000;
const WATCHDOG_MS = SCENE_WATCHDOG_MS[BACKEND];
// The scene's own watchdog produces a verdict, so this kill is for the launch
// that never reaches it — a whole electron start-up beyond.
const LAUNCH_MARGIN_MS = 30_000;
// A scene runs on the second backend only where it says so: the two backends
// agree on most frames and deliberately differ on a couple of tolerances, and
// guessing that per scene is how the WebGPU list became a third copy.
// A tier run on the second backend takes the scenes that DECLARE it; naming
// scenes explicitly is a decision already made, so `--only` is not filtered —
// that is how a scene earns the declaration in the first place.
const selected = only
  ? SCENES.filter((s) => only.has(s.id))
  : scenesAtTier(TIER).filter((s) => (BACKEND === 'webgpu' ? Boolean(s.webgpu) : true));
const scenes = selected.map((s) => ({
  id: s.id,
  env: BACKEND === 'webgpu'
    ? {
      ...s.env,
      ...(typeof s.webgpu === 'object' ? s.webgpu : {}),
      ESTELLA_VERIFY_BACKEND: 'webgpu',
      // The adapter Dawn picks for itself: a real driver is the only kind that
      // answers the portability question. `swiftshader` names the bundled software
      // one, for a machine with no GPU. The boot log says which it got.
      ESTELLA_VERIFY_WEBGPU_ADAPTER: process.env.ESTELLA_VERIFY_WEBGPU_ADAPTER ?? '',
    }
    : s.env,
}));
// The copy this run will actually serve: --no-build leaves desktop/dist as it
// stands, so a freshly built public/ one it never copies is evidence about a
// binary no scene below is judging.
requireCurrentEngine(ROOT, path.join(DESKTOP, NO_BUILD ? 'dist' : 'public', 'wasm'));
console.log(`render ${only ? `${scenes.length} named scene(s)` : `${TIER}: ${scenes.length} scene(s)`} on ${BACKEND}`);

if (!NO_BUILD) {
  const built = runTool('pnpm', ['exec', 'vite', 'build'], { cwd: DESKTOP, encoding: 'utf8' });
  if (built.status !== 0) {
    console.error(`verify-render: vite build failed\n${(built.stderr || built.stdout || '').slice(-800)}`);
    process.exit(1);
  }
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

function runScene(scene) {
  const args = XVFB
    ? ['-a', 'pnpm', 'exec', 'electron', 'scripts/headless-verify.mjs']
    : ['exec', 'electron', 'scripts/headless-verify.mjs'];
  const at = Date.now();
  const r = runTool(XVFB ? 'xvfb-run' : 'pnpm', args, {
    cwd: DESKTOP,
    encoding: 'utf8',
    timeout: WATCHDOG_MS + LAUNCH_MARGIN_MS,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SANDBOX: '1',
      ESTELLA_VERIFY_TIMEOUT_MS: String(WATCHDOG_MS),
      ...scene.env,
    },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return {
    ok: r.status === 0,
    out,
    ms: Date.now() - at,
    verdict: r.timedOut
      ? 'the run never reached its own watchdog and was killed'
      : ((r.stdout || '').match(/\[verify:render\][^\n]*/) ?? [''])[0].replace('[verify:render] ', ''),
  };
}

const failed = [];
const unmeasured = [];
const startedAt = Date.now();
let retried = 0;
// A runner with no GPU for this backend fails every scene the same way, six
// attempts apiece — an hour to say nothing, with the rest blamed on the budget.
// Once this many have died with it down and none has drawn, no scene can change it.
const DEAD_GPU_GIVE_UP = 3;
let deadInARow = 0;
let drewSomething = false;
let noGpu = false;
for (const [index, scene] of scenes.entries()) {
  const outOfBudget = BUDGET_MS && Date.now() - startedAt >= BUDGET_MS;
  noGpu = !drewSomething && deadInARow >= DEAD_GPU_GIVE_UP;
  if (outOfBudget || noGpu) {
    for (const rest of scenes.slice(index)) unmeasured.push(rest.id);
    break;
  }
  // A scene that TAKES the GPU away on purpose owns its own device-loss result;
  // everything else shares one retry policy with the golden runner, or the same
  // dead runner is a retry in one and a broken engine in the other.
  let run;
  if (scene.env.ESTELLA_VERIFY_DEVICE_LOSS) {
    run = runScene(scene);
  } else {
    const attempt = retryOnDeadGpu(
      () => { const r = runScene(scene); return { ...r, output: r.out }; },
      (died) => {
        retried++;
        console.log(`↻ ${scene.id.padEnd(28)} ${died
          ? 'the GPU process died before it drew'
          : 'a blank frame on the run after a GPU death'}; measuring again`);
      },
    );
    run = attempt;
  }
  if (run.ok) drewSomething = true; else failed.push(scene.id);
  deadInARow = run.gpuDied ? deadInARow + 1 : 0;
  console.log(`${run.ok ? '✓' : '✗'} ${scene.id.padEnd(28)} ${seconds(run.ms).padStart(7)}  `
    + `${run.gpuDied ? deadGpuVerdict('the scene') : run.verdict}`);
  if (!run.ok) {
    for (const l of run.out.split('\n').slice(-8)) if (l.trim()) console.log(`    ${l}`);
  }
}

const measured = scenes.length - unmeasured.length;
console.log(`\nrender ${TIER}: ${measured - failed.length}/${measured} scene(s) drew what they claim`
  + ` in ${seconds(Date.now() - startedAt)}`
  + (retried ? `, ${retried} measured twice (the GPU had died)` : ''));
if (failed.length) for (const id of failed) console.log(`  ✗ ${id}`);
if (unmeasured.length) {
  console.log(noGpu
    ? `\nthe runner never gave ${BACKEND} a GPU: ${measured} scene(s) died with it down and `
      + `${unmeasured.length} were not run — this is a verdict about the RUNNER, not the engine`
    : `\nthe ${BUDGET} minute budget ran out: ${unmeasured.length} scene(s) never ran`);
  for (const id of unmeasured) console.log(`  · ${id}`);
}
if (failed.length || unmeasured.length) process.exit(1);
