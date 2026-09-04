// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-native-conformance.mjs — the native host answers the interpreter.
 *
 * The suite compares closures against a wasm module, and `test_aot_conformance`
 * compares the emitted C against the same answer. Both run in a test process.
 * Neither says what a PLAYER gets: a packaged game, on the host that embeds
 * QuickJS and the engine, stepping frames the way a frame is stepped.
 *
 * So the fixture ships as a project and runs twice on this machine's runtime
 * template — interpreted, and with its systems compiled — printing what the two
 * systems left after every frame. Both roads are held against the trace the
 * interpreter recorded in the suite: same source, same seeds, same delta, three
 * executors and now a fourth.
 *
 * The two false greens are guarded rather than assumed. A compiled road that
 * quietly fell back to the interpreter agrees with the trace perfectly, so the
 * run has to SAY a system was dispatched to; and an interpreted road that
 * dispatched to one would not be the twin it claims to be.
 *
 *   node tools/verify-native-conformance.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedTemplateDir } from '../build-tools/utils/nativeTemplate.js';
import { desktopExecutableIn } from '../build-tools/utils/desktopApp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'fixtures', 'aot-conformance');
const TRACE = path.join(ROOT, 'tests', 'aot', 'generated', 'conformance', 'trace.json');

/** Frames to run past the ones compared: a host is free to spend its first on
 *  boot, and a road that only agrees for as long as it is watched is a road
 *  that diverges on frame 13. */
const EXTRA_FRAMES = 8;

const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// The template vocabulary, which is the OS a desktop app is BUILT as.
const os = process.platform === 'darwin' ? 'macos'
  : process.platform === 'win32' ? 'windows' : 'linux';

const template = installedTemplateDir(version, os);
if (!template || !existsSync(template)) {
  // 2, not 0: a machine that cannot answer has not answered, and a criterion
  // that reads as met on every runner without a template says nothing anywhere.
  console.log(`native conformance: no ${os} runtime template for v${version} — did NOT run.`);
  console.log(`  build one with: node build-tools/cli.js native --target ${os}`);
  process.exit(2);
}
if (!existsSync(TRACE)) {
  console.log('native conformance: no interpreter trace — did NOT run.');
  console.log('  record one with: ESTELLA_AOT_WRITE=1 pnpm --filter @estella/sdk test aot-conformance');
  process.exit(2);
}

const want = JSON.parse(readFileSync(TRACE, 'utf8'));
const FRAMES = want.frames.length;

