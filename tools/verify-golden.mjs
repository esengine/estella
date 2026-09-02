// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-golden.mjs — carry each golden project through package → launch → drive → compare.
 *
 * The registry says which projects a tier certifies and for which targets; this
 * runs that matrix. Web, playable and the mini-game targets are driven here
 * because all three launch in the Electron already on hand; desktop/android/ios
 * packages go to verify-desktop-render and verify-native-boot, which own their
 * toolchains.
 *
 * Reports every pair rather than stopping at the first failure — a release
 * argument wants the whole matrix, not the first thing that broke.
 *
 *   node tools/verify-golden.mjs --tier pr
 *   node tools/verify-golden.mjs --tier nightly --only platformer,spine-demo
 *   node tools/verify-golden.mjs --tier pr --shots <dir>
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { atTier, projectDir, parityFor, interactFor, audioFor, suspendFor, safeAreaFor, atlasFor, webPixels, launchTimeoutFor, ROOT } from './goldenProjects.mjs';
import { frameDistance, frameCellMax, readPNG } from './frameCompare.mjs';
import { retryOnDeadGpu, deadGpuVerdict, launchNeverHappenedVerdict } from './lib/deadGpu.mjs';
import { runElectron } from './lib/electronRun.mjs';
import { requireCurrentEngine } from './lib/engineBuild.mjs';

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
/** Targets this runner owns; the rest belong to the native/desktop verifiers.
 *  A mini-game needs its vendor's globals, so it goes through its own launcher. */
const OWNED = new Set(['web', 'playable', 'wechat']);
const LAUNCHER = (target) => path.join(ROOT, 'tools', 'launchers',
  target === 'wechat' ? 'launch-minigame.mjs' : 'launch-export.mjs');
/** Targets whose surface this runner can size to the editor's, which is what
 *  makes a frame comparable at all. Measured on one project: web 0.0009,
 *  playable 0.0027, wechat 0.0027 — the packaging wrapper is not what differs. */
const COMPARABLE = OWNED;

const DESKTOP = path.join(ROOT, 'desktop');

/**
 * Where the engine binary a target packages comes from, and which build variant
 * it is. Checked PER TARGET: the variants are separate builds, and a stale one
 * does not announce itself — the package boots, fails its ABI handshake and
 * reads as the game being broken.
 */
const ENGINE_OF = (target) => (target === 'wechat'
  ? { dir: path.join(ROOT, 'build', 'wasm', 'wechat'), variant: 'wechat' }
  : { dir: path.join(DESKTOP, 'public', 'wasm'), variant: 'web' });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const only = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;
const projects = atTier(TIER).filter((g) => !only || only.has(g.id));

const pairs = projects.flatMap((g) => g.targets.filter((t) => OWNED.has(t)).map((t) => ({ id: g.id, target: t })));
const deferred = projects.flatMap((g) => g.targets.filter((t) => !OWNED.has(t)).map((t) => `${g.id}:${t}`));

console.log(`golden ${TIER}: ${projects.length} project(s), ${pairs.length} pair(s) here`
  + (deferred.length ? `, ${deferred.length} left to the platform verifiers` : ''));

/**
 * `--jobs N`: the projects, N at a time, each worker this script over its share.
 * The release tier's seventeen took 33 minutes in a row with three cores idle.
 * A project stays whole (a worker's `--only` is by id); shares are balanced by
 * what a project asks for, not by count — celestial-heights alone is a third.
 */
