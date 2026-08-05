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
import { runtimeConfigOf } from '@/project/runtimeConfig';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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


/** Every asset in an addressable manifest, paired with its uuid key. */
function manifestAssets(manifest: unknown): Array<[string, { type: string; path: string; address?: string; compressedFormats?: string[] }]> {
  const groups = (manifest as { groups: Record<string, { assets: Record<string, never> }> }).groups;
  return Object.values(groups).flatMap((g) => Object.entries(g.assets)) as never;
}

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
    // The flat manifest is a build-time intermediate — only the addressable one ships.
    expect(has('assets.manifest.json')).toBe(false);
    expect(has('asset-manifest.json')).toBe(true);
    expect(has('scenes/main.esscene')).toBe(true);
    // Content-addressing is on by default now: the texture ships as assets/<hash>.png.
    const m = JSON.parse(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8'));
    const tex = manifestAssets(m).find(([, a]) => a.type === 'texture')![1];
    expect(tex.path).toMatch(/^assets\/[0-9a-f]{16}\.png$/);
    expect(has(tex.path)).toBe(true);
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
    // Web pins orientation (default landscape ⇒ rotate-to-fit overlay + best-effort lock).
    expect(html).toContain('id="rotate-hint"');
    expect(html).toContain('Rotate your device to landscape');
    expect(html).toMatch(/screen\.orientation[\s\S]*lock\("landscape"\)/);
    expect(JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8')).entryScene).toBe('scenes/main.esscene');
  }, 60_000);

  it('lists every inline script in the page CSP, for either orientation', async () => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const cspOut = path.join(root, `dist-game-csp-${orientation}`);
      const res = await exportGame({
        root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST, scriptsEntry: 'src/main.ts',
        sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), outDir: cspOut, orientation,
      });
      expect(res.ok).toBe(true);

      const html = readFileSync(path.join(cspOut, 'index.html'), 'utf8');
      const csp = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/.exec(html)?.[1];
      expect(csp).toBeTruthy();
      // A hash the policy omits means the browser blocks that script — which is how
      // the orientation lock came to be dead in a shipped build.
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(inline.length).toBe(2); // the import map + the orientation lock
      for (const body of inline) {
        expect(csp).toContain(`sha256-${createHash('sha256').update(body).digest('base64')}`);
      }
    }
  }, 60_000);

  it('writes the project camera fit into game.config.json (only when opted in)', async () => {
    const fitOut = path.join(root, 'dist-game-fit');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), outDir: fitOut, title: 'Fit Game',
      runtime: runtimeConfigOf({
        designResolution: { width: 1080, height: 1920 },
        features: { rendering: { cameraScaleMode: 'expand' } },
      }),
    });
    expect(res.ok).toBe(true);
    const cfg = JSON.parse(readFileSync(path.join(fitOut, 'game.config.json'), 'utf8'));
    expect(cfg.screenFit).toEqual({ designWidth: 1080, designHeight: 1920, scaleMode: 2, matchWidthOrHeight: 0.5 });

    // Off (scaleMode -1) ⇒ no screenFit key, so an unconfigured game's config is unchanged.
    const offOut = path.join(root, 'dist-game-fitoff');
    await exportGame({
      root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), outDir: offOut,
      runtime: runtimeConfigOf({ designResolution: { width: 1920, height: 1080 } }),
    });
    expect(JSON.parse(readFileSync(path.join(offOut, 'game.config.json'), 'utf8')).screenFit).toBeUndefined();
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

    const manifest = JSON.parse(readFileSync(path.join(out2, 'asset-manifest.json'), 'utf8'));
    const tex = manifestAssets(manifest).find(([uuid]) => uuid.toLowerCase() === TEX)![1];
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

  it('ships every scene in the scenes dir, listed in game.config.json', async () => {
    const LV2SCN = '77777777-7777-7777-7777-777777777777';
    writeFileSync(
      path.join(root, 'scenes', 'level2.esscene'),
      JSON.stringify({ version: '1.0', name: 'Level2', entities: [] }),
    );
    writeFileSync(path.join(root, 'scenes', 'level2.esscene.meta'), meta(LV2SCN, 'scene'));
    const outMulti = path.join(root, 'dist-game-multi');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: outMulti,
      title: 'My Game',
    });
    expect(res.ok).toBe(true);
    // Both scenes staged (web serves .esscene as-is) and listed for the host's
    // SceneManager registration — entry eager, the rest lazy by path.
    expect(existsSync(path.join(outMulti, 'scenes/level2.esscene'))).toBe(true);
    const cfg = JSON.parse(readFileSync(path.join(outMulti, 'game.config.json'), 'utf8'));
    expect(cfg.scenes).toContainEqual({ name: 'main', path: 'scenes/main.esscene' });
    expect(cfg.scenes).toContainEqual({ name: 'level2', path: 'scenes/level2.esscene' });
    expect(cfg.scenes[0]).toEqual({ name: 'main', path: 'scenes/main.esscene' }); // entry first
  }, 60_000);

  it('excludeScenes drops a scene from the build; the entry is immune', async () => {
    const outEx = path.join(root, 'dist-game-excluded');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: outEx,
      title: 'My Game',
      // level2 excluded; excluding the entry must be ignored — it boots the game.
      excludeScenes: ['scenes/level2.esscene', 'scenes/main.esscene'],
    });
    expect(res.ok).toBe(true);
    const cfg = JSON.parse(readFileSync(path.join(outEx, 'game.config.json'), 'utf8'));
    expect(cfg.scenes).toEqual([{ name: 'main', path: 'scenes/main.esscene' }]);
    expect(existsSync(path.join(outEx, 'scenes/level2.esscene'))).toBe(false);
  }, 60_000);

  it('fails when the wasm runtime is missing — the build cannot boot without it', async () => {
    const out3 = path.join(root, 'dist-game-nowasm');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_no-such-wasm'),
      outDir: out3,
      title: 'My Game',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('wasm runtime dir not found'))).toBe(true);
  }, 60_000);

  // A third-party runtime (a vector-animation player, another solver) as an
  // ordinary side module: staged beside the engine's own and declared in the
  // config, which is the whole difference between `acquire('rive')` working and
  // a game having to fetch and instantiate a wasm by hand.
  it("ships a project's own native module and declares it for the runtime", async () => {
    const modDir = path.join(root, '.esengine', 'modules', 'rive');
    mkdirSync(path.join(modDir, 'web'), { recursive: true });
    writeFileSync(path.join(modDir, 'module.json'), JSON.stringify({ file: 'rive', globalName: 'RiveModule' }));
    writeFileSync(path.join(modDir, 'web', 'rive.js'), 'var RiveModule = () => Promise.resolve({});');
    writeFileSync(path.join(modDir, 'web', 'rive.wasm'), '\0asm   ');

    const outMod = path.join(root, 'dist-game-module');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: outMod,
      title: 'My Game',
    });
    expect(res.ok).toBe(true);

    // Beside the engine's own artifacts — one place, so every transport finds it.
    expect(existsSync(path.join(outMod, 'wasm', 'rive.js'))).toBe(true);
    expect(existsSync(path.join(outMod, 'wasm', 'rive.wasm'))).toBe(true);
    expect(existsSync(path.join(outMod, 'wasm', 'esengine.js'))).toBe(true);

    const cfg = JSON.parse(readFileSync(path.join(outMod, 'game.config.json'), 'utf8'));
    expect(cfg.sideModules).toEqual([{ id: 'rive', file: 'rive', globalName: 'RiveModule' }]);

    rmSync(path.join(root, '.esengine'), { recursive: true, force: true });
  }, 60_000);

  it('says so when a project module has no build for the target, rather than shipping a broken package', async () => {
    const modDir = path.join(root, '.esengine', 'modules', 'rive');
    mkdirSync(path.join(modDir, 'web'), { recursive: true });
    writeFileSync(path.join(modDir, 'web', 'rive.js'), 'export default () => Promise.resolve({});');

    const outMod = path.join(root, 'dist-game-module-android');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: outMod,
      platform: 'android',
      title: 'My Game',
    });
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toContain('app binary');
    // Not declared, because it was not staged: a declaration whose binary is
    // absent reports a missing file instead of an unsupported target.
    const cfg = JSON.parse(readFileSync(path.join(outMod, 'game.config.json'), 'utf8'));
    expect(cfg.sideModules).toBeUndefined();

    rmSync(path.join(root, '.esengine'), { recursive: true, force: true });
  }, 60_000);
});
