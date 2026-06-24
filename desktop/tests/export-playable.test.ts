// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Playable-ad export — structure. Asserts ONE self-contained index.html
 *        inlines the SINGLE_FILE glue, the host+scripts IIFE bundle, and the
 *        assets (base64 data URLs keyed by @uuid:) + scenes as globals; and that
 *        the temp cook dir is cleaned (single-file output). Runtime is validated
 *        by the user in a browser / ad preview (no playable simulator here).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../electron/exportGame';

let root: string;
let out: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-playable-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  // Host + project script BOTH import 'esengine' (aliased to the stub SDK below) —
  // exercises the real esengine resolution, so a missing alias fails the build.
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('SpawnMarker', {});\n`);
  writeFileSync(path.join(root, '_host.ts'), `import { createWebApp } from 'esengine';\nvoid createWebApp;\nglobalThis.__HOST__ = 'playable-host-boot';\n`);
  // Stub SDK dist (the bundle aliases `esengine` → <sdkDir>/index.js).
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'), `export function createWebApp(){return{};}\nexport function defineComponent(){}\n`);
  // Stub SINGLE_FILE glue (real one comes from `-t playable`).
  writeFileSync(path.join(root, '_glue.js'), `globalThis.ESEngineModule = function(){};/*SINGLE_FILE_GLUE*/\n`);

  out = path.join(root, 'dist-playable');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame (playable)', () => {
  it('produces one self-contained index.html with everything inlined', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-playable',
      playableHostEntry: path.join(root, '_host.ts'),
      glueFile: path.join(root, '_glue.js'),
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out,
      title: 'Playable Demo',
      platform: 'playable',
    });

    expect(res.ok).toBe(true);
    expect(res.platform).toBe('playable');

    // Single file: only index.html, temp cook dir removed, no staged assets dir.
    expect(existsSync(path.join(out, 'index.html'))).toBe(true);
    expect(existsSync(path.join(out, '.playable-cook'))).toBe(false);
    expect(existsSync(path.join(out, 'assets'))).toBe(false);

    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(html).toContain('SINGLE_FILE_GLUE');                       // glue inlined
    expect(html).toContain('playable-host-boot');                    // host bundled
    expect(html).toContain('SpawnMarker');                           // project script bundled
    expect(html).toContain(`@uuid:${TEX}`);                          // asset keyed by ref
    expect(html).toContain('data:image/png;base64,');               // asset inlined as data URL
    expect(html).toContain('__GAME_FIRST__');
    expect(html).toContain('"main"');                                // first scene name
    expect(html).toContain('__GAME_SCENES__');
    expect(html).toContain('<title>Playable Demo</title>');
  }, 60_000);
});