const JOBS = Math.max(1, Number(flag('jobs', '1')) || 1);
if (JOBS > 1 && !argv.includes('--worker') && projects.length > 1) {
  const weight = (g) => g.targets.filter((t) => OWNED.has(t)).length
    * (1 + [interactFor(g), audioFor(g), safeAreaFor(g), atlasFor(g)].filter(Boolean).length + (suspendFor(g) ? 3 : 0));
  const bins = Array.from({ length: Math.min(JOBS, projects.length) }, () => ({ ids: [], load: 0 }));
  for (const g of [...projects].sort((a, b) => weight(b) - weight(a))) {
    const bin = bins.reduce((least, b) => (b.load < least.load ? b : least));
    bin.ids.push(g.id);
    bin.load += weight(g);
  }
  const own = new Set(['--only', '--jobs']);
  const passthrough = argv.filter((a, i) => !own.has(a) && !own.has(argv[i - 1]));
  const outcomes = await Promise.all(bins.map((bin, i) => new Promise((resolve) => {
    const tag = `[${i + 1}/${bins.length}]`;
    const child = spawn(process.execPath,
      [fileURLToPath(import.meta.url), ...passthrough, '--worker', '--only', bin.ids.join(',')],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    // Relayed as they come, tagged: a worker's line is only readable if it says
    // whose it is, and a runner staring at nothing for ten minutes kills the job.
    let rest = '';
    const relay = (chunk) => {
      rest += chunk;
      const lines = rest.split('\n');
      rest = lines.pop();
      for (const l of lines) console.log(`${tag} ${l}`);
    };
    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
    child.on('close', (code) => {
      if (rest) console.log(`${tag} ${rest}`);
      resolve({ tag, code, ids: bin.ids });
    });
  })));
  const failed = outcomes.filter((o) => o.code !== 0);
  console.log(`\ngolden ${TIER}: ${bins.length} worker(s) over ${projects.length} project(s) — `
    + (failed.length ? `${failed.length} did not pass` : 'all packaged and launched'));
  for (const f of failed) console.log(`  ✗ ${f.tag} exit ${f.code}: ${f.ids.join(', ')}`);
  process.exit(failed.length ? 1 : 0);
}

/** What the project declares: the shape it is authored for, and the scene a
 *  package will ship as its entry. */
function manifestOf(id) {
  try {
    return JSON.parse(readFileSync(path.join(projectDir(id), 'project.esproject'), 'utf8'));
  } catch {
    return {};
  }
}

/** A package derives its orientation gate from this, so the comparison surface
 *  has to agree with it. */
function designAspect(id) {
  const r = manifestOf(id).designResolution;
  return r?.width > 0 && r?.height > 0 ? { w: r.width, h: r.height } : { w: 16, h: 9 };
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
  const attempt = () => {
    // A partial file from the attempt before would be read as this attempt's frame.
    rmSync(out, { force: true });
    const r = runElectron(['.'], {
      via: 'npx',
      encoding: 'utf8',
      cwd: DESKTOP,
      env: {
        ESTELLA_SHOT: out,
        ESTELLA_SHOT_PROJECT: projectDir(id),
        // The scene the PACKAGE ships, named rather than inherited: opening a
        // project reopens whatever was last open, which is untracked local state —
        // so the two sides would differ by a developer's workspace file.
        ...(manifestOf(id).defaultScene ? { ESTELLA_SHOT_SCENE: manifestOf(id).defaultScene } : {}),
        ESTELLA_SHOT_PLAY: '1',
        ESTELLA_SHOT_CROP: 'iframe[title="Game"]',
        ESTELLA_SHOT_EVAL: `window.__estellaEditor.setPanelSize('viewport', ${JSON.stringify(panel)})`,
        ESTELLA_WIN_W: '1500',
        ESTELLA_WIN_H: '1040',
      },
    });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    // The frame on disk is the verdict here: without one the editor never got
    // far enough to judge anything, whatever the log says about the GPU.
    if (!existsSync(out)) return { ok: false, output, measured: false };
    // A frame the editor was killed halfway through writing is not a frame, and
    // decoding it throws where a verdict belongs: one project's dead GPU took
    // the whole matrix's report with it.
    try {
      const png = readPNG(readFileSync(out));
      return { ok: true, output, w: png.w, h: png.h };
    } catch (e) {
      // Half a PNG is a run that was killed mid-write, not a frame to judge.
      return { ok: false, output: `${output}\nthe capture is not a whole PNG: ${e.message}`, measured: false };
    }
  };
  const run = retryOnDeadGpu(attempt, (died) => console.log(`↻ ${id} — ${died
    ? 'the GPU process died before the editor drew'
    : 'no editor frame after a GPU death'}; capturing again`));
  if (!run.ok) {
    return {
      ok: false,
      why: run.launchFailed
        ? `${launchNeverHappenedVerdict('the editor\'s frame')} (${run.output.trim().slice(-200)})`
        : run.gpuDied
          ? `${deadGpuVerdict('the editor\'s frame')} (${run.output.trim().slice(-200)})`
          : run.output.trim().slice(-300),
    };
  }
  return { ok: true, w: run.w, h: run.h };
}

/** Points the package's own frame failed to draw, as messages. Empty = all held. */
function probePackagePixels(png, points) {
  let frame;
  try {
    frame = readPNG(readFileSync(png));
  } catch (e) {
    return [`the package capture is not a whole PNG: ${e.message}`];
  }
  const missed = [];
  for (const pt of points) {
    const x = Math.min(frame.w - 1, Math.max(0, Math.round(pt.x * (frame.w - 1))));
    const y = Math.min(frame.h - 1, Math.max(0, Math.round(pt.y * (frame.h - 1))));
    const got = frame.px(x, y);
    const tol = pt.tol ?? 30;
    if (!got.every((c, k) => Math.abs(c - pt.rgb[k]) <= tol)) {
      missed.push(`${pt.what ?? `${pt.x}x${pt.y}`}: want [${pt.rgb}] ±${tol}, got [${got}]`);
    }
  }
  return missed;
}

/** Where a packaged run says the named entities are, or null if it never said. */
function probePositions(target, dir, w, h, names, extra = []) {
  const r = launchPackage('probe', target, [
    '--dir', dir, '--w', String(w), '--h', String(h),
    '--probe', names.join(','), ...extra,
  ]);
  const line = (r.stdout || '').split('\n').find((l) => l.includes('probe:'));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(line.indexOf('{'))).at ?? null;
  } catch { return null; }
}

