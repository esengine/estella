// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * What a project's scripts name ships, though no scene references it: a whole
 * path or an @uuid ref in a literal, and the folder a template literal builds
 * paths under. Culled, such an asset works in the editor and 404s on a device.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cookAssets } from '../src/assets/cookAssets';
import { matchScriptAssetRefs, scanScriptAssetRefs } from '../src/assets/scriptAssetRefs';

let root: string;
const SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COIN = '11111111-1111-4111-8111-111111111111';
const BY_REF = '22222222-2222-4222-8222-222222222222';
const SFX_A = '33333333-3333-4333-8333-333333333333';
const SFX_B = '44444444-4444-4444-8444-444444444444';
const UNUSED = '55555555-5555-4555-8555-555555555555';

function writeAsset(rel: string, type: string, uuid: string, body = 'x'): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-script-refs-'));
  writeFileSync(path.join(root, 'project.esproject'), JSON.stringify({ name: 'p', version: '1.0', scripts: { main: 'src/main.ts' } }));
  writeAsset('assets/scenes/main.esscene', 'scene', SCENE, JSON.stringify({ version: '1.0', name: 'm', entities: [] }));
  writeAsset('assets/ui/coin.png', 'texture', COIN);
  writeAsset('assets/ui/other.png', 'texture', BY_REF);
  writeAsset('assets/sfx/jump.wav', 'audio', SFX_A);
  writeAsset('assets/sfx/land.wav', 'audio', SFX_B);
  writeAsset('assets/ui/unused.png', 'texture', UNUSED);
  mkdirSync(path.join(root, 'src', 'game'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import './game/hud';\nexport const coin = './assets/ui/coin.png';\n`);
  writeFileSync(path.join(root, 'src', 'game', 'hud.ts'),
    `const ref = "@uuid:${BY_REF}";\nexport const sfx = (name: string) => \`assets/sfx/\${name}.wav\`;\n`);
});

afterAll(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

describe('assets the scripts name', () => {
  it('matches whole paths, @uuid refs and template folders', async () => {
    const refs = await scanScriptAssetRefs(root, ['src']);
    const matched = matchScriptAssetRefs(refs, [
      { uuid: COIN, path: 'assets/ui/coin.png' }, { uuid: BY_REF, path: 'assets/ui/other.png' },
      { uuid: SFX_A, path: 'assets/sfx/jump.wav' }, { uuid: UNUSED, path: 'assets/ui/unused.png' },
    ]);
    expect(Object.fromEntries(matched.map((m) => [m.uuid, m.via]))).toEqual({
      [COIN]: 'assets/ui/coin.png', [BY_REF]: `@uuid:${BY_REF}`, [SFX_A]: 'assets/sfx/',
    });
  });

  it('ships them from the project startup folder, says so for a folder, and still culls the rest', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    expect(res.ok).toBe(true);
    expect(res.included.sort()).toEqual([SCENE, COIN, BY_REF, SFX_A, SFX_B].sort());
    expect(res.inclusion['assets/ui/coin.png']).toEqual({ reason: 'script', via: 'assets/ui/coin.png' });
    expect(res.unused).toContain(UNUSED);
    expect(res.warnings.some((w) => w.includes('assets/sfx/') && w.includes('2 asset'))).toBe(true);
  });
});