/** Export the fixture and run it, or `null` where this machine cannot compile. */
function play(compiled) {
  const out = mkdtempSync(path.join(tmpdir(), 'estella-conf-native-'));
  try {
    const args = [
      path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', PROJECT,
      '--platform', 'desktop', '--out', out, '--template', template,
    ];
    if (!compiled) args.push('--no-aot');
    const exported = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
    if (exported.status !== 0) {
      const said = `${exported.stdout ?? ''}${exported.stderr ?? ''}`;
      // A machine with no host C compiler cannot build the compiled road. That
      // is a missing toolchain, not a disagreement.
      if (compiled && /no C compiler/.test(said)) return null;
      fail('the export failed', said.trim().slice(-600));
    }

    const exe = desktopExecutableIn(out, os);
    if (exe === null) fail(`the export assembled no app under ${out}`);

    const run = spawnSync(exe, [], {
      encoding: 'utf8',
      cwd: path.dirname(exe),
      env: {
        ...process.env,
        // The host's own fixed-delta loop, which is what makes two runs on two
        // roads comparable at all. No warmup: frame 0 is one of the answers.
        ESTELLA_BENCH_FRAMES: String(FRAMES + EXTRA_FRAMES),
        ESTELLA_BENCH_WARMUP: '0',
        ESTELLA_BENCH_DT: String(want.delta),
        ESTELLA_BENCH_QUIT: '1',
        ESTELLA_BENCH_LABEL: compiled ? 'conformance-aot' : 'conformance-interpreted',
      },
    });
    return { log: `${run.stdout ?? ''}${run.stderr ?? ''}`, status: run.status };
  } finally {
    rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

/** `CONF <frame> <delta> <rows>` — what the fixture's own reporting system says. */
function framesIn(log) {
  const out = [];
  for (const line of log.split('\n')) {
    const m = /CONF (\d+) (\S+) (\[.*\])\s*$/.exec(line);
    if (m !== null) out.push({ at: Number(m[1]), delta: Number(m[2]), rows: JSON.parse(m[3]) });
  }
  return out;
}

function fail(what, detail) {
  console.error(`✗ native conformance: ${what}`);
  if (detail) console.error(detail.split('\n').map((l) => `    ${l}`).join('\n'));
  process.exit(1);
}

/** Every field of every row, in the order the trace records them. */
function compare(road, got) {
  if (got.length < FRAMES) {
    fail(`${road} reported ${got.length} frame(s), and the trace has ${FRAMES}`,
      got.length === 0 ? 'the fixture printed nothing — did its reporting system run?' : '');
  }
  for (let f = 0; f < FRAMES; f++) {
    const frame = got[f];
    if (frame.at !== f) fail(`${road} skipped a frame: expected ${f}, got ${frame.at}`);
    // A road that stepped by another delta is a different finding from one that
    // computed the step wrong, and saying which is the point of printing it.
    if (frame.delta !== want.delta) {
      fail(`${road} stepped frame ${f} by ${frame.delta}, and the trace was recorded at ${want.delta}`);
    }
    const wantRows = want.frames[f];
    if (frame.rows.length !== wantRows.length) {
      fail(`${road} has ${frame.rows.length} row(s) at frame ${f}, and the trace has ${wantRows.length}`);
    }
    for (let i = 0; i < wantRows.length; i++) {
      for (let k = 0; k < wantRows[i].length; k++) {
        if (frame.rows[i][k] !== wantRows[i][k]) {
          fail(`${road} disagrees at frame ${f}, entity ${i}, ${want.fields[k]}`,
            `interpreter ${wantRows[i][k]}\nhost        ${frame.rows[i][k]}`);
        }
      }
    }
  }
}

const RUNNING = /AOT: (\w+) is running compiled/;
const RUNNING_ALL = /AOT: (\w+) is running compiled/g;
const INSTALLED = /AOT: (\d+) compiled system\(s\) installed/;

const interpreted = play(false);
if (interpreted === null) fail('the interpreted export could not be built');
compare('the interpreted host', framesIn(interpreted.log));
// The twin has to be a twin: a road dispatching to a compiled system is not the
// interpreter, and comparing it against the trace would prove the wrong thing.
if (RUNNING.test(interpreted.log)) {
  fail('the --no-aot build dispatched to a compiled system — it is not the interpreted road');
}

const compiled = play(true);
if (compiled === null) {
  console.log('✓ native conformance: the interpreted host answers the interpreter, '
    + `frame for frame (${FRAMES} frames).`);
  console.log('  the compiled road did NOT run: this machine has no host C compiler.');
  process.exit(2);
}
compare('the compiled host', framesIn(compiled.log));
// Installed is not running, and a fallback is silent by design: the closure that
// would have run produces the same numbers, so the trace alone cannot see it.
const ran = new Set([...compiled.log.matchAll(RUNNING_ALL)].map((m) => m[1]));
if (ran.size === 0) fail('no system was ever dispatched to as compiled — the run proves nothing');
// And EVERY system that installed has to be one of them. One twin taken and one
// quietly interpreted matches the trace exactly, because the fallback is right.
const installed = INSTALLED.exec(compiled.log);
if (installed === null) fail('the run never said how many systems installed');
if (ran.size !== Number(installed[1])) {
  fail(`${installed[1]} system(s) installed and ${ran.size} were dispatched to`,
    `compiled: ${[...ran].join(', ') || '(none)'}`);
}

console.log(`✓ native conformance: both roads answer the interpreter, frame for frame `
  + `(${FRAMES} frames, ${want.frames[0].length} entities).`);
console.log(`  interpreted, and every one of ${installed[1]} compiled system(s) dispatched to `
  + `on the packaged host: ${[...ran].join(', ')}.`);
