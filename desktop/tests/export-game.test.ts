/**
 * @file  Game export orchestration (REARCH_EDITOR_REALM Phase S). Asserts
 *        exportGame produces a self-contained web build: cooked assets + manifest,
 *        the esbuild'd game host (esengine inlined, not external), the copied wasm
 *        runtime, index.html, and the entry-scene config. (The host RENDERING is
 *        proven separately by play:verify — gameHost reuses initPlayRealmRuntime.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  // A scene that references the texture by @uuid: + its sidecar.
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  // A stand-in wasm runtime dir to copy.
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'wasmbytes');

  out = path.join(root, 'dist-game');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame', () => {
  it('produces a self-contained web build (cook + host + wasm + html)', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
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
    expect(has('game.config.json')).toBe(true);
    expect(has('assets.manifest.json')).toBe(true);
    expect(has('scenes/main.esscene')).toBe(true);
    expect(has('assets/hero.png')).toBe(true);
    expect(has('wasm/esengine.js')).toBe(true);
    expect(has('wasm/esengine.wasm')).toBe(true);

    // The host is real + esengine-INLINED (self-contained): an external build is
    // ~1-2 KB with a bare `import "esengine"`; the inlined SDK is hundreds of KB.
    const gameJs = readFileSync(path.join(out, 'game.js'), 'utf8');
    expect(gameJs.length).toBeGreaterThan(100_000);
    expect(gameJs).not.toMatch(/^\s*import\s*[^;]*from\s*["']esengine["']/m);

    // index.html loads the host; config points at the entry scene.
    expect(readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('./game.js');
    expect(JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8')).entryScene).toBe('scenes/main.esscene');
  }, 60_000);
});
