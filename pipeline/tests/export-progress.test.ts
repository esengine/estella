// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Export progress events — the pipeline emits a phase per major step so the
 *        Package Project dialog can show a live build log.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../src/export/exportGame';
import type { ExportProgress } from '../src/export/exportProgress';
import { writeFakeSdkDist } from './fixtures/fakeSdkDist';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTS = path.join(HERE, '..', '..', 'pipeline', 'src', 'runtime');

let root: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-progress-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('M', { n: 1 });\n`);
  writeFakeSdkDist(path.join(root, '_sdk'));
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'wasmbytes');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('export progress', () => {
  it.each(['web', 'desktop'] as const)('fails a %s export when the startup scene is missing', async platform => {
    const result = await exportGame({
      root, entryScene: 'scenes/missing.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: path.join(root, `out-missing-${platform}`), platform,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('scenes/missing.esscene: required scene is missing from the asset index'));
  }, 60_000);

  it('reports an untracked switchable scene only when it is selected for export', async () => {
    const untracked = 'scenes/untracked.esscene';
    const file = path.join(root, untracked);
    writeFileSync(file, JSON.stringify({ version: 4, name: 'Local sketch', entities: [] }));
    const opts = {
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), platform: 'web' as const,
    };
    try {
      const selected = await exportGame({ ...opts, outDir: path.join(root, 'out-untracked') });
      expect(selected.ok).toBe(false);
      expect(selected.errors).toContainEqual(expect.stringContaining(`${untracked}: required scene is missing from the asset index`));
      const excluded = await exportGame({ ...opts, outDir: path.join(root, 'out-untracked-excluded'), excludeScenes: [untracked] });
      expect(excluded.ok).toBe(true);
    } finally {
      rmSync(file, { force: true });
    }
  }, 60_000);

  it.each(['web', 'desktop'] as const)('fails a %s export with an included newer switchable scene', async platform => {
    const future = 'scenes/future.esscene';
    const file = path.join(root, future);
    writeFileSync(file, JSON.stringify({ version: 999, name: 'Future', entities: [] }));
    writeFileSync(`${file}.meta`, meta('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'scene'));
    try {
      const result = await exportGame({
        root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
        sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
        outDir: path.join(root, `out-format-${platform}`), platform,
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.stringMatching(/scenes\/future\.esscene: Scene format version 999 is newer/i));
    } finally {
      rmSync(file, { force: true });
      rmSync(`${file}.meta`, { force: true });
    }
  }, 60_000);

  it('emits a phase per major step (web)', async () => {
    const phases: string[] = [];
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: path.join(root, 'out'),
      platform: 'web',
      onProgress: (p: ExportProgress) => phases.push(p.phase),
    });

    expect(res.ok).toBe(true);
    for (const expected of ['Cooking assets', 'Bundling game host', 'Bundling project scripts', 'Copying SDK + runtime', 'Writing host page']) {
      expect(phases).toContain(expected);
    }
    // Cooking is first; writing the host page is among the last.
    expect(phases.indexOf('Cooking assets')).toBeLessThan(phases.indexOf('Writing host page'));
  }, 60_000);

  it('does not claim a step a native target never takes', async () => {
    // A progress line is a report of work. Desktop writes no host page — there is
    // no browser to boot the game — and a log that says it did is one a developer
    // reads while looking for what actually happened.
    const phases: string[] = [];
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: path.join(root, 'out-desktop'),
      platform: 'desktop',
      onProgress: (p: ExportProgress) => phases.push(p.phase),
    });

    expect(res.ok).toBe(true);
    expect(phases).toContain('Cooking assets');
    expect(phases).not.toContain('Writing host page');
  }, 60_000);
});
