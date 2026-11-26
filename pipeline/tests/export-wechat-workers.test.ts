// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A WeChat package carries the engine's job workers its content reaches: the worker file, game.json's `workers`, and the call
 *        that installs them. Content that reaches none carries none. (Whether the device runs them is a device's to say.)
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { miniGameSdkStub } from './fixtures/miniGameSdkStub';
import { wechatExportProfile } from '../src/export/miniGameExportProfile';
import { miniGameWorkerKinds } from '../src/export/miniGameWorkers';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

const roots: string[] = [];
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

/** A project of one scene with `components` on its one entity, exported for WeChat; answers the package directory. */
async function exportScene(components: Array<{ type: string; data: object }>) {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-export-wechat-workers-'));
  roots.push(root);
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components }] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'scene'));
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.wechat.js'), miniGameSdkStub(wechatExportProfile));
  mkdirSync(path.join(root, '_wxwasm'), { recursive: true });
  writeFileSync(path.join(root, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wxwasm', 'esengine.wasm'), 'wasmbytes');
  const outDir = path.join(root, 'out');
  const res = await exportGame({
    minifyScripts: false, root, entryScene: 'scenes/main.esscene', hostsDir: 'unused-for-wechat', packagesDir: OFFICIAL_PACKAGES,
    sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wxwasm'), outDir, platform: 'wechat',
  });
  return { res, dir: outDir };
}

afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

describe('WeChat job workers', () => {
  it('carries the water baking worker for a scene with water, and names it to the host', async () => {
    const { res, dir } = await exportScene([{ type: 'Transform', data: {} }, { type: 'WaterBody', data: {} }]);
    expect(res.errors).toEqual([]);
    const file = readFileSync(path.join(dir, 'workers', 'index.js'), 'utf8');
    expect(file).toContain('worker.onMessage');
    expect(file).toContain('"water-zone"');
    expect(file).not.toContain('"plan"');
    // Down-levelled to the host's floor: real-device WeChat refuses `??` and `?.` in any script of the package.
    expect(file).not.toMatch(/\?\?|\?\.[A-Za-z_$]/);
    // And it still runs as one: a `worker` global, no `self`; a kind it does not carry is answered `lost` (done on the main thread).
    let onMessage: ((res: unknown) => void) | null = null;
    const sent: unknown[] = [];
    new Function('worker', file)({ onMessage: (cb: (res: unknown) => void) => { onMessage = cb; }, postMessage: (m: unknown) => sent.push(m) });
    onMessage!({ __es: 'plan', c: 1, d: { id: 7 } });
    expect(sent).toEqual([{ __es: 'plan', c: 1, d: { id: 7, error: 'this package carries no plan worker', lost: true } }]);
    expect(JSON.parse(readFileSync(path.join(dir, 'game.json'), 'utf8')).workers).toBe('workers');
    const bundle = readFileSync(path.join(dir, 'game-bundle.js'), 'utf8');
    expect(bundle.slice(bundle.indexOf('async function prepareProject'), bundle.indexOf('async function boot'))).toMatch(/installMiniGameWorkers\([^;]*wx[^;]*\["water-zone"\]\)/);
  }, 120_000);

  it('carries none for content that reaches none', async () => {
    const { res, dir } = await exportScene([{ type: 'Transform', data: {} }]);
    expect(res.errors).toEqual([]);
    expect(existsSync(path.join(dir, 'workers'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(dir, 'game.json'), 'utf8')).workers).toBeUndefined();
    expect(readFileSync(path.join(dir, 'game-bundle.js'), 'utf8')).not.toContain('installMiniGameWorkers(');
  }, 120_000);
});

describe('miniGameWorkerKinds', () => {
  it('names the workers from what the content uses', () => {
    expect(miniGameWorkerKinds(['foliage'], [])).toEqual(['plan']);
    expect(miniGameWorkerKinds(['text'], ['assets/sky.esimage', 'assets/hit.essound', 'assets/theme.esmusic'])).toEqual(['image', 'sound']);
    expect(miniGameWorkerKinds(['water', 'worldgen'], [])).toEqual(['plan', 'water-zone']);
    expect(miniGameWorkerKinds(['sprite'], ['assets/a.png'])).toEqual([]);
  });
});
