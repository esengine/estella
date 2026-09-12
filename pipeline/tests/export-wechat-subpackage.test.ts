// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WeChat 分包 — a `subPackages` root the package does not carry is a hard
 *        devtools failure ("root 不存在"), so the declaration and the staging
 *        must come from one decision. The group here is authored through
 *        `.esengine/asset-groups.json` on an ordinary `assets/` folder, which is
 *        how the editor's Delivery menu writes it — the legacy
 *        `subpackages/<name>/` folder convention hides the bug by naming the
 *        staged path after the root it needs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';

let root: string;
let out: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LAZY = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-wechat-subpkg-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  // The user's folder: made in assets/, then marked 分包 in the editor.
  mkdirSync(path.join(root, 'assets', 'level2'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'level2', 'extra.png'), 'PNG2DATA');
  writeFileSync(path.join(root, 'assets', 'level2', 'extra.png.meta'), meta(LAZY, 'texture'));
  mkdirSync(path.join(root, '.esengine'), { recursive: true });
  writeFileSync(
    path.join(root, '.esengine', 'asset-groups.json'),
    JSON.stringify({ version: '1.0', groups: { level2: { folder: 'assets/level2', mode: 'subpackage' } } }),
  );
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('SpawnMarker', { rate: 1 });\n`);
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.wechat.js'), `export function initWeChatRuntime(){return Promise.resolve();}\nexport function defineComponent(){}\n`);
  mkdirSync(path.join(root, '_wxwasm'), { recursive: true });
  writeFileSync(path.join(root, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wxwasm', 'esengine.wasm'), 'wasmbytes');
  out = path.join(root, 'dist-wechat');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('WeChat 分包 declared through asset-groups.json', () => {
  it('stages every declared subPackage root', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: out,
      title: 'My Game',
      platform: 'wechat',
      wechatAppid: 'wxTEST0123456789',
      orientation: 'landscape',
      runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
    });
    expect(res.ok).toBe(true);

    const gjson = JSON.parse(readFileSync(path.join(out, 'game.json'), 'utf8'));
    expect(gjson.subPackages).toContainEqual({ name: 'level2', root: 'subpackages/level2' });

    // WeChat rejects a root the package does not carry, and an EMPTY directory
    // does not survive packing — the root must hold the group's files.
    for (const sp of gjson.subPackages as Array<{ root: string }>) {
      const dir = path.join(out, sp.root);
      expect(existsSync(dir), `${sp.root} missing from the package`).toBe(true);
      expect(readdirSync(dir, { recursive: true }).length, `${sp.root} is empty`).toBeGreaterThan(0);
    }
  }, 120_000);

  it('never declares a root nothing was staged under', async () => {
    // A scene keeps its logical path in every layout, so a group made of one
    // cannot be delivered — the declaration must follow the files, not the group.
    const root2 = mkdtempSync(path.join(tmpdir(), 'estella-wechat-subpkg-scene-'));
    try {
      mkdirSync(path.join(root2, 'scenes', 'levels'), { recursive: true });
      writeFileSync(
        path.join(root2, 'scenes', 'main.esscene'),
        JSON.stringify({ version: '1.0', name: 'Main', entities: [] }),
      );
      writeFileSync(path.join(root2, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
      writeFileSync(
        path.join(root2, 'scenes', 'levels', 'two.esscene'),
        JSON.stringify({ version: '1.0', name: 'Two', entities: [] }),
      );
      writeFileSync(path.join(root2, 'scenes', 'levels', 'two.esscene.meta'), meta(LAZY, 'scene'));
      mkdirSync(path.join(root2, '.esengine'), { recursive: true });
      writeFileSync(
        path.join(root2, '.esengine', 'asset-groups.json'),
        JSON.stringify({
          version: '1.0',
          groups: { levels: { folder: 'scenes/levels', mode: 'subpackage', alwaysInclude: true } },
        }),
      );
      mkdirSync(path.join(root2, '_sdk'), { recursive: true });
      writeFileSync(path.join(root2, '_sdk', 'index.wechat.js'), 'export function initWeChatRuntime(){return Promise.resolve();}\n');
      mkdirSync(path.join(root2, '_wxwasm'), { recursive: true });
      writeFileSync(path.join(root2, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
      writeFileSync(path.join(root2, '_wxwasm', 'esengine.wasm'), 'wasmbytes');
      const out2 = path.join(root2, 'dist-wechat');

      const res = await exportGame({
        root: root2,
        entryScene: 'scenes/main.esscene',
        gameHostEntry: 'unused-for-wechat',
        sdkDistDir: path.join(root2, '_sdk'),
        wasmDir: path.join(root2, '_wxwasm'),
        outDir: out2,
        title: 'Scene Group',
        platform: 'wechat',
        wechatAppid: 'wxTEST0123456789',
        orientation: 'landscape',
        runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
      });
      expect(res.ok).toBe(true);

      const gjson = JSON.parse(readFileSync(path.join(out2, 'game.json'), 'utf8'));
      expect(gjson.subPackages ?? []).toEqual([]);
      expect(res.warnings.join('\n')).toMatch(/levels/);
    } finally {
      rmSync(root2, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 120_000);
});
