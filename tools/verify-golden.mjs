// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-golden.mjs — carry each golden project through package → launch.
 *
 * The registry says which projects a tier certifies and for which targets; this
 * runs that matrix. Web and playable are driven here because both launch in the
 * Electron already on hand; desktop/android/ios packages are launched by
 * verify-desktop-render and verify-native-boot, which own their toolchains.
 *
 * Reports every pair rather than stopping at the first failure — a release
 * argument wants the whole matrix, not the first thing that broke.
 *
 *   node tools/verify-golden.mjs --tier pr
 *   node tools/verify-golden.mjs --tier nightly --only platformer,spine-demo
 *   node tools/verify-golden.mjs --tier pr --shots <dir>
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { atTier, projectDir, ROOT } from './goldenProjects.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const TIER = flag('tier', 'pr');
const ONLY = flag('only', '');
const SHOTS = flag('shots', '');
const WORK = flag('work', path.join(ROOT, '.golden'));
/** Targets this runner owns; the rest belong to the native/desktop verifiers. */
const OWNED = new Set(['web', 'playable']);

const DESKTOP = path.join(ROOT, 'desktop');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const only = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;
const projects = atTier(TIER).filter((g) => !only || only.has(g.id));

const pairs = projects.flatMap((g) => g.targets.filter((t) => OWNED.has(t)).map((t) => ({ id: g.id, target: t })));
const deferred = projects.flatMap((g) => g.targets.filter((t) => !OWNED.has(t)).map((t) => `${g.id}:${t}`));

console.log(`golden ${TIER}: ${projects.length} project(s), ${pairs.length} pair(s) here`
  + (deferred.length ? `, ${deferred.length} left to the platform verifiers` : ''));

const results = [];
for (const { id, target } of pairs) {
  const out = path.join(WORK, `${id}-${target}`);
  rmSync(out, { recursive: true, force: true });

  const exported = spawnSync(process.execPath, [
    path.join(DESKTOP, 'scripts', 'export-project.mjs'), projectDir(id),
    '--platform', target, '--out', out,
  ], { encoding: 'utf8', cwd: ROOT });

  if (exported.status !== 0) {
    results.push({ id, target, stage: 'package', ok: false, why: (exported.stderr || exported.stdout || '').trim().slice(-300) });
    console.log(`✗ ${id} ${target} — package failed`);
    continue;
  }

  const launch = spawnSync('npx', [
    'electron', path.join('scripts', 'launch-export.mjs'),
    '--dir', out,
    ...(SHOTS ? ['--out', path.join(SHOTS, `${id}-${target}.png`)] : []),
  ], { encoding: 'utf8', cwd: DESKTOP });

  const line = (launch.stdout || '').split('\n').find((l) => l.startsWith('✓') || l.startsWith('✗')) ?? '';
  const ok = launch.status === 0;
  results.push({ id, target, stage: 'launch', ok, why: ok ? '' : (line || (launch.stdout || launch.stderr || '').trim().slice(-300)) });
  console.log(`${ok ? '✓' : '✗'} ${id} ${target}${ok ? '' : ` — ${line || 'launch failed'}`}`);
  if (!ok) for (const l of (launch.stdout || '').split('\n').slice(-6)) if (l.trim()) console.log(`    ${l}`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\ngolden ${TIER}: ${results.length - bad.length}/${results.length} pair(s) packaged and launched`);
for (const d of deferred) console.log(`  deferred: ${d}`);
if (bad.length) {
  for (const b of bad) console.log(`  ✗ ${b.id} ${b.target} (${b.stage})`);
  process.exit(1);
}
