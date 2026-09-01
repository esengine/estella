// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-aot-parity.mjs — a compiled game packages, boots and draws its game.
 *
 * One example packaged twice from one tree — once compiled, once with
 * `--no-aot` — both opened the way a player does, and the frames compared
 * (docs/REARCH_AOT.md §8.2, the pixel half).
 *
 * WHAT IT CANNOT SEE, measured rather than assumed. The loop runs on wall-clock
 * time, so two launches settle at different points in the animation: on
 * ecs-basics the most-changed cell reads 0.52 between two CORRECT runs, and
 * 0.57 when the compiled module is sabotaged to read one field four bytes off.
 * The signal is under the phase noise, both for the mean and for the cell max.
 * A frame comparison here therefore catches the coarse class — a compiled build
 * that is black, dead, or drawing a different game — and NOT a twin that reads
 * the wrong offset. That one needs the same displacement over the same fixed
 * steps, which needs a deterministic step in the packaged host.
 *
 *   node tools/verify-aot-parity.mjs
 *   node tools/verify-aot-parity.mjs --only space-shooter --shots out/
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { GOLDEN, projectDir, parityFor, launchTimeoutFor, ROOT } from './goldenProjects.mjs';
import { frameDistance } from './frameCompare.mjs';
import { retryOnDeadGpu, deadGpuVerdict } from './lib/deadGpu.mjs';
import { runElectron } from './lib/electronRun.mjs';
import { requireCurrentEngine } from './lib/engineBuild.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const ONLY = flag('only', '');
const SHOTS = flag('shots', '');
const WORK = flag('work', path.join(ROOT, '.golden'));
const LAUNCHER = path.join(ROOT, 'tools', 'launchers', 'launch-export.mjs');
const ENGINE = { dir: path.join(ROOT, 'desktop', 'public', 'wasm'), variant: 'web' };
/** The surface both runs open at. One number, so a difference is the game's. */
const SURFACE = { w: 820, h: 461 };

if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Which of a project's files mark a system `@compiled` — the same text the AOT
 *  build step looks for, over the same `src/` tree it lowers. */
function promises(id) {
  const found = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.d.ts') && readFileSync(p, 'utf8').includes('@compiled')) found.push(p);
    }
  };
  walk(path.join(projectDir(id), 'src'));
  return found;
}

/**
 * Every example that promises compilation, not only the golden ones.
 *
 * A golden project can promise compilation in a system that runs only once the
 * player fires, and then both frames agree because the compiled code touched no
 * entity at all — green over an empty query. So the marker picks the corpus.
 */
const EXAMPLES = path.join(ROOT, 'examples');
const only = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;
const subjects = readdirSync(EXAMPLES)
  .filter((id) => (!only || only.has(id)) && promises(id).length > 0)
  .map((id) => GOLDEN.find((g) => g.id === id) ?? { id, targets: ['web'] });

// A differential over nothing is the failure this file exists to prevent: it
// would report green on a compiler that emits garbage, having compiled none.
if (subjects.length === 0) {
  console.error('aot parity: no example marks a system @compiled');
  console.error('  this gate would pass having compiled nothing — mark a per-frame system that');
  console.error('  MOVES something, or remove the release criterion that names this file');
  process.exit(1);
}

console.log(`aot parity: ${subjects.length} project(s)`);
requireCurrentEngine(ROOT, ENGINE.dir, process.argv, ENGINE.variant);

/** Package one project, with or without its compiled systems. */
function exportOnce(id, out, compiled) {
  rmSync(out, { recursive: true, force: true });
  return spawnSync(process.execPath, [
    path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', projectDir(id),
    '--platform', 'web', '--out', out, ...(compiled ? [] : ['--no-aot']),
  ], { encoding: 'utf8', cwd: ROOT });
}

