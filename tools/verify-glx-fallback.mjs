// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-glx-fallback — a WeChat package built with EmscriptenGLX still
 *        draws on a host that offers none.
 *
 * Most hosts a GLX package lands on (DevTools, iOS without 高性能+, an old base
 * library) have no GLX context, and the engine linked with it must then render
 * through WebGL2 like any other. The stand-in host is such a host, so this
 * exports a project with the setting on, checks the package carries the GLX
 * engine rather than the plain one, and boots it: the engine has to say it saw
 * no GLX, and the frame has to be drawn.
 *
 *   node tools/verify-glx-fallback.mjs   (needs build/wasm/wechat and build/wasm/wechat-glx)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = 'esengine.wxgame.wasm';
const work = mkdtempSync(path.join(tmpdir(), 'glx-fallback-'));
const project = path.join(work, 'project');
const out = path.join(work, 'out');

const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) problems.push(what);
};

try {
  cpSync(path.join(ROOT, 'examples', 'hello-world'), project, { recursive: true });
  const manifestPath = path.join(project, 'project.esproject');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.packaging ??= {};
  manifest.packaging.platforms ??= {};
  manifest.packaging.platforms.wechat = { ...manifest.packaging.platforms.wechat, emscriptenGLX: true };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const exported = spawnSync(process.execPath, [
    path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', project,
    '--platform', 'wechat', '--wasm', path.join(ROOT, 'build', 'wasm', 'wechat'), '--out', out,
  ], { encoding: 'utf8', cwd: ROOT });
  if (exported.status !== 0) {
    console.error(`${exported.stdout}${exported.stderr}`.trim().split('\n').slice(-8).join('\n'));
    throw new Error('the GLX export failed');
  }

  const shipped = readFileSync(path.join(out, 'wasm', ENGINE));
  check(shipped.equals(readFileSync(path.join(ROOT, 'build', 'wasm', 'wechat-glx', ENGINE))),
    'the package carries the GLX engine');

  const run = runElectron([path.join(ROOT, 'tools', 'launchers', 'launch-minigame.mjs'), '--dir', out,
    '--timeout', '60000'], { cwd: ROOT, encoding: 'utf8' });
  const log = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  check(log.includes('rendering through WebGL2 (this host offers no EmscriptenGLX)'),
    'the engine saw the host offers no GLX and took WebGL2');
  check(run.status === 0 && /painted=true live=true/.test(log), 'the frame is drawn');
  if (problems.length > 0) console.log(log.trim().split('\n').slice(-15).join('\n'));
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

if (problems.length > 0) {
  console.error(`verify-glx-fallback: ${problems.length} problem(s)`);
  process.exit(1);
}
