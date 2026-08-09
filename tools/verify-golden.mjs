// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-golden.mjs — carry each golden project through package → launch → drive → compare.
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
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { atTier, projectDir, parityFor, interactFor, ROOT } from './goldenProjects.mjs';
import { frameDistance, frameCellMax, readPNG } from './frameCompare.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const TIER = flag('tier', 'pr');
const ONLY = flag('only', '');
const SHOTS = flag('shots', '');
const WORK = flag('work', path.join(ROOT, '.golden'));
const NO_PARITY = argv.includes('--no-parity');
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

/** The shape the game is authored for. A package derives its orientation gate
 *  from this, so the comparison surface has to agree with it. */
function designAspect(id) {
  try {
    const r = JSON.parse(readFileSync(path.join(projectDir(id), 'project.esproject'), 'utf8')).designResolution;
    if (r?.width > 0 && r?.height > 0) return { w: r.width, h: r.height };
  } catch { /* fall through to the default shape */ }
  return { w: 16, h: 9 };
}

/**
 * The editor's frame of the running game, through the screenshot hook the UI
 * shots use. The play panel takes the project's aspect first: a portrait game on
 * a landscape surface draws the package's rotate gate against the editor's
 * letterbox — a difference of surface, not of game.
 */
function captureEditorFrame(id, out) {
  const a = designAspect(id);
  const major = 820;
  const panel = a.h >= a.w
    ? { width: Math.round((major * a.w) / a.h), height: major }
    : { width: major, height: Math.round((major * a.h) / a.w) };
  const r = spawnSync('npx', ['electron', '.'], {
    encoding: 'utf8',
    cwd: DESKTOP,
    env: {
      ...process.env,
      ESTELLA_SHOT: out,
      ESTELLA_SHOT_PROJECT: projectDir(id),
      ESTELLA_SHOT_PLAY: '1',
      ESTELLA_SHOT_CROP: 'iframe[title="Game"]',
      ESTELLA_SHOT_EVAL: `window.__estellaEditor.setPanelSize('viewport', ${JSON.stringify(panel)})`,
      ESTELLA_WIN_W: '1500',
      ESTELLA_WIN_H: '1040',
    },
  });
  if (!existsSync(out)) return { ok: false, why: (r.stdout || r.stderr || '').trim().slice(-300) };
  const png = readPNG(readFileSync(out));
  return { ok: true, w: png.w, h: png.h };
}

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

  // Parity compares like for like, so the package is opened at exactly the size
  // the editor's play surface came out — never a guessed one.
  const golden = atTier(TIER).find((g) => g.id === id);
  const tolerance = target === 'web' && !NO_PARITY ? parityFor(golden) : null;
  const editorPng = path.join(WORK, `${id}-editor.png`);
  const editor = tolerance != null ? captureEditorFrame(id, editorPng) : null;
  if (editor && !editor.ok) {
    results.push({ id, target, stage: 'editor-frame', ok: false, why: editor.why });
    console.log(`✗ ${id} ${target} — the editor never produced a play frame`);
    continue;
  }

  const packagePng = SHOTS ? path.join(SHOTS, `${id}-${target}.png`) : path.join(WORK, `${id}-${target}.png`);
  const launch = spawnSync('npx', [
    'electron', path.join('scripts', 'launch-export.mjs'),
    '--dir', out, '--out', packagePng,
    ...(editor ? ['--w', String(editor.w), '--h', String(editor.h)] : []),
  ], { encoding: 'utf8', cwd: DESKTOP });

  const line = (launch.stdout || '').split('\n').find((l) => l.startsWith('✓') || l.startsWith('✗')) ?? '';
  if (launch.status !== 0) {
    results.push({ id, target, stage: 'launch', ok: false, why: line || 'launch failed' });
    console.log(`✗ ${id} ${target} — ${line || 'launch failed'}`);
    for (const l of (launch.stdout || '').split('\n').slice(-6)) if (l.trim()) console.log(`    ${l}`);
    continue;
  }

  if (tolerance == null) {
    results.push({ id, target, stage: 'launch', ok: true });
    console.log(`✓ ${id} ${target}`);
    continue;
  }

  let distance;
  try {
    distance = frameDistance(readFileSync(editorPng), readFileSync(packagePng));
  } catch (e) {
    results.push({ id, target, stage: 'parity', ok: false, why: e.message });
    console.log(`✗ ${id} ${target} — parity: ${e.message}`);
    continue;
  }
  if (distance > tolerance) {
    results.push({ id, target, stage: 'parity', ok: false, why: `distance ${distance.toFixed(4)} > ${tolerance}` });
    console.log(`✗ ${id} ${target} — parity ${distance.toFixed(4)} (limit ${tolerance})`);
    console.log(`    the package is not showing what the editor showed; compare ${editorPng} and ${packagePng}`);
    continue;
  }

  // Does the package answer a keyboard? An A/B against the undriven capture, not
  // a before/after: a game animates on its own, so only "it differs BECAUSE of
  // the key" is a claim. The worst-cell reducer is what sees a sprite move.
  const input = interactFor(golden);
  if (!input) {
    results.push({ id, target, stage: 'parity', ok: true });
    console.log(`✓ ${id} ${target} — parity ${distance.toFixed(4)}`);
    continue;
  }

  const drivenPng = path.join(WORK, `${id}-${target}-driven.png`);
  const drive = spawnSync('npx', [
    'electron', path.join('scripts', 'launch-export.mjs'),
    '--dir', out, '--out', drivenPng,
    '--w', String(editor.w), '--h', String(editor.h),
    '--input', JSON.stringify({ keys: input.keys, frames: input.frames }),
  ], { encoding: 'utf8', cwd: DESKTOP });
  if (drive.status !== 0) {
    results.push({ id, target, stage: 'interact', ok: false, why: 'the driven launch failed' });
    console.log(`✗ ${id} ${target} — the driven launch failed`);
    continue;
  }

  let response;
  try {
    response = frameCellMax(readFileSync(packagePng), readFileSync(drivenPng));
  } catch (e) {
    results.push({ id, target, stage: 'interact', ok: false, why: e.message });
    console.log(`✗ ${id} ${target} — interact: ${e.message}`);
    continue;
  }
  const answered = response >= input.responds;
  results.push({ id, target, stage: 'interact', ok: answered, why: answered ? '' : `response ${response.toFixed(4)} < ${input.responds}` });
  console.log(`${answered ? '✓' : '✗'} ${id} ${target} — parity ${distance.toFixed(4)}, responds ${response.toFixed(4)} to ${input.keys.join('+')}`);
  if (!answered) console.log(`    the package did not visibly answer the key; compare ${packagePng} and ${drivenPng}`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\ngolden ${TIER}: ${results.length - bad.length}/${results.length} pair(s) packaged and launched`);
for (const d of deferred) console.log(`  deferred: ${d}`);
if (bad.length) {
  for (const b of bad) console.log(`  ✗ ${b.id} ${b.target} (${b.stage})`);
  process.exit(1);
}
