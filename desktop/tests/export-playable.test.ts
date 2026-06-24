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
import { fileURLToPath } from 'node:url';
import { exportGame } from '../electron/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYABLE_HOST = path.join(HERE, '..', 'src', 'playableHost.ts');

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
  // Project script imports 'esengine' (aliased to the stub SDK below); the REAL
  // playableHost is bundled too — so this exercises actual esengine resolution +
  // host bundling (the old stub host hid the resolution bug).
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('SpawnMarker', {});\n`);
  // Stub SDK dist exporting what the real host + scripts import (bundles for real).
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'),
    `export function createWebApp(){return{GL:{registerContext(){}}};}\nexport function setEditorMode(){}\nexport function setPlayMode(){}\nexport function initPlayableRuntime(){return Promise.resolve();}\nexport function defineComponent(){}\n`);
  // Stub web wasm runtime (glue text + wasm) — playable inlines these, no separate build.
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), `export default function(){}/*WEB_GLUE*/\n`);
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'WASMBYTES');

  out = path.join(root, 'dist-playable');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame (playable)', () => {
  it('produces one self-contained index.html with everything inlined', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-playable',
      playableHostEntry: PLAYABLE_HOST,
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
    expect(html).toContain('WEB_GLUE');                              // web glue text inlined
    expect(html).toContain('__ENGINE_GLUE__');                       // glue + wasm inlined as globals
    expect(html).toContain('__ENGINE_WASM__');
    expect(html).toContain('createObjectURL');                       // real host bundled (blob loader)
    expect(html).toContain('SpawnMarker');                           // project script bundled
    expect(html).toContain(`@uuid:${TEX}`);                          // asset keyed by ref
    expect(html).toContain('data:image/png;base64,');               // asset inlined as data URL
    expect(html).toContain('__GAME_FIRST__');
    expect(html).toContain('"main"');                                // first scene name
    expect(html).toContain('__GAME_SCENES__');
    expect(html).toContain('<title>Playable Demo</title>');
  }, 60_000);
});