/**
 * Launch a package, once more if the GPU never came up. Every launch here goes
 * through this: the runner kills the first electron of a job often enough that a
 * per-call-site answer means some launches retry and others report a broken game.
 */
function launchPackage(id, target, args) {
  const run = retryOnDeadGpu(
    () => {
      // Opening a PACKAGE needs no editor — the launchers are engine-side, so a
      // checkout without one can still judge what it shipped.
      const r = runElectron([LAUNCHER(target), ...args], { encoding: 'utf8', cwd: ROOT });
      // The launcher prints a ✓/✗ line once it has looked at the frame; that
      // line existing is what says a measurement happened.
      const verdictLine = (r.stdout || '').split('\n').find((l) => l.startsWith('✓') || l.startsWith('✗'));
      return {
        ok: r.status === 0,
        output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
        measured: Boolean(verdictLine),
        drew: verdictLine ? verdictLine.startsWith('✓') : undefined,
        r,
      };
    },
    (died) => console.log(`↻ ${id} ${target} — ${died
      ? 'the GPU process died before it drew'
      : 'a blank frame on the launch after a GPU death'}; launching again`),
  );
  // gpuDied travels with the result: without it a runner whose GPU never came up
  // is reported as a game that draws nothing, which is the one confusion this
  // whole retry exists to prevent.
  return { ...run.r, gpuDied: Boolean(run.gpuDied), launchFailed: Boolean(run.launchFailed) };
}

const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;

/**
 * The limits the export judged itself against, from the report it already
 * writes. Read rather than recomputed: the pipeline owns what a package weighs
 * and which limits are in force, and a second opinion here is the one that
 * drifts. No verdicts is not the same as being over one.
 */
function readSizeVerdicts(reportPath) {
  try {
    return JSON.parse(readFileSync(reportPath, 'utf8')).size?.verdicts ?? [];
  } catch {
    return [];
  }
}

// Every engine build this tier's pairs will package, before any of them runs:
// finding out at pair fourteen costs the thirteen packages before it.
for (const key of new Set(pairs.map((p) => JSON.stringify(ENGINE_OF(p.target))))) {
  const { dir, variant } = JSON.parse(key);
  requireCurrentEngine(ROOT, dir, process.argv, variant);
}

