// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  runTool.mjs — spawn a workspace CLI (pnpm, npx, xvfb-run) on every OS.
 */
import { spawnSync } from 'node:child_process';

/** Windows installs pnpm and npx as `.cmd` shims. Node refuses to spawn either
 *  directly (ENOENT for the bare name, EINVAL for the suffix), so they have to
 *  go through a shell — which then concatenates the args, hence the quoting. */
const VIA_SHELL = process.platform === 'win32';

const quote = (arg) => (VIA_SHELL && /[\s"^&|<>()]/.test(arg) ? `"${String(arg).replace(/"/g, '\\"')}"` : arg);

/**
 * `spawnSync` with the caller's usual result shape, except that a process which
 * never started reports as one: `status` is a failure and the reason is in
 * `stderr`. Without that a launch failure arrives as a zero-length output and
 * every caller blames whatever it was about to measure.
 */
export function runTool(cmd, args, options = {}) {
  // One string rather than a command plus args: node deprecates the second form
  // under a shell, because the shell concatenates them anyway (DEP0190).
  const r = VIA_SHELL
    ? spawnSync([cmd, ...args].map(quote).join(' '), { ...options, shell: true })
    : spawnSync(cmd, args, options);
  if (!r.error) return r;
  const why = `${cmd} did not start: ${r.error.code ?? r.error.message}`;
  return { ...r, status: r.status ?? 127, stderr: `${r.stderr ?? ''}${why}\n` };
}
