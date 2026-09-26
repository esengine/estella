// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  with-env.mjs — run a command with some environment variables set, the
 *        same way on every shell. `VAR=1 cmd` in a package script is POSIX: cmd
 *        on Windows reads VAR=1 as the command and runs nothing.
 *
 *   node tools/with-env.mjs ESTELLA_HOTUPDATE_FIXTURE=1 -- pnpm --filter @estella/pipeline exec vitest run …
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const split = args.indexOf('--');
if (split < 1 || split === args.length - 1) {
  console.error('usage: node tools/with-env.mjs NAME=value [NAME=value …] -- command [args…]');
  process.exit(2);
}
const env = { ...process.env };
for (const pair of args.slice(0, split)) {
  const eq = pair.indexOf('=');
  if (eq < 1) {
    console.error(`with-env: "${pair}" is not NAME=value`);
    process.exit(2);
  }
  env[pair.slice(0, eq)] = pair.slice(eq + 1);
}
const [command, ...rest] = args.slice(split + 1);
const run = spawnSync(command, rest, { env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(run.status ?? 1);
