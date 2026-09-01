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

const args = process.argv.slice(2);
if (!args.length) {
  console.error('run-electron: name the script to run under electron');
  process.exit(2);
}
const r = runElectron(args, { stdio: 'inherit' });
if (r.status === null) {
  console.error(r.stderr?.toString().trim() || 'run-electron: electron did not report a status');
  process.exit(1);
}
process.exit(r.status);
