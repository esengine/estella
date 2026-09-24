// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Quick-game export — one signed `.rpk` for the 快游戏联盟. What is its
 *        own: a manifest the alliance reads (package ending in `.minigame`,
 *        allianceVersion 1300), an icon always present, an entry that loads files
 *        without a CommonJS wrapper, the engine build without SIMD, and the rpk
 *        itself, signed with the project's key or the public debug one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { exportGame } from '../src/export/exportGame';
import { builtinSizeBudgets } from '../src/project/sizeBudget';
import { engineBuildFor } from '../src/project/platforms';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { QUICKGAME_DEFAULT_ICON } from '../src/export/quickgameDefaultIcon';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let root: string;
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-quickgame-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
    JSON.stringify({ uuid: SCN, version: '2.0', type: 'scene', importer: {} }));
  writeFileSync(path.join(root, 'my-icon.png'), 'MY ICON');
  mkdirSync(path.join(root, '_sdk', 'quickgame'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.minigame.js'),
    'export function initMiniGameRuntime(){return Promise.resolve();}\nexport function installMiniGamePlatform(){}\n');
  writeFileSync(path.join(root, '_sdk', 'quickgame', 'index.js'), 'export const quickgameProfile = { id: "quickgame" };\n');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.js'), 'module.exports = function engine() {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.wasm'), 'wasm');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const run = (out: string, extra: Record<string, unknown> = {}) => exportGame({
  root, entryScene: 'scenes/main.esscene',
  hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
  sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
  outDir: path.join(root, out), title: 'My Game', platform: 'quickgame', orientation: 'portrait',
  runtime: runtimeConfigOf({ designResolution: { width: 720, height: 1280 } }),
  miniGameAppid: 'com.estella.test.minigame', appVersion: '1.4.0', miniGameVersionCode: 7,
  ...extra,
});

describe('exportGame (quickgame)', () => {
  it('writes the manifest the alliance reads and the package it installs', async () => {
    const res = await run('dist');
    expect(res.ok, res.errors.join('\n')).toBe(true);
    const out = path.join(root, 'dist');
    expect(JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'))).toMatchObject({
      package: 'com.estella.test.minigame', name: 'My Game', icon: '/icon.png',
      versionName: '1.4.0', versionCode: 7, allianceVersion: 1300, type: 'game',
      orientation: 'portrait', deviceOrientation: 'portrait',
    });
    expect(res.packageFile).toBe(path.join(out, 'com.estella.test.minigame.rpk'));
    expect(readFileSync(res.packageFile!).includes(Buffer.from('RPK Sig Block 42'))).toBe(true);
    expect(res.warnings.join('\n')).toContain('public debug key');
  }, 180_000);

  it('carries Estella\'s mark when the project sets no icon, and the project\'s when it does', async () => {
    expect(readFileSync(path.join(root, 'dist', 'icon.png')).equals(Buffer.from(QUICKGAME_DEFAULT_ICON))).toBe(true);
    await run('dist-icon', { appIcon: 'my-icon.png' });
    expect(readFileSync(path.join(root, 'dist-icon', 'icon.png'), 'utf8')).toBe('MY ICON');
  }, 180_000);

  it('loads its files on a host that evaluates them with no module wrapper', () => {
    // The host's require: evaluate at global scope, return nothing.
    const out = path.join(root, 'dist');
    const booted: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      qg: {},
      require: (p: string) => {
        const file = path.join(out, p.replace(/^\.\//, ''));
        const src = p.endsWith('game-bundle.js')
          ? 'module.exports = { boot: function (f) { globalThis.__booted.push(typeof f); return Promise.resolve(); } };'
          : readFileSync(file, 'utf8');
        runInNewContext(src, sandbox);
      },
      __booted: booted,
      console,
      Promise,
    };
    sandbox.globalThis = sandbox;
    runInNewContext(readFileSync(path.join(out, 'game.js'), 'utf8'), sandbox);
    expect(booted).toEqual(['function']);
  });

  it('refuses a package name the host will not take', async () => {
    await expect(run('dist-bad', { miniGameAppid: 'com.estella.test' })).rejects.toThrow('ends in ".minigame"');
  });

  it('runs on the engine build without SIMD, judged against the alliance\'s tightest caps', () => {
    expect(engineBuildFor('quickgame')).toBe('quickgame');
    expect(engineBuildFor('wechat')).toBe('minigame');
    expect(builtinSizeBudgets('quickgame').map((b) => [b.scope, b.maxBytes / (1024 * 1024)]))
      .toEqual([['initial', 4], ['total', 20]]);
    expect(existsSync(path.join(root, 'dist', 'project.config.json'))).toBe(false);
  });
});
