// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Huawei quick-game export: the alliance's signed `.rpk` with Huawei's
 *        own manifest (`appType: "fastgame"`, orientation under `display`), the
 *        same no-CommonJS entry, and a refusal — not a broken package — where
 *        Huawei's layout is not written yet (subpackages).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { huaweiExportProfile } from '../src/export/miniGameExportProfile';
import { builtinSizeBudgets } from '../src/project/sizeBudget';
import { engineBuildFor } from '../src/project/platforms';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-huawei-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
    JSON.stringify({ uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', version: '2.0', type: 'scene', importer: {} }));
  mkdirSync(path.join(root, '_sdk', 'huawei'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.minigame.js'),
    'export function initMiniGameRuntime(){return Promise.resolve();}\nexport function installMiniGamePlatform(){}\n');
  writeFileSync(path.join(root, '_sdk', 'huawei', 'index.js'), 'export const huaweiProfile = { id: "huawei" };\n');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.wasm'), 'wasm');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const ctx = (over: Record<string, unknown> = {}) => ({
  title: 'T', appid: 'com.estella.test', version: '1.0.0', versionCode: 3, icon: null, orientation: 'landscape' as const,
  subPackages: [], includeSuffixes: [], hasOpenData: false, openDataRoot: 'open-data', ...over,
});

describe('exportGame (huawei)', () => {
  it('writes Huawei\'s manifest and a signed rpk named for the package', async () => {
    const out = path.join(root, 'dist');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene',
      hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), outDir: out,
      title: 'My Game', platform: 'huawei', orientation: 'portrait',
      runtime: runtimeConfigOf({ designResolution: { width: 720, height: 1280 } }),
      miniGameAppid: 'com.estella.test', appVersion: '2.0.0', miniGameVersionCode: 5,
    });
    expect(res.ok, res.errors.join('\n')).toBe(true);
    expect(JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'))).toEqual({
      package: 'com.estella.test', name: 'My Game', appType: 'fastgame', icon: '/icon.png',
      versionName: '2.0.0', versionCode: 5, minPlatformVersion: 1103,
      config: { logLevel: 'log' }, display: { orientation: 'portrait', fullScreen: true },
    });
    expect(res.packageFile).toBe(path.join(out, 'com.estella.test.rpk'));
    expect(readFileSync(path.join(out, 'game.js'), 'utf8')).toContain('__load(');
    expect(res.warnings.join('\n')).toContain('Huawei quick game');
  }, 180_000);

  it('refuses what it cannot package yet, and a package with no name', () => {
    expect(() => huaweiExportProfile.emitConfigFiles(ctx({ subPackages: [{ name: 'l2', root: 'subpackages/l2/' }] })))
      .toThrow('each subpackage as its own .rpk');
    expect(() => huaweiExportProfile.emitConfigFiles(ctx({ appid: '' }))).toThrow('no package name');
  });

  it('runs on the engine build without SIMD, judged against 4MB and the 20MB AppGallery takes', () => {
    expect(engineBuildFor('huawei')).toBe('quickgame');
    expect(builtinSizeBudgets('huawei').map((b) => [b.scope, b.maxBytes / (1024 * 1024)]))
      .toEqual([['initial', 4], ['total', 20]]);
  });
});
