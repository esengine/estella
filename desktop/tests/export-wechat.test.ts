// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WeChat MiniGame export — structure / contract alignment. Asserts the
 *        output matches what initWeChatRuntime consumes: AddressableManifest
 *        (asset-manifest.json), @uuid:-stripped scenes/<name>.json, the single
 *        CJS game-bundle (esengine aliased so project scripts share one instance),
 *        the game.js entry, the wasm copy, and game.json/project.config.json.
 *        (Runtime correctness is validated by the user in WeChat devtools — no
 *        simulator here.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../electron/exportGame';

let root: string;
let out: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-wechat-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('SpawnMarker', { rate: 1 });\n`);
  // Stub wechat SDK (the bundle aliases `esengine` to this) + stub -t wechat runtime.
  writeFileSync(path.join(root, '_wechat-sdk.js'), `export function initWeChatRuntime(){return Promise.resolve();}\nexport function defineComponent(){}\n`);
  mkdirSync(path.join(root, '_wxwasm'), { recursive: true });
  writeFileSync(path.join(root, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wxwasm', 'esengine.wasm'), 'wasmbytes');

  out = path.join(root, 'dist-wechat');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame (wechat)', () => {
  it('assembles a MiniGame matching the initWeChatRuntime contract', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wechatSdkEntry: path.join(root, '_wechat-sdk.js'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: out,
      title: 'My Game',
      platform: 'wechat',
      wechatAppid: 'wxTEST0123456789',
      wechatOrientation: 'landscape',
    });

    expect(res.ok).toBe(true);
    expect(res.platform).toBe('wechat');

    // AddressableManifest (asset-manifest.json), web flat manifest removed.
    expect(existsSync(path.join(out, 'assets.manifest.json'))).toBe(false);
    const manifest = JSON.parse(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8'));
    expect(manifest.version).toBe('2.0');
    expect(manifest.groups.main.assets[TEX].path).toBe('assets/hero.png');
    expect(manifest.groups.main.assets[TEX].type).toBe('texture');

    // Scene at scenes/<name>.json with @uuid: stripped to the bare uuid.
    const scene = JSON.parse(readFileSync(path.join(out, 'scenes', 'main.json'), 'utf8'));
    expect(scene.entities[0].components[0].data.texture).toBe(TEX); // no @uuid: prefix

    // One CJS bundle (SDK aliased + project scripts) exposing boot(), + the entry.
    const bundle = readFileSync(path.join(out, 'game-bundle.js'), 'utf8');
    expect(bundle).toContain('boot');
    expect(bundle).toContain('SpawnMarker'); // project script inlined into the one bundle
    const entry = readFileSync(path.join(out, 'game.js'), 'utf8');
    expect(entry).toContain("require('./game-bundle.js')");
    expect(entry).toContain("require('./wasm/esengine.js')");

    // Config + runtime copy.
    const pcfg = JSON.parse(readFileSync(path.join(out, 'project.config.json'), 'utf8'));
    expect(pcfg.compileType).toBe('game');
    expect(pcfg.projectname).toBe('My Game');
    expect(pcfg.appid).toBe('wxTEST0123456789'); // from Project Settings → Packaging
    const gjson = JSON.parse(readFileSync(path.join(out, 'game.json'), 'utf8'));
    expect(gjson.deviceOrientation).toBe('landscape');
    expect(existsSync(path.join(out, 'wasm', 'esengine.js'))).toBe(true);
    expect(existsSync(path.join(out, 'wasm', 'esengine.wasm'))).toBe(true);
  }, 60_000);
});
