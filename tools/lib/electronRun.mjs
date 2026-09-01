// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  electronRun.mjs — the conditions Electron needs, owned by one place.
 *
 * A Linux runner has no display, and the chrome-sandbox helper shipped in
 * node_modules is not setuid root. Electron needs xvfb and the sandbox off, or
 * it aborts before a window exists.
 *
 * That knowledge lived at the CALLERS. build.yml prefixed eight steps with
 * `xvfb-run -a` and set ELECTRON_DISABLE_SANDBOX beside each; nightly.yml ran
 * the same verifiers as release criteria and did neither. So nine exit criteria
 * reported a missing display as a verdict about the engine — golden said "the
 * editor never produced a play frame", the flagship said it "cannot be played to
 * the end of its route". Both were true of the runner and of nothing else.
 *
 * A precondition that every caller must remember is a precondition one of them
 * will forget, so it belongs to the tool that needs it.
 */
import { runTool } from './runTool.mjs';

/** xvfb-run's own default is 1280x1024x8, which is smaller than the windows
 *  golden asks for and shallower than a pixel judgement should be read from. */
const SCREEN = '-screen 0 1920x1080x24';

// A job that already stands up one display for every step (because the private
// editor's scripts cannot import this file) has given us one too.
export const NEEDS_XVFB = process.platform === 'linux'
  && !process.env.DISPLAY && !process.env.ESTELLA_NO_XVFB;

/**
 * Run Electron with a script and its arguments, under whatever this host needs.
 *
 * `via` names the workspace runner that resolves the binary — 'npx' where a
 * nested package has its own. `env` merges over what this adds, never replacing.
 */
export function runElectron(args, { via = 'pnpm', env, ...options } = {}) {
  const electron = via === 'npx' ? ['npx', 'electron'] : ['pnpm', 'exec', 'electron'];
  const [cmd, ...rest] = NEEDS_XVFB
    ? ['xvfb-run', '-a', '--server-args', SCREEN, ...electron]
    : electron;
  return runTool(cmd, [...rest, ...args], {
    ...options,
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1', ...env },
  });
}
