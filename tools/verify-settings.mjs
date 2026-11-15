// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'node:path';
import net from 'node:net';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { NEEDS_XVFB, runElectron, runWithElectronDisplay } from './lib/electronRun.mjs';
import { gpuFailed, retryOnDeadGpu } from './lib/deadGpu.mjs';
import { fileURLToPath } from 'node:url';
import { toolArgs } from './lib/toolArgs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ARGS = toolArgs({ dir: null, spec: null, log: null, present: false });
const dir = ARGS.dir, specArg = ARGS.spec;
if (!dir || !specArg) throw new Error('verify-settings requires --dir and --spec');
const spec = JSON.parse(specArg);
if (NEEDS_XVFB) {
  const run = runWithElectronDisplay([fileURLToPath(import.meta.url), ...args], {cwd: root, stdio: 'inherit'});
  if (run.error) throw run.error;
  process.exit(run.status ?? 1);
}
const present = ARGS.present;
const log = ARGS.log;
const record = value => {
  if (!log) return;
  mkdirSync(path.dirname(path.resolve(log)), {recursive: true});
  appendFileSync(log, JSON.stringify(value) + '\n');
};
const server = net.createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const names = [spec.label, ...spec.bars];
let attempts = 0;
// Each attempt shares one origin/profile across restarts. A failed mutating
// attempt must restart with fresh storage, rather than clicking the same control twice.
function runAttempt() {
  const attempt = attempts++;
  const profile = mkdtempSync(path.join(os.tmpdir(), 'estella-settings-'));
  try {
    record({kind: 'attempt', attempt, profile});
    for (let i = 0; i <= spec.expected.length; i++) {
      const restart = i === spec.expected.length;
      const pointer = restart ? spec.unlock : spec.control;
      const screenshot = log ? path.resolve(`${log}.attempt-${attempt}.launch-${i}.png`) : null;
      const began = performance.now();
      const run = runElectron(['--user-data-dir=' + profile, path.join(root, 'tools/launchers/launch-export.mjs'),
        '--dir', path.resolve(dir), '--port', String(port), '--w', String(spec.w), '--h', String(spec.h),
        '--input', JSON.stringify({ pointer, frames: spec.frames ?? 60 }), '--probe', names.join(','),
        ...(present ? ['--present'] : []),
        ...(screenshot ? ['--out', screenshot] : [])], { cwd: root, encoding: 'utf8' });
      record({kind: 'launch', attempt, step: i, restart, screenshot, expected: spec.expected[restart ? i - 1 : i],
        elapsedMs: Math.round(performance.now() - began),
        status: run.status, signal: run.signal ?? null, timedOut: !!run.timedOut,
        error: run.error?.message, stdout: run.stdout ?? '', stderr: run.stderr ?? ''});
      if (run.status !== 0) {
        const output = (run.stdout || '') + (run.stderr || '');
        const error = new Error('settings restart ' + i + ' failed: status='
          + (run.status ?? 'none') + ' signal=' + (run.signal ?? 'none') + ' timedOut=' + !!run.timedOut
          + '\n' + output);
        if (gpuFailed(output)) return {ok: false, output, error, measured: false};
        throw error;
      }
      const match = /probe: (\{.*\})/.exec(run.stdout || '');
      if (!match) throw new Error('settings launch produced no probe');
      const at = JSON.parse(match[1]).at;
      const expected = spec.expected[restart ? i - 1 : i];
      if (at?.[spec.label]?.text !== expected) throw new Error(`settings label was ${at?.[spec.label]?.text}, expected ${expected}`);
      const heights = spec.bars.map(name => at?.[name]?.h);
      if (!heights.length || heights.some(h => typeof h !== 'number' || !Number.isFinite(h))) throw new Error('settings spectrum probe was incomplete');
      const peak = Math.max(...heights);
      if (i >= spec.expected.length - 1 && peak !== spec.floor) throw new Error(`restored mute still produced output: ${peak}`);
      if (i === 0 && peak <= spec.floor) throw new Error('settings test began with no audible output');
      console.log(`settings restart ${i}: ${expected}, spectrum peak ${peak}`);
    }
    return {ok: true};
  } finally {
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('estella-settings-')) {
      throw new Error('unexpected settings profile path');
    }
    rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

record({kind: 'session', startedAt: new Date().toISOString(), dir: path.resolve(dir)});
const result = retryOnDeadGpu(runAttempt, (_noVerdict, last) => {
  record({kind: 'retry', attempt: attempts - 1, reason: 'confirmed GPU failure', output: last.output});
  console.log('↻ settings GPU attempt failed; replaying the full sequence with fresh storage');
});
if (!result.ok) throw result.error;
record({kind: 'complete', attempts, launches: spec.expected.length + 1});
console.log('✓ settings survived process restart and restored mute affects output');
