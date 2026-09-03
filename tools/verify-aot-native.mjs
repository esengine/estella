// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-aot-native.mjs — a packaged desktop game runs its systems as machine code.
 *
 * The wasm road is gated end to end and the pieces of this one are gated apart:
 * the module builds, the loader opens it, the dispatcher binds it, the SDK
 * installs it. None of that says a shipped app on this machine actually reaches
 * a compiled system, and the ways it can fail to are quiet — a module staged
 * where the loader does not look, a config field no host projects, a pool that
 * does not exist yet at install.
 *
 * So: export the example that marks a system `@compiled`, run the app it
 * assembles, and require the runtime to say both things. Installed is not
 * enough: a module can load and never be dispatched to, and on this road the
 * two are different frames.
 *
 *   node tools/verify-aot-native.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedTemplateDir } from '../build-tools/utils/nativeTemplate.js';
import { desktopExecutableIn } from '../build-tools/utils/desktopApp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The example whose system carries the marker. */
const PROJECT = path.join(ROOT, 'examples', 'ecs-basics');
/**
 * Frames to let run before the shot: enough for a pool to exist and be bound.
 * Engine frames, at the host's fixed shot step (Shot.hpp): ecs-basics spawns its
 * first `Mover` 0.8 s into the game, and 90 frames of wall time on a runner with
 * no display to wait for is a third of that.
 */
const SHOT_FRAME = '90';

const version = JSON.parse(
  spawnSync(process.execPath, ['-p', 'JSON.stringify(require("./package.json"))'],
    { cwd: ROOT, encoding: 'utf8' }).stdout || '{}',
).version;

// The template vocabulary, which is the OS a desktop app is BUILT as. Spelled
// here because pipeline's own answer is TypeScript and this file is not.
const os = process.platform === 'darwin' ? 'macos'
  : process.platform === 'win32' ? 'windows' : 'linux';
const template = installedTemplateDir(version, os);
if (!template || !existsSync(template)) {
  // Saying so was not enough: this exited 0, so the release gate read the
  // criterion as answered on every runner that never had a template. 2 is the
  // convention for a machine that cannot answer, which is not a verdict.
  console.log(`aot native: no ${os} runtime template for v${version} — did NOT run.`);
  console.log('  build one with: node build-tools/cli.js native --target ' + os);
  process.exit(2);
}

const out = mkdtempSync(path.join(tmpdir(), 'estella-aot-native-'));
try {
  const exported = spawnSync(process.execPath, [
    path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', PROJECT,
    '--platform', 'desktop', '--out', out, '--template', template,
  ], { encoding: 'utf8', cwd: ROOT });
  if (exported.status !== 0) {
    console.error('✗ the export failed');
    console.error((exported.stderr || exported.stdout || '').trim().slice(-600));
    process.exit(1);
  }

  const exe = desktopExecutableIn(out, os);
  if (exe === null) {
    console.error(`✗ the export assembled no app under ${out}`);
    process.exit(1);
  }

  const run = spawnSync(exe, [], {
    encoding: 'utf8',
    cwd: path.dirname(exe),
    env: {
      ...process.env,
      ESTELLA_SHOT: path.join(out, 'frame.raw'),
      ESTELLA_SHOT_FRAME: SHOT_FRAME,
      ESTELLA_SHOT_QUIT: '1',
    },
  });
  const log = `${run.stdout ?? ''}${run.stderr ?? ''}`;

  const installed = /AOT: (\d+) compiled system\(s\) installed/.exec(log);
  const running = /AOT: (\w+) is running compiled/.exec(log);
  const drew = /"rendered":true/.test(log);

  const problems = [];
  if (installed === null || Number(installed[1]) < 1) problems.push('no module was installed');
  // The claim this file exists for. A module that loads and is never dispatched
  // to leaves the line above intact and the game entirely interpreted.
  if (running === null) problems.push('no system was ever dispatched to as compiled');
  if (!drew) problems.push('the app never drew a frame');

  if (problems.length > 0) {
    console.error('✗ aot native: ' + problems.join('; '));
    // ALSA says "error" a dozen times on a runner with no sound card, and those
    // took every one of these ten lines the first time this ran on one.
    const telling = (l) => /aot|AOT|error|ERROR/.test(l) && !/^ALSA lib /.test(l);
    for (const line of log.split('\n').filter(telling).slice(0, 10)) {
      console.error(`    ${line.trim()}`);
    }
    process.exit(1);
  }
  console.log(`✓ aot native: ${installed[1]} installed, ${running[1]} running compiled, and it drew`);
} finally {
  rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