/** What a package says it carries: the module file, and the config naming it. */
function carriesModule(out) {
  let named = false;
  try {
    named = Boolean(JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8')).aot);
  } catch { named = false; }
  return { file: existsSync(path.join(out, 'aot', 'systems.wasm')), named };
}

/** Open a package and write its frame, once more past a dead GPU. */
function launch(id, out, png, timeoutMs) {
  const run = retryOnDeadGpu(
    () => {
      const r = runElectron([LAUNCHER,
        '--dir', out, '--out', png, '--w', String(SURFACE.w), '--h', String(SURFACE.h),
        ...(timeoutMs ? ['--timeout', String(timeoutMs)] : []),
      ], { encoding: 'utf8', cwd: ROOT });
      const verdict = (r.stdout || '').split('\n').find((l) => l.startsWith('✓') || l.startsWith('✗'));
      return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`, measured: Boolean(verdict), r };
    },
    () => console.log(`↻ ${id} — the GPU process died before it drew; launching again`),
  );
  return { ...run.r, gpuDied: Boolean(run.gpuDied) };
}

const results = [];
for (const g of subjects) {
  const id = g.id;
  const marked = promises(id).map((p) => path.relative(ROOT, p));
  console.log(`\n${id} — marked: ${marked.join(', ')}`);

  const dirs = { aot: path.join(WORK, `${id}-aot`), interp: path.join(WORK, `${id}-interp`) };
  let broke = false;
  for (const kind of ['aot', 'interp']) {
    const r = exportOnce(id, dirs[kind], kind === 'aot');
    if (r.status !== 0) {
      results.push({ id, stage: `package-${kind}`, ok: false, why: (r.stderr || r.stdout || '').trim().slice(-300) });
      console.log(`✗ ${id} — the ${kind} package failed`);
      broke = true;
    }
  }
  if (broke) continue;

  // Both halves have to be what they claim, or this compares two identical
  // interpreted packages and passes without a compiled line having run.
  const withAot = carriesModule(dirs.aot);
  const without = carriesModule(dirs.interp);
  const claims = [];
  if (!withAot.file) claims.push('the compiled package carries no aot/systems.wasm');
  if (!withAot.named) claims.push('the compiled package does not name a module in game.config.json');
  if (without.file) claims.push('the --no-aot package carries a module anyway');
  if (without.named) claims.push('the --no-aot package names a module in game.config.json');
  if (claims.length > 0) {
    results.push({ id, stage: 'packages-differ', ok: false, why: claims.join('; ') });
    console.log(`✗ ${id} — the two packages are not the two things being compared`);
    for (const c of claims) console.log(`    ${c}`);
    continue;
  }
  results.push({ id, stage: 'packages-differ', ok: true, why: '' });
  console.log(`✓ ${id} — one package compiled, one interpreted`);

  const timeoutMs = launchTimeoutFor(g);
  const shots = {};
  for (const kind of ['aot', 'interp']) {
    const png = SHOTS ? path.join(SHOTS, `${id}-${kind}.png`) : path.join(WORK, `${id}-${kind}.png`);
    const r = launch(id, dirs[kind], png, timeoutMs);
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('✓') || l.startsWith('✗')) ?? '';
    if (r.status !== 0 || !existsSync(png)) {
      const why = r.gpuDied
        ? `${deadGpuVerdict(`the ${kind} package`)} (${line || 'no frame'})`
        : line || 'launch failed';
      results.push({ id, stage: `launch-${kind}`, ok: false, why });
      console.log(`✗ ${id} ${kind} — ${why}`);
      broke = true;
      break;
    }
    shots[kind] = png;
  }
  if (broke) continue;

  const tol = parityFor(g) ?? 0.06;
  const d = frameDistance(readFileSync(shots.aot), readFileSync(shots.interp));
  const ok = d <= tol;
  results.push({
    id, stage: 'frame', ok,
    why: ok ? '' : `the compiled frame sits ${d.toFixed(3)} from the interpreted one (tolerance ${tol})`,
  });
  console.log(`${ok ? '✓' : '✗'} ${id} — frame distance ${d.toFixed(3)} against ${tol}`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\naot parity: ${results.length - bad.length}/${results.length} ok`);
for (const r of bad) console.log(`  ✗ ${r.id} ${r.stage} — ${r.why}`);
process.exit(bad.length > 0 ? 1 : 0);
