// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Game export orchestration (REARCH_EDITOR_REALM Phase S). Asserts
 *        exportGame produces a self-contained web build: cooked assets + manifest,
 *        the esbuild'd game host (esengine inlined, not external), the copied wasm
 *        runtime, index.html, and the entry-scene config. (The host RENDERING is
 *        proven separately by play:verify — gameHost reuses initPlayRealmRuntime.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../electron/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_HOST = path.join(HERE, '..', 'src', 'gameHost.ts');

let root: string;
let out: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-'));
  // A texture asset + sidecar.
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  // A real PNG so the content-addressed + KTX2-compress export path has valid input.
  copyFileSync(path.resolve(HERE, '..', '..', 'examples', 'hello-world', 'assets', 'textures', 'logo.png'),
    path.join(root, 'assets', 'hero.png'));
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  // A scene that references the texture by @uuid: + its sidecar.
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  // A project startup entry (esengine external) → bundled to scripts.mjs.
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('SpawnMarker', { rate: 1 });\n`);
  // Stand-in SDK dist + wasm runtime dirs to copy.
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'wasmbytes');

  out = path.join(root, 'dist-game');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame', () => {
  it('produces an import-map web build (cook + host + sdk + scripts + wasm + html)', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out,
      title: 'My Game',
    });

    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    // Reachability pulled the scene + its referenced texture into the build.
    expect(res.included).toBe(2);

    const has = (p: string) => existsSync(path.join(out, p));
    expect(has('index.html')).toBe(true);
    expect(has('game.js')).toBe(true);
    expect(has('scripts.mjs')).toBe(true);
    expect(has('sdk/index.js')).toBe(true);
    expect(has('game.config.json')).toBe(true);
    expect(has('assets.manifest.json')).toBe(true);
    expect(has('scenes/main.esscene')).toBe(true);
    expect(has('assets/hero.png')).toBe(true);
    expect(has('wasm/esengine.js')).toBe(true);

    // The host + project bundle are esengine-EXTERNAL (small; resolved by the
    // import map) — NOT an inlined hundreds-of-KB SDK.
    const gameJs = readFileSync(path.join(out, 'game.js'), 'utf8');
    expect(gameJs.length).toBeLessThan(100_000);
    expect(readFileSync(path.join(out, 'scripts.mjs'), 'utf8')).toMatch(/from\s*["']esengine["']/);

    // index.html carries the import map + loads the host; config points at the scene.
    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(html).toContain('importmap');
    expect(html).toContain('./sdk/index.js');
    expect(html).toContain('./game.js');
    expect(JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8')).entryScene).toBe('scenes/main.esscene');
  }, 60_000);

  it('content-addresses + KTX2-compresses cooked assets when opted in', async () => {
    const out2 = path.join(root, 'dist-game-ca');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out2,
      title: 'CA Game',
      contentAddressed: true,
      compressTextures: true,
    });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);

    const manifest = JSON.parse(readFileSync(path.join(out2, 'assets.manifest.json'), 'utf8'));
    const tex = manifest.entries.find((e: { uuid: string }) => e.uuid === TEX);
    // The PNG was encoded to KTX2 and named by content hash; refs stay uuid-based.
    expect(tex.path).toMatch(/^assets\/[0-9a-f]{16}\.ktx2$/);
    expect(tex.compressedFormats).toEqual(['astc-4x4', 'etc2-rgba8', 's3tc-dxt5']);
    const bytes = readFileSync(path.join(out2, tex.path));
    const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(magic.every((b, i) => bytes[i] === b)).toBe(true);

    // The scene keeps its logical name and the whole build still assembled.
    expect(existsSync(path.join(out2, 'scenes/main.esscene'))).toBe(true);
    expect(existsSync(path.join(out2, 'game.js'))).toBe(true);
  }, 60_000);
});
