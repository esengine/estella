// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Desktop (Electron) export. Asserts the web payload lands under app/ and a
 *        runnable Electron shell (main.cjs registering the game:// scheme +
 *        electron-builder-wired package.json) is staged beside it.
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
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-desktop-'));
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
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'wasmbytes');

  out = path.join(root, 'dist-desktop');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame (desktop)', () => {
  it('stages an Electron shell around the web payload', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out,
      title: 'My Cool Game',
      platform: 'desktop',
    });

    expect(res.ok).toBe(true);
    expect(res.platform).toBe('desktop');

    // Web payload nested under app/.
    const app = path.join(out, 'app');
    for (const f of ['index.html', 'game.js', 'scripts.mjs', 'game.config.json', 'assets.manifest.json']) {
      expect(existsSync(path.join(app, f))).toBe(true);
    }
    expect(existsSync(path.join(app, 'wasm', 'esengine.js'))).toBe(true);
    expect(existsSync(path.join(app, 'sdk', 'index.js'))).toBe(true);
    expect(existsSync(path.join(app, 'assets', 'hero.png'))).toBe(true);

    // Electron shell beside it.
    const main = readFileSync(path.join(out, 'main.cjs'), 'utf8');
    expect(main).toContain('registerSchemesAsPrivileged');
    expect(main).toContain("SCHEME = 'game'");
    expect(main).toContain('://app/index.html'); // window loads the payload over the scheme

    const pkg = JSON.parse(readFileSync(path.join(out, 'package.json'), 'utf8'));
    expect(pkg.main).toBe('main.cjs');
    expect(pkg.scripts.start).toBe('electron .');
    expect(pkg.scripts.dist).toBe('electron-builder');
    expect(pkg.build.productName).toBe('My Cool Game');
    expect(pkg.name).toBe('my-cool-game'); // slugified
    expect(pkg.build.files).toContain('app/**/*');

    expect(existsSync(path.join(out, 'README.md'))).toBe(true);
  }, 60_000);

  it('leaves the web target unnested (no app/ wrapper)', async () => {
    const webOut = path.join(root, 'dist-web');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: webOut,
      platform: 'web',
    });
    expect(res.ok).toBe(true);
    expect(res.platform).toBe('web');
    expect(existsSync(path.join(webOut, 'index.html'))).toBe(true); // top-level, not under app/
    expect(existsSync(path.join(webOut, 'app'))).toBe(false);
    expect(existsSync(path.join(webOut, 'main.cjs'))).toBe(false);
  }, 60_000);
});