const results = [];
for (const { id, target } of pairs) {
  const out = path.join(WORK, `${id}-${target}`);
  rmSync(out, { recursive: true, force: true });

  const sizeReport = path.join(WORK, `${id}-${target}.size.json`);
  const exported = spawnSync(process.execPath, [
    path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', projectDir(id),
    '--platform', target, '--out', out, '--json', sizeReport,
  ], { encoding: 'utf8', cwd: ROOT });

  if (exported.status !== 0) {
    results.push({ id, target, stage: 'package', ok: false, why: (exported.stderr || exported.stdout || '').trim().slice(-300) });
    // The reason was recorded and never printed, so the whole account of a
    // failed export was two words. It is the only place the exporter speaks.
    const why = (exported.stderr || exported.stdout || '').trim();
    console.log(`✗ ${id} ${target} — package failed`);
    for (const l of why.split('\n').slice(-8)) if (l.trim()) console.log(`    ${l}`);
    continue;
  }

  // A package that does not fit is one nobody can ship. A stage rather than an
  // export flag, so a build that is over still launches and reports everything
  // else it can — the way an over-tolerance parity does.
  for (const verdict of readSizeVerdicts(sizeReport)) {
    const ok = verdict.status !== 'over';
    results.push({
      id, target, stage: 'size', ok,
      why: ok ? '' : `${fmtMB(verdict.measuredBytes)} against a ${fmtMB(verdict.budget.maxBytes)} limit`
        + ` (${verdict.ratio.toFixed(2)}x) — ${verdict.budget.note ?? verdict.budget.scope}`,
    });
    if (!ok) console.log(`✗ ${id} ${target} — over the ${fmtMB(verdict.budget.maxBytes)} limit at ${fmtMB(verdict.measuredBytes)}`);
  }

  // Parity compares like for like, so the package is opened at exactly the size
  // the editor's play surface came out — never a guessed one.
  const golden = atTier(TIER).find((g) => g.id === id);

  // Did the cook actually pack? Parity cannot answer this: an atlas that stopped
  // working still draws the same frame from nine standalone textures.
  const atlas = atlasFor(golden);
  if (atlas) {
    let packed = 0;
    try {
      const manifest = JSON.parse(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8'));
      for (const group of Object.values(manifest.groups ?? {})) {
        for (const asset of Object.values(group.assets ?? {})) {
          if (asset.metadata?.atlasPage !== undefined) packed++;
        }
      }
    } catch (e) {
      packed = -1;
    }
    const ok = packed === atlas.packed;
    results.push({
      id, target, stage: 'atlas', ok,
      why: ok ? '' : `${packed} texture(s) came out packed, the project claims ${atlas.packed}`,
    });
    console.log(`${ok ? '✓' : '✗'} ${id} ${target} — atlas: ${packed} texture(s) packed into a page`);
  }
  // Did anything reach the audio output? A frame cannot answer it: the control
  // that starts the sound redraws itself either way. So drive the toggle and read
  // the height the game wrote from an analyser bin — silence leaves it on its floor.
  const audio = audioFor(golden);
  if (audio && target === 'web') {
    const probed = launchPackage(id, target, [
      '--dir', out,
      '--input', JSON.stringify({ pointer: { x: audio.toggle.x, y: audio.toggle.y }, frames: audio.frames ?? 60 }),
      '--probe', audio.bar,
    ]);
    const found = /probe: (\{.*\})/.exec(probed.stdout || '');
    let height = null;
    try { height = found ? JSON.parse(found[1]).at?.[audio.bar]?.h ?? null : null; } catch { height = null; }
    const ok = typeof height === 'number' && height > audio.floor;
    results.push({
      id, target, stage: 'audio', ok,
      why: ok ? '' : height === null
        ? `${audio.bar} did not report a height — the probe saw no such UI node`
        : `${audio.bar} stayed at ${height} (floor ${audio.floor}); nothing reached the output`,
    });
    console.log(`${ok ? '✓' : '✗'} ${id} ${target} — audio: ${audio.bar} at ${height ?? 'nothing'} (silent floor ${audio.floor})`);
  }

  const tolerance = COMPARABLE.has(target) && !NO_PARITY ? parityFor(golden) : null;
  const editorPng = path.join(WORK, `${id}-editor.png`);
  const editor = tolerance != null ? captureEditorFrame(id, editorPng) : null;
  if (editor && !editor.ok) {
    results.push({ id, target, stage: 'editor-frame', ok: false, why: editor.why });
    console.log(`✗ ${id} ${target} — the editor never produced a play frame`);
    continue;
  }

  const packagePng = SHOTS ? path.join(SHOTS, `${id}-${target}.png`) : path.join(WORK, `${id}-${target}.png`);
  const timeoutMs = launchTimeoutFor(golden);
  const launch = launchPackage(id, target, [
    '--dir', out, '--out', packagePng,
    ...(editor ? ['--w', String(editor.w), '--h', String(editor.h)] : []),
    ...(timeoutMs ? ['--timeout', String(timeoutMs)] : []),
  ]);

  const line = (launch.stdout || '').split('\n').find((l) => l.startsWith('✓') || l.startsWith('✗')) ?? '';
  if (launch.status !== 0) {
    const why = launch.launchFailed
      ? `${launchNeverHappenedVerdict('the game')} (${(launch.stderr || '').trim().slice(-200)})`
      : launch.gpuDied
        ? `${deadGpuVerdict('the game')} (${line || 'no frame'})`
        : line || 'launch failed';
    results.push({ id, target, stage: 'launch', ok: false, why });
    console.log(`✗ ${id} ${target} — ${why}`);
    // Deep enough to carry the launcher's own diagnosis of a package that never
    // drew — six lines cut it off at the headline.
    for (const l of (launch.stdout || '').split('\n').slice(-20)) if (l.trim()) console.log(`    ${l}`);
    continue;
  }

  // What the PACKAGE drew, before comparing it to anything. Parity is an A/B, so
  // a capability the package lost and the editor never had passes it; the launch
  // check passes any frame that is not one flat colour.
  const wanted = target === 'web' ? webPixels(golden) : null;
  if (wanted) {
    const missed = probePackagePixels(packagePng, wanted);
    if (missed.length > 0) {
      results.push({ id, target, stage: 'pixels', ok: false, why: missed.join('; ') });
      console.log(`✗ ${id} ${target} — the package did not draw what it claims`);
      for (const m of missed) console.log(`    ${m}`);
      continue;
    }
  }

  if (tolerance == null) {
    results.push({ id, target, stage: 'launch', ok: true });
    console.log(`✓ ${id} ${target}${wanted ? ` — ${wanted.length} point(s) drawn` : ''}`);
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
    console.log(`✓ ${id} ${target} — parity ${distance.toFixed(4)}`
      + (wanted ? `, ${wanted.length} point(s) drawn` : ''));
    continue;
  }

  // Each input the project claims is driven ALONE. Sent together, a package
  // whose touch controls do nothing still answers the keyboard, and the gate
  // reads that as both of them working.
  const gestures = [];
  if (input.keys.length || input.pointer) {
    gestures.push({
      what: [input.keys.join('+'), input.pointer && `tap ${input.pointer.x}×${input.pointer.y}`]
        .filter(Boolean).join(' + '),
      spec: { keys: input.keys, pointer: input.pointer, frames: input.frames },
      touch: false,
    });
  }
  if (input.touches) {
    gestures.push({
      what: `${input.touches.length} touch(es)`,
      spec: { touches: input.touches, frames: input.frames },
      touch: true,
    });
  }
  if (input.pad) {
    gestures.push({
      what: 'a gamepad',
      spec: { pad: input.pad, frames: input.frames },
      touch: false,
    });
  }

  let allAnswered = true;
  for (const gesture of gestures) {
    const drivenPng = path.join(WORK, `${id}-${target}-driven-${gesture.what.replace(/\W+/g, '-')}.png`);
    const drive = launchPackage(id, target, [
      '--dir', out, '--out', drivenPng,
      '--w', String(editor.w), '--h', String(editor.h),
      ...(gesture.touch ? ['--touch'] : []),
      '--input', JSON.stringify(gesture.spec),
    ]);
    if (drive.status !== 0) {
      results.push({ id, target, stage: 'interact', ok: false, why: `the driven launch failed (${gesture.what})` });
      console.log(`✗ ${id} ${target} — the driven launch failed for ${gesture.what}`);
      // The tail, as the undriven launch already prints: "it failed" with no
      // reason is a red nobody can act on without re-running it by hand.
      for (const l of `${drive.stdout ?? ''}${drive.stderr ?? ''}`.split('\n').slice(-8)) {
        if (l.trim()) console.log(`    ${l}`);
      }
      allAnswered = false;
      continue;
    }

    let response;
    try {
      response = frameCellMax(readFileSync(packagePng), readFileSync(drivenPng));
    } catch (e) {
      results.push({ id, target, stage: 'interact', ok: false, why: e.message });
      console.log(`✗ ${id} ${target} — interact: ${e.message}`);
      allAnswered = false;
      continue;
    }
    const answered = response >= input.responds;
    allAnswered = allAnswered && answered;
    results.push({
      id, target, stage: 'interact', ok: answered,
      why: answered ? '' : `${gesture.what}: response ${response.toFixed(4)} < ${input.responds}`,
    });
    console.log(`${answered ? '✓' : '✗'} ${id} ${target} — parity ${distance.toFixed(4)}, `
      + `responds ${response.toFixed(4)} to ${gesture.what}`);
    if (!answered) console.log(`    the package did not visibly answer it; compare ${packagePng} and ${drivenPng}`);
  }
  void allAnswered;

  // Backgrounded, the world stops; brought back, it carries on. Three runs of
  // the same drive, read as how far the same entity got.
  const suspend = suspendFor(golden);
  if (suspend) {
    const where = (hidden) => probePositions(target, out, editor.w, editor.h, [suspend.entity], [
      '--input', JSON.stringify({ keys: suspend.keys, frames: suspend.frames, hidden }),
    ])?.[suspend.entity]?.x ?? null;

    const never = where([]);
    const stayed = where([{ from: suspend.hideFrom, to: suspend.frames - 1 }]);
    const back = where([{ from: suspend.hideFrom, to: suspend.hideTo }]);

    if (never === null || stayed === null || back === null) {
      results.push({ id, target, stage: 'suspend', ok: false, why: `could not read ${suspend.entity}` });
      console.log(`✗ ${id} ${target} — suspend: could not read ${suspend.entity} in all three runs`);
    } else {
      // Ordered, not merely different: a run left in the background must sit
      // between nothing and a run that never stopped, or "resume" only means
      // the frame kept being drawn.
      const paused = Math.abs(never - stayed) >= suspend.moves;
      const resumed = Math.abs(back - stayed) >= suspend.moves && Math.abs(never - back) >= suspend.moves;
      const between = (back - stayed) * (never - back) > 0;
      const ok = paused && resumed && between;
      results.push({
        id, target, stage: 'suspend', ok,
        why: ok ? '' : `never ${never.toFixed(0)}, stayed hidden ${stayed.toFixed(0)}, came back ${back.toFixed(0)}`,
      });
      console.log(`${ok ? '✓' : '✗'} ${id} ${target} — suspend: ${suspend.entity} at `
        + `${stayed.toFixed(0)} hidden, ${back.toFixed(0)} back, ${never.toFixed(0)} never stopped`);
    }
  }

  // A notch takes screen away from one edge, and the HUD has to come out from
  // under it. Read as an offset from a node that rides the camera: a live game
  // is somewhere slightly different each run, and that cancels.
  const safe = safeAreaFor(golden);
  if (safe) {
    const names = [safe.entity, safe.reference];
    const offset = (insets) => {
      const at = probePositions(target, out, editor.w, editor.h, names,
        insets ? ['--safe-area', insets] : []);
      const node = at?.[safe.entity];
      const ref = at?.[safe.reference];
      return node && ref ? { x: node.x - ref.x, y: node.y - ref.y } : null;
    };

    const flat = offset(null);
    const notched = offset(`${safe.top},0,0,0`);
    const sided = offset(`0,0,0,${safe.left}`);

    if (!flat || !notched || !sided) {
      results.push({ id, target, stage: 'safe-area', ok: false, why: `could not read ${safe.entity} against ${safe.reference}` });
      console.log(`✗ ${id} ${target} — safe-area: could not read ${safe.entity} against ${safe.reference} in all three runs`);
    } else {
      // World y is up, so a notch at the top pushes the HUD DOWN. The axis the
      // inset did not come from must not move at all — swapped edges are the
      // failure this catches, and they move the right distance the wrong way.
      const down = flat.y - notched.y;
      const right = sided.x - flat.x;
      const QUIET = 1;
      const fellUnderNotch = down >= safe.moves && Math.abs(notched.x - flat.x) <= QUIET;
      const clearedSide = right >= safe.moves && Math.abs(sided.y - flat.y) <= QUIET;
      // The two edges carry different insets, so their moves must carry the same
      // ratio. One hardcoded nudge satisfies everything above and fails here.
      const scaled = down > 0 && Math.abs(right / down - safe.left / safe.top) <= 0.05;
      const ok = fellUnderNotch && clearedSide && scaled;
      results.push({
        id, target, stage: 'safe-area', ok,
        why: ok ? '' : `top ${safe.top} moved it (${(notched.x - flat.x).toFixed(1)}, ${(-down).toFixed(1)}), `
          + `left ${safe.left} moved it (${right.toFixed(1)}, ${(sided.y - flat.y).toFixed(1)})`,
      });
      console.log(`${ok ? '✓' : '✗'} ${id} ${target} — safe-area: ${safe.entity} drops ${down.toFixed(1)} under a `
        + `${safe.top} notch, clears ${right.toFixed(1)} past a ${safe.left} edge`);
    }
  }
}

const bad = results.filter((r) => !r.ok);
console.log(`\ngolden ${TIER}: ${results.length - bad.length}/${results.length} pair(s) packaged and launched`);
for (const d of deferred) console.log(`  deferred: ${d}`);
if (bad.length) {
  for (const b of bad) {
    console.log(`  ✗ ${b.id} ${b.target} (${b.stage})${b.why ? ` — ${b.why.split('\n').pop()}` : ''}`);
  }
  process.exit(1);
}
