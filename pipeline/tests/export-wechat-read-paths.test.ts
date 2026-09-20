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
 *        This is the exporter's half: every spelling of every asset the package
 *        carries resolves, through the SAME `ManifestModel` the shipped runtime
 *        resolves with, to a file that is there. The runtime's half — that the
 *        name reaching the host filesystem is the one the manifest gave — is
 *        `sdk/tests/minigame-read-path.test.ts`, which is where the rewrite
 *        lived. Neither half alone sees the bug; the pair does.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { ManifestModel, type AddressableManifest } from '../../sdk/src/asset/AddressableManifest';
import { miniGameSdkStub } from './fixtures/miniGameSdkStub';
import { wechatExportProfile } from '../src/export/miniGameExportProfile';

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
  writeFileSync(path.join(root, '_sdk', 'index.wechat.js'), miniGameSdkStub(wechatExportProfile, ['defineComponent']));
  mkdirSync(path.join(root, '_wxwasm'), { recursive: true });
  writeFileSync(path.join(root, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wxwasm', 'esengine.wasm'), 'wasmbytes');
  return { root, out: path.join(root, 'dist-wechat') };
}

describe('exportGame (wechat) — every asset resolves to a file the package carries', () => {
  it('resolves each manifest asset to a staged file', async () => {
    const { root, out } = scaffold();
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      hostsDir: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: out,
      platform: 'wechat',
    });
    expect(res.ok).toBe(true);

    const manifest = JSON.parse(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8')) as AddressableManifest;
    const model = ManifestModel.fromJson(manifest);

    // Both the prefab and the material ship — the scene names them — and the
    // packer is told to carry those suffixes, else the file never lands.
    const keys = Object.keys(manifest.groups.main.assets);
    expect(keys).toContain(MAT);
    expect(keys).toContain(PREFAB);
    const pcfg = JSON.parse(readFileSync(path.join(out, 'project.config.json'), 'utf8'));
    // Every suffix the package actually holds is declared, whatever it turned out
    // to be: an asset whose own suffix the packer refuses ships restaged as
    // `.bin`, and THAT is what has to be carried.
    const held = new Set(Object.values(manifest.groups.main.assets)
      .map((a) => path.extname(a.path).toLowerCase())
      .filter((e) => e !== '' && e !== '.js' && e !== '.json'));
    expect(held.size).toBeGreaterThan(0);
    for (const ext of held) {
      expect(pcfg.packOptions.include, `the packer is not told to carry ${ext}`)
        .toContainEqual({ type: 'suffix', value: ext });
    }

    // Every spelling the game can hold: the uuid a scene carries (the runtime
    // strips the `@uuid:` before the lookup) and the project-relative path code
    // writes by hand.
    const missing: string[] = [];
    for (const [uuid, asset] of Object.entries(manifest.groups.main.assets)) {
      for (const ref of [uuid, asset.address ?? asset.path]) {
        const read = model.resolvePath(ref);
        if (!existsSync(path.join(out, read))) missing.push(`${ref} → ${read}`);
      }
    }
    expect(missing).toEqual([]);

    // …and the bytes are the asset's, not some neighbour that happens to exist.
    const prefab = JSON.parse(readFileSync(path.join(out, model.resolvePath(PREFAB)), 'utf8'));
    expect(prefab.name).toBe('Hero');
  }, 60_000);
});
