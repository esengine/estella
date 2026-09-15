// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The mini-game package must answer the path its own runtime asks for.
 *
 *        Two halves have to agree and only a build can show that they do: the
 *        exporter decides the NAME a file ships under, and the shipped runtime
 *        decides the name it hands the host filesystem (manifest lookup, then
 *        the adapter's path mapping). Nothing in either half reads the other,
 *        so a rename on one side is invisible until a device says "file not
 *        found" — which is how a build shipped every prefab and material under
 *        a name no read would ever produce.
 *
 *        So this drives the REAL read the packaged runtime performs — manifest
 *        lookup (`indexPackagedManifest`) then the shipped adapter over the
 *        exported directory — and asserts every spelling of every asset lands
 *        on a file the package carries.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { indexPackagedManifest } from '../../sdk/src/runtime/packagedRuntime';
import { MiniGamePlatformAdapter } from '../../sdk/src/platform/minigame/adapter';
import type { MiniGameGlobal } from '../../sdk/src/platform/minigame/api';
import type { AddressableManifest } from '../../sdk/src/asset/AddressableManifest';

const TEX = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MAT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const PREFAB = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const SCN = '11111111-2222-3333-4444-555555555555';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** A project whose scene names a prefab and a material — the custom extensions
 *  whose CONTENT is JSON, which is what the mapping under test keys on. */
function scaffold(): { root: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-wechat-readpath-'));
  roots.push(root);
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  writeFileSync(
    path.join(root, 'assets', 'hero.esmaterial'),
    JSON.stringify({ version: '1.0', shader: 'builtin:sprite', properties: { mainTexture: `@uuid:${TEX}` } }),
  );
  writeFileSync(path.join(root, 'assets', 'hero.esmaterial.meta'), meta(MAT, 'material'));
  writeFileSync(
    path.join(root, 'assets', 'hero.esprefab'),
    JSON.stringify({ version: '1.0', name: 'Hero', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'assets', 'hero.esprefab.meta'), meta(PREFAB, 'prefab'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({
      version: '1.0', name: 'Main',
      entities: [{
        id: 0,
        components: [
          { type: 'Sprite', data: { texture: `@uuid:${TEX}`, material: `@uuid:${MAT}` } },
          { type: 'PrefabInstance', data: { prefab: `@uuid:${PREFAB}` } },
        ],
      }],
    }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), "import { defineComponent } from 'esengine';\ndefineComponent('Marker', { n: 1 });\n");
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.wechat.js'), 'export function initWeChatRuntime(){return Promise.resolve();}\nexport function defineComponent(){}\n');
  mkdirSync(path.join(root, '_wxwasm'), { recursive: true });
  writeFileSync(path.join(root, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wxwasm', 'esengine.wasm'), 'wasmbytes');
  return { root, out: path.join(root, 'dist-wechat') };
}

/** The shipped adapter over the exported package — the host filesystem is the
 *  staged directory, so a read asks for exactly what a device would ask for. */
function adapterOver(out: string): MiniGamePlatformAdapter {
  const fs = {
    readFileSync: (p: string, encoding?: string) => {
      const abs = path.join(out, p);
      if (!existsSync(abs)) throw new Error(`no such file or directory ${p}`);
      return encoding ? readFileSync(abs, 'utf8') : readFileSync(abs).buffer;
    },
    accessSync: (p: string) => {
      if (!existsSync(path.join(out, p))) throw new Error(`no such file or directory ${p}`);
    },
  };
  const global = { getFileSystemManager: () => fs } as unknown as MiniGameGlobal;
  return new MiniGamePlatformAdapter({ id: 'wechat', hostLabel: 'WeChat', global });
}

describe('exportGame (wechat) — every asset resolves to a file the package carries', () => {
  it('resolves each manifest asset to a staged file', async () => {
    const { root, out } = scaffold();
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: out,
      platform: 'wechat',
    });
    expect(res.ok).toBe(true);

    const manifest = JSON.parse(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8')) as AddressableManifest;
    const index = indexPackagedManifest(manifest);

    // Both the prefab and the material ship — the scene names them — and the
    // packer is told to carry those suffixes, else the file never lands.
    const keys = Object.keys(manifest.groups.main.assets);
    expect(keys).toContain(MAT);
    expect(keys).toContain(PREFAB);
    const pcfg = JSON.parse(readFileSync(path.join(out, 'project.config.json'), 'utf8'));
    expect(pcfg.packOptions.include).toContainEqual({ type: 'suffix', value: '.esprefab' });
    expect(pcfg.packOptions.include).toContainEqual({ type: 'suffix', value: '.esmaterial' });

    // Every spelling the game can hold: the uuid a scene carries, and the
    // project-relative path code writes by hand.
    const adapter = adapterOver(out);
    const missing: string[] = [];
    for (const [uuid, asset] of Object.entries(manifest.groups.main.assets)) {
      for (const ref of [uuid, `@uuid:${uuid}`, asset.address ?? asset.path]) {
        const read = index.resolvePath(ref);
        if (!(await adapter.fileExists(read))) missing.push(`${ref} → ${read}`);
      }
    }
    expect(missing).toEqual([]);

    // …and the bytes come back, which is what the game was after.
    const prefab = JSON.parse(await adapter.readTextFile(index.resolvePath(PREFAB)));
    expect(prefab.name).toBe('Hero');
  }, 60_000);
});
