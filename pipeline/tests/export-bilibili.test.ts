// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Bilibili MiniGame export. What is Bilibili's own: `game.json` carries the
 *        appid and version, spells `subpackages` lower-case and turns on all four
 *        high-performance switches (WebGL2 exists nowhere else there); async is
 *        lowered; and every subpackage is capped at 4MB on its own.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { bilibiliExportProfile } from '../src/export/miniGameExportProfile';
import { builtinSizeBudgets } from '../src/project/sizeBudget';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let root: string;
let out: string;
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-bilibili-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
    JSON.stringify({ uuid: SCN, version: '2.0', type: 'scene', importer: {} }));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), 'async function later(): Promise<number> { await null; return 1; }\nlater().then((n) => console.log(n));\n');
  mkdirSync(path.join(root, '_sdk', 'bilibili'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.minigame.js'),
    'export function initMiniGameRuntime(){return Promise.resolve();}\n'
    + 'export function installMiniGamePlatform(){}\n');
  writeFileSync(path.join(root, '_sdk', 'bilibili', 'index.js'), 'export const bilibiliProfile = { id: "bilibili" };\n');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.wasm'), 'wasmbytes');
  out = path.join(root, 'dist-bilibili');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('exportGame (bilibili)', () => {
  it('writes the appid, the version and the high-performance switches into game.json', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      scriptsEntry: 'src/main.ts',
      hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out,
      title: 'My Game',
      platform: 'bilibili',
      orientation: 'landscape',
      runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
      miniGameAppid: 'biligame0123456789',
      appVersion: '1.2.3',
    });
    expect(res.ok, res.errors.join('\n')).toBe(true);
    expect(JSON.parse(readFileSync(path.join(out, 'game.json'), 'utf8'))).toEqual({
      version: '1.2.3',
      appId: 'biligame0123456789',
      deviceOrientation: 'landscape',
      showStatusBar: false,
      iOSHighPerformance: true,
      'iOSHighPerformance+': true,
      androidHighPerformance: true,
      'androidHighPerformance+': true,
    });
    expect(existsSync(path.join(out, 'project.config.json'))).toBe(false);
  }, 180_000);

  it('lowers async/await, which Bilibili does not take as written', () => {
    const bundle = readFileSync(path.join(out, 'game-bundle.js'), 'utf8');
    // The project's own async function is in the bundle, as a generator.
    expect(bundle).toContain('later');
    expect(bundle).toContain('function*');
    expect(bundle).not.toMatch(/\basync function\b/);
    expect(bundle).toContain('bilibili');
  });

  it('declares subpackages under the key Bilibili reads, and an open data context when there is one', () => {
    const [cfg] = bilibiliExportProfile.emitConfigFiles({
      title: 't', appid: 'biligame1', version: '1.0.0', versionCode: 1, icon: null, orientation: 'portrait',
      subPackages: [{ name: 'level2', root: 'subpackages/level2/' }],
      includeSuffixes: [], hasOpenData: true, openDataRoot: 'open-data',
    });
    const json = JSON.parse(String(cfg.content));
    expect(json.subpackages).toEqual([{ name: 'level2', root: 'subpackages/level2/' }]);
    expect(json.openDataContext).toBe('open-data');
  });

  it('is judged per subpackage as well as on the main package and the total', () => {
    expect(builtinSizeBudgets('bilibili').map((b) => [b.scope, b.maxBytes / (1024 * 1024)]))
      .toEqual([['initial', 4], ['eachSubpackage', 4], ['total', 30]]);
  });
});
