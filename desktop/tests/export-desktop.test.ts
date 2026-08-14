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
import { exportGame } from '../../pipeline/src/export/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_HOST = path.join(HERE, '..', '..', 'pipeline', 'src', 'runtime', 'gameHost.ts');

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

/** A template with the files the assembler reads. What is under test is the EXPORT
 *  reaching the assembler; the assembler itself is pinned in desktop-app.test.ts. */
function fakeTemplate(os: 'macos' | 'windows'): string {
  const dir = path.join(root, `_template-${os}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, os === 'windows' ? 'estella_desktop.exe' : 'estella_desktop'), 'runtime');
  writeFileSync(path.join(dir, 'esengine.native.qjsbc'), 'bytecode');
  writeFileSync(path.join(dir, 'Info.plist.in'),
    '<plist><dict><key>N</key><string>@APP_NAME@</string></dict></plist>');
  return dir;
}

const desktopExport = (outDir: string) => ({
  root,
  entryScene: 'scenes/main.esscene',
  gameHostEntry: GAME_HOST,
  scriptsEntry: 'src/main.ts',
  sdkDistDir: path.join(root, '_sdk'),
  wasmDir: path.join(root, '_wasm'),
  outDir,
  title: 'Packed Game',
  platform: 'desktop' as const,
});

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
    if (!res.appBundles) {
      expect(res.warnings.join(' ')).toMatch(/runtime template/i);
    }
  }, 60_000);

  it('assembles one app per installed template, on whatever OS is building', async () => {
    const packed = path.join(root, 'dist-desktop-packed');
    const res = await exportGame({
      ...desktopExport(packed),
      desktopTemplates: [
        { os: 'windows', dir: fakeTemplate('windows') },
        { os: 'macos', dir: fakeTemplate('macos') },
      ],
    });

    expect(res.ok).toBe(true);
    // Both, regardless of process.platform: the assembler is pure Node, so the
    // machine doing the building is not an input (only signing a .app is).
    expect(res.appBundles).toEqual([
      { os: 'windows', dir: path.join(packed, 'Packed Game') },
      { os: 'macos', dir: path.join(packed, 'Packed Game.app') },
    ]);

    // The runtime's bytecode joins the game's files in ONE namespace, which is
    // what the host reads — the whole reason the bundles are laid out this way.
    for (const content of ['Packed Game/Content', 'Packed Game.app/Contents/Resources/Content']) {
      expect(existsSync(path.join(packed, content, 'game.config.json'))).toBe(true);
      expect(existsSync(path.join(packed, content, 'esengine.native.qjsbc'))).toBe(true);
    }
    if (process.platform !== 'darwin') {
      expect(res.warnings.join(' ')).toMatch(/UNSIGNED/);
    }
  }, 60_000);

  it('writes a depot for each app it actually assembled, not for one fixed OS', async () => {
    const packed = path.join(root, 'dist-desktop-steam');
    const res = await exportGame({
      ...desktopExport(packed),
      desktopTemplates: [{ os: 'windows', dir: fakeTemplate('windows') }],
      desktopChannel: 'steam',
      steam: { appId: 480 },
    });

    expect(res.ok).toBe(true);
    expect(res.steamChecklist).toBe(path.join(packed, 'STEAM.md'));

    // The Windows depot, and NOT a macOS one: a depot naming `<Name>.app/*` in a
    // build that assembled `<Name>/` maps nothing, uploads an empty depot and
    // reports success.
    const scripts = readdirSync(path.join(packed, 'steam')).sort();
    expect(scripts).toContain('depot_481_windows.vdf');
    expect(scripts.some((f) => f.includes('macos'))).toBe(false);

    const depot = readFileSync(path.join(packed, 'steam', 'depot_481_windows.vdf'), 'utf8');
    expect(depot).toContain('"Packed Game/*"');
    expect(depot).not.toContain('.app');

    // And the checklist says what a player's Steam client will launch, plus where
    // Auto-Cloud has to look — both per-OS, both wrong if the OS is assumed.
    const checklist = readFileSync(res.steamChecklist!, 'utf8');
    expect(checklist).toContain('Packed Game.exe');
    expect(checklist).toContain('WinAppDataRoaming');
    expect(checklist).not.toContain('MacHome');
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
