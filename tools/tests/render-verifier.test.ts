// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

it('forwards the selected scene settings and shares a display across the render shard', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'estella-render-verifier-'));
  try {
    const dir = path.join(root, 'tools');
    const entry = path.join(dir, 'verify-render.mjs');
    mkdirSync(path.join(dir, 'lib'), { recursive: true });
    copyFileSync('tools/verify-render.mjs', entry);
    copyFileSync('tools/lib/repo.mjs', path.join(dir, 'lib/repo.mjs'));
    for (const rel of ['renderScenes.mjs', 'lib/deadGpu.mjs', 'lib/engineBuild.mjs', 'lib/runTool.mjs', 'lib/toolArgs.mjs']) {
      const url = pathToFileURL(path.resolve('tools', rel)).href;
      writeFileSync(path.join(dir, rel), `export * from ${JSON.stringify(url)};`);
    }
    mkdirSync(path.join(root, 'build/render-host'), { recursive: true });
    writeFileSync(path.join(root, 'build/render-host/index.html'), '');
    writeFileSync(path.join(dir, 'lib/electronRun.mjs'), `
      export const NEEDS_XVFB = !process.env.DISPLAY && !process.env.ESTELLA_NO_XVFB;
      export function runWithElectronDisplay(args) {
        console.log('display ' + JSON.stringify(args));
        return { status: 17 };
      }
      export function runElectron(_args, { env, timeout }) {
        console.log('scene ' + JSON.stringify({ env, timeout }));
        return { status: 0, stdout: 'DRIVE_RESULT {"ok":true,"capture":{"rendered":true}}' };
      }
    `);
    const args = [entry, '--no-build', '--host', 'engine', '--only', 'groom-grown,oracle-grade-contrast'];
    const env = { ...process.env, DISPLAY: '', CI: '', ESTELLA_NO_XVFB: '', ESTELLA_VERIFY_SOFTWARE_GPU: '1' };
    const display = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    expect(display.status, display.stderr).toBe(17);
    expect(display.stdout.trim()).toBe('display ' + JSON.stringify(args));

    const launch = (extraArgs: string[], environment: typeof env) => {
      const run = spawnSync(process.execPath, [...args, ...extraArgs], { env: environment, encoding: 'utf8' });
      expect(run.status, run.stderr || run.stdout).toBe(0);
      return run.stdout.split('\n').filter(line => line.startsWith('scene ')).map(line => JSON.parse(line.slice(6)));
    };
    const software = launch(['--no-xvfb'], env);
    expect(software).toHaveLength(2);
    expect(software).toContainEqual(expect.objectContaining({ timeout: 150_000, env: expect.objectContaining({
      ESTELLA_VERIFY_SCENE: '/scenes/groom-grown.esscene', ESTELLA_VERIFY_TIMEOUT_MS: '120000',
    }) }));
    expect(software).toContainEqual(expect.objectContaining({ timeout: 75_000, env: expect.objectContaining({
      ESTELLA_VERIFY_SCENE: '/scenes/oracle-grade-contrast.esscene', ESTELLA_VERIFY_TIMEOUT_MS: '45000',
    }) }));
    const hardware = launch([], { ...env, DISPLAY: ':99', ESTELLA_VERIFY_SOFTWARE_GPU: '' });
    expect(hardware.map(job => job.timeout)).toEqual([75_000, 75_000]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
