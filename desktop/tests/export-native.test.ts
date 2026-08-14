// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Native export (Stage C). The native app carries the runtime in its
 *        binary — engine core, SDK bundle and game runtime all ship inside the
 *        host — so its export is CONTENT: cooked assets, both manifests, the
 *        scenes and game.config.json. Asserts exactly that, and that the web-only
 *        payload (host page, SDK/wasm trees, an ESM host bundle) stays out.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../../pipeline/src/export/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_HOST = path.join(HERE, '..', '..', 'pipeline', 'src', 'runtime', 'gameHost.ts');

let root: string;
let out: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-native-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  copyFileSync(path.resolve(HERE, '..', '..', 'examples', 'hello-world', 'assets', 'textures', 'logo.png'),
    path.join(root, 'assets', 'hero.png'));
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('SpawnMarker', { rate: 1 });\n`);
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');

  out = path.join(root, 'dist-android');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame (native app content)', () => {
  it('ships content only — cooked assets, manifests, scene, config', async () => {
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), outDir: out,
      platform: 'android', title: 'NativeGame',
    });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);

    // What the native runtime reads off the device.
    expect(existsSync(path.join(out, 'game.config.json'))).toBe(true);
    expect(existsSync(path.join(out, 'asset-manifest.json'))).toBe(true);
    // The flat manifest is a build-time intermediate — the addressable one is the
    // runtime contract, and it is the only one that ships.
    expect(existsSync(path.join(out, 'assets.manifest.json'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8')).entryScene)
      .toBe('scenes/main.esscene');

    // The runtime lives in the app binary — none of the web payload ships.
    expect(existsSync(path.join(out, 'index.html'))).toBe(false);
    expect(existsSync(path.join(out, 'game.js'))).toBe(false);
    expect(existsSync(path.join(out, 'sdk'))).toBe(false);
    expect(existsSync(path.join(out, 'wasm'))).toBe(false);
  }, 90_000);

  it("binds the project's scripts to the host's SDK instance, not a second copy", async () => {
    // QuickJS has no module loader: the scripts bundle is an IIFE, and its
    // `esengine` imports must resolve to the globalThis.ESEngine the host already
    // installed — a bundled-in second SDK would register components into a rival
    // registry the engine never sees.
    const scripts = path.join(out, 'scripts.js');
    expect(existsSync(scripts)).toBe(true);
    expect(existsSync(path.join(out, 'scripts.mjs'))).toBe(false);
    const js = readFileSync(scripts, 'utf8');
    expect(js).toContain('globalThis.ESEngine');
    expect(js).toContain('SpawnMarker');
    // An IIFE, not ESM — nothing for the host to import.
    expect(js).not.toMatch(/^\s*(import|export)\s/m);
  }, 90_000);
});
