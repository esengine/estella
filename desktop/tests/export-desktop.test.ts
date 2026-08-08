// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Desktop export. It is a NATIVE target now: the payload is app content —
 *        no HTML page, no SDK/wasm tree — and the app is assembled from a runtime
 *        template, exactly as the APK and the Xcode project are.
 *
 * Pinned here: no npm project, nothing for the user to install before running
 * what the editor produced.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
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
  it('exports app CONTENT, not a web payload in a shell', async () => {
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
      appId: 'com.studio.cool',
      desktopProductName: 'Cool Override',
    });

    expect(res.ok).toBe(true);
    expect(res.platform).toBe('desktop');

    // Content only, at the top level — no app/ nesting, because there is no shell
    // to nest under any more.
    const present = readdirSync(out).sort();
    for (const f of ['game.config.json', 'app.config.json', 'asset-manifest.json', 'scripts.js']) {
      expect(present, `missing ${f}`).toContain(f);
    }
    // The web payload's pieces are gone: the engine, the SDK and the runtime are
    // in the app binary, so shipping them again would be shipping two engines.
    for (const f of ['index.html', 'game.js', 'scripts.mjs', 'app', 'sdk', 'wasm']) {
      expect(existsSync(path.join(out, f))).toBe(false);
    }

    // The identity a packager reads, by the same rule every native target uses.
    const app = JSON.parse(readFileSync(path.join(out, 'app.config.json'), 'utf8'));
    expect(app.id).toBe('com.studio.cool');
    // productName was electron-builder's; it means what CFBundleName does, so it
    // still names the app.
    expect(app.name).toBe('Cool Override');

    // No template installed in this test's environment ⇒ content, and a warning
    // that says so rather than a silent half-export.
    if (!res.appBundle) {
      expect(res.warnings.join(' ')).toMatch(/runtime template/i);
    }
  }, 60_000);

  it('assembles the app when a runtime template is there', async () => {
    // A fake template, because what is under test is the EXPORT reaching the
    // assembler — the assembler itself is pinned in desktop-app.test.ts.
    const template = path.join(root, '_template');
    mkdirSync(template, { recursive: true });
    writeFileSync(path.join(template, 'estella_desktop'), 'runtime');
    writeFileSync(path.join(template, 'esengine.native.qjsbc'), 'bytecode');
    writeFileSync(path.join(template, 'Info.plist.in'),
        '<plist><dict><key>N</key><string>@APP_NAME@</string></dict></plist>');

    const packed = path.join(root, 'dist-desktop-packed');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: GAME_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: packed,
      title: 'Packed Game',
      platform: 'desktop',
      desktopTemplate: template,
    });

    expect(res.ok).toBe(true);
    if (process.platform !== 'darwin') {
      // Honest rather than silent: assembly is written for macOS only so far.
      expect(res.appBundle).toBeUndefined();
      expect(res.warnings.join(' ')).toMatch(/not written yet/);
      return;
    }
    expect(res.appBundle).toBe(path.join(packed, 'Packed Game.app'));
    // The runtime's bytecode joins the game's files in ONE namespace, which is
    // what the host reads — the whole reason the bundle is laid out this way.
    const content = path.join(res.appBundle!, 'Contents/Resources/Content');
    expect(existsSync(path.join(content, 'game.config.json'))).toBe(true);
    expect(existsSync(path.join(content, 'esengine.native.qjsbc'))).toBe(true);
  }, 60_000);

  it('no longer writes anything electron-builder would read', async () => {
    for (const f of ['main.cjs', 'package.json', 'README.md']) {
      expect(existsSync(path.join(out, f))).toBe(false);
    }
  });

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
