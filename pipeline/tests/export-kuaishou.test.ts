// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Kuaishou MiniGame export — a third vendor through the same pipeline.
 *        What is Kuaishou's own: a package of `game.js` + `game.json` with no
 *        project config and no appid in it, `subpackages` spelled lower-case,
 *        the `ks` host named by the entry, and caps of 6MB / 30MB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { kuaishouExportProfile } from '../src/export/miniGameExportProfile';
import { builtinSizeBudgets } from '../src/project/sizeBudget';
import { builtinServiceSupport } from '../src/project/serviceSupport';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let root: string;
let out: string;
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-kuaishou-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
    JSON.stringify({ uuid: SCN, version: '2.0', type: 'scene', importer: {} }));
  mkdirSync(path.join(root, '_sdk', 'kuaishou'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.minigame.js'),
    'export function initMiniGameRuntime(){return Promise.resolve();}\n'
    + 'export function installMiniGamePlatform(){}\n');
  writeFileSync(path.join(root, '_sdk', 'kuaishou', 'index.js'),
    'export const kuaishouProfile = { id: "kuaishou", hostLabel: "\\u5feb\\u624b" };\n');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.wasm'), 'wasmbytes');
  out = path.join(root, 'dist-kuaishou');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('exportGame (kuaishou)', () => {
  it('writes game.json and nothing a Kuaishou package does not carry', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out,
      title: 'My Game',
      platform: 'kuaishou',
      orientation: 'portrait',
      runtime: runtimeConfigOf({ designResolution: { width: 720, height: 1280 } }),
      miniGameAppid: 'should-not-appear',
    });
    expect(res.ok, res.errors.join('\n')).toBe(true);
    expect(res.platform).toBe('kuaishou');

    expect(JSON.parse(readFileSync(path.join(out, 'game.json'), 'utf8'))).toEqual({ deviceOrientation: 'portrait' });
    // The appid is entered in the developer tool; the package has no file for it.
    expect(existsSync(path.join(out, 'project.config.json'))).toBe(false);
    expect(existsSync(path.join(out, 'game.js'))).toBe(true);
  }, 180_000);

  it('installs the ks profile before booting', () => {
    const bundle = readFileSync(path.join(out, 'game-bundle.js'), 'utf8');
    expect(bundle).toContain('installMiniGamePlatform');
    expect(bundle).toContain('kuaishou');
    expect(readFileSync(path.join(out, 'game.js'), 'utf8')).toContain("require('./wasm/esengine.wxgame.js')");
  });

  it('declares subpackages under the key Kuaishou reads', () => {
    const [cfg] = kuaishouExportProfile.emitConfigFiles({
      title: 't', appid: '', version: '1.0.0', versionCode: 1, icon: null, orientation: 'landscape',
      subPackages: [{ name: 'level2', root: 'subpackages/level2/' }],
      includeSuffixes: [], hasOpenData: false, openDataRoot: 'open-data',
    });
    const json = JSON.parse(String(cfg.content));
    expect(json.subpackages).toEqual([{ name: 'level2', root: 'subpackages/level2/' }]);
    expect(json).not.toHaveProperty('subPackages');
  });

  it('is judged against 6MB and 30MB, and claims no purchase', () => {
    expect(builtinSizeBudgets('kuaishou').map((b) => [b.scope, b.maxBytes / (1024 * 1024)]))
      .toEqual([['initial', 6], ['total', 30]]);
    expect(builtinServiceSupport('kuaishou').find((s) => s.service === 'purchase')?.support).toBe('no');
  });
});
