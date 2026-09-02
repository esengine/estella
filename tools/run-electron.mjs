// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  run-electron.mjs — electronRun.mjs, for the callers that are shell.
 *
 * Three verify:* scripts launch a headless verifier straight from package.json,
 * where a JS module cannot be imported. Without this they would each need the
 * xvfb prefix written beside them, which is the duplication electronRun exists
 * to end.
 *
 *   node tools/run-electron.mjs <script.mjs> [args…]
 */
import { runElectron } from './lib/electronRun.mjs';
import { retryOnDeadGpu, deadGpuVerdict } from './lib/deadGpu.mjs';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('run-electron: name the script to run under electron');
  process.exit(2);
}

// Captured and relayed rather than inherited, so a dead GPU can be read off the
// output and the launch retried the way golden's are: hot-update once judged
// two white frames from an Electron whose GPU process never came up.
const r = retryOnDeadGpu(() => {
  const run = runElectron(args, { encoding: 'utf8' });
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}`, status: run.status };
}, (died) => console.log(`↻ ${args[0]} — ${died
  ? 'the GPU process never came up' : 'no frame after a GPU death'}; launching again`));
if (r.gpuDied) console.error(`✗ ${deadGpuVerdict(args[0])}`);
if (r.status === null || r.status === undefined) {
  console.error('run-electron: electron did not report a status');
  process.exit(1);
}
process.exit(r.status);
