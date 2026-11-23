// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

it.each(['ci', 'local', 'worker', 'display', 'timeout'])('golden package presentation respects %s ownership', async mode => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'estella-golden-presentation-'));
  const log = path.join(temp, 'launches.log');
  try {
    const entry = path.join(realpathSync(temp), 'golden.mjs');
    const compiled = await build({ entryPoints: ['tools/verify-golden.mjs'], outfile: entry,
      bundle: true, platform: 'node', format: 'esm', metafile: true, plugins: [{
        name: 'isolated-package-contract', setup(builder) {
          builder.onResolve({ filter: /electronRun\.mjs$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
          builder.onResolve({ filter: /goldenProjects\.mjs$/ }, () => ({ path: 'registry', namespace: 'fixture' }));
          builder.onResolve({ filter: /engineBuild\.mjs$/ }, () => ({ path: 'engine', namespace: 'fixture' }));
          builder.onResolve({ filter: /^node:child_process$/ }, () => ({ path: 'process', namespace: 'fixture' }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
            const record = `import {appendFileSync} from 'node:fs';
              const record=value=>appendFileSync(${JSON.stringify(log)},JSON.stringify(value)+'\\n');`;
            if (args.path === 'electron') return { contents: `${record}
              export const NEEDS_XVFB=${mode === 'display'};
              export function runWithElectronDisplay(args,options){record({kind:'display',args,options});return {status:17};}
              export function ensureElectronBinary(){record({kind:'ensure'});}
              export function runElectron(args){record({kind:'launch',args});return {
                status:${mode === 'timeout' ? 1 : 0},
                stdout:${JSON.stringify(mode === 'timeout' ? '✗ fixture — painted=false live=true errors=0\n29 of 30 settled frames within 30000ms (phase: settle)\n' : '✓ fixture — painted=true live=true errors=0\n')},stderr:''};}
            `, loader: 'js' };
            if (args.path === 'engine') return { contents: 'export function requireCurrentEngine(){}', loader: 'js' };
            if (args.path === 'process') return { contents: `${record}
              export function spawn(){throw Error('Unexpected worker spawn');}
              export function spawnSync(_command,args){record({kind:'export',args});return {status:0,stdout:'',stderr:''};}
            `, loader: 'js' };
            return { contents: `export const ROOT=${JSON.stringify(process.cwd())};
              export const TIERS=['pr','nightly','release'];
              export const atTier=()=>[{id:'fixture',targets:['web','playable','wechat','douyin']}];
              export const sharesOf=(projects)=>[projects];
              export const projectDir=()=>${JSON.stringify(path.join(temp, 'project'))};
              export const launchTimeoutFor=()=>30000;
              export const parityFor=()=>null, interactFor=()=>null, audioFor=()=>null,
                suspendFor=()=>null, safeAreaFor=()=>null, atlasFor=()=>null,
                subpackageFor=()=>null, firstScreenFor=()=>null, packagePixels=()=>null;
            `, loader: 'js' };
          });
        },
      }] });
    expect(Object.keys(compiled.metafile!.inputs).some(file => file.endsWith('/lib/electronRun.mjs'))).toBe(false);
    const args = [entry, '--no-parity', '--work', path.join(temp, 'work'),
      ...(mode === 'worker' ? ['--worker', '--jobs', '3'] : [])];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8',
      env: { ...process.env, CI: mode === 'local' ? '' : 'true', ESTELLA_GOLDEN_SHARD: '' } });
    expect(run.status, run.stderr || run.stdout).toBe(mode === 'display' ? 17 : mode === 'timeout' ? 1 : 0);
    const records = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    if (mode === 'display') {
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ kind: 'display', args, options: { cwd: process.cwd(), stdio: 'inherit' } });
    } else {
      const launches = records.filter(record => record.kind === 'launch');
      expect(launches).toHaveLength(4);
      for (let i = 0; i < launches.length; i++) {
        const launch = launches[i].args;
        expect(launch.includes('--present')).toBe(mode !== 'local' && i < 2);
        expect(launch[launch.indexOf('--timeout') + 1]).toBe(mode === 'worker' ? '90000' : '30000');
        expect(launch[0]).toContain(i < 2 ? 'launch-export.mjs' : 'launch-minigame.mjs');
      }
    }
  } finally {
    if (path.dirname(temp) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('estella-golden-presentation-')) throw Error('Unexpected fixture path');
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
