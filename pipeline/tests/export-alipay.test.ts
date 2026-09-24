// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Alipay MiniGame export. What is Alipay's own: `game.json` with iOS
 *        high-performance mode on (the only iOS mode with MYWebAssembly) and
 *        `subpackages` lower-case, a `project.config.json` that turns the review
 *        build's transpile and minify off, no appid in the package, and the
 *        engine build without SIMD.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { alipayExportProfile } from '../src/export/miniGameExportProfile';
import { builtinSizeBudgets } from '../src/project/sizeBudget';
import { engineBuildFor } from '../src/project/platforms';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let root: string;
let out: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-alipay-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
    JSON.stringify({ uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', version: '2.0', type: 'scene', importer: {} }));
  mkdirSync(path.join(root, '_sdk', 'alipay'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.minigame.js'),
    'export function initMiniGameRuntime(){return Promise.resolve();}\nexport function installMiniGamePlatform(){}\n');
  writeFileSync(path.join(root, '_sdk', 'alipay', 'index.js'), 'export const alipayProfile = { id: "alipay" };\n');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.wasm'), 'wasm');
  out = path.join(root, 'dist-alipay');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('exportGame (alipay)', () => {
  it('writes the two configs Alipay reads, and no appid', async () => {
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene',
      hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), outDir: out,
      title: 'My Game', platform: 'alipay', orientation: 'portrait',
      runtime: runtimeConfigOf({ designResolution: { width: 720, height: 1280 } }),
      miniGameAppid: 'should-not-appear',
    });
    expect(res.ok, res.errors.join('\n')).toBe(true);
    expect(JSON.parse(readFileSync(path.join(out, 'game.json'), 'utf8')))
      .toEqual({ deviceOrientation: 'portrait', showStatusBar: false, iOSHighPerformance: true });
    expect(JSON.parse(readFileSync(path.join(out, 'project.config.json'), 'utf8')))
      .toEqual({ setting: { transpile: false, minify: false } });
    expect(readFileSync(path.join(out, 'game-bundle.js'), 'utf8')).toContain('alipay');
    expect(readFileSync(path.join(out, 'game.js'), 'utf8')).not.toContain('should-not-appear');
  }, 180_000);

  it('declares subpackages under the key Alipay reads', () => {
    const [cfg] = alipayExportProfile.emitConfigFiles({
      title: 't', appid: '', version: '1.0.0', versionCode: 1, icon: null, orientation: 'landscape',
      subPackages: [{ name: 'stage1', root: 'subpackages/stage1/' }],
      includeSuffixes: [], hasOpenData: false, openDataRoot: 'open-data',
    });
    expect(JSON.parse(String(cfg.content)).subpackages).toEqual([{ name: 'stage1', root: 'subpackages/stage1/' }]);
  });

  it('runs on the engine build without SIMD, judged against 4MB and 20MB', () => {
    expect(engineBuildFor('alipay')).toBe('quickgame');
    expect(builtinSizeBudgets('alipay').map((b) => [b.scope, b.maxBytes / (1024 * 1024)]))
      .toEqual([['initial', 4], ['total', 20]]);
  });
});
