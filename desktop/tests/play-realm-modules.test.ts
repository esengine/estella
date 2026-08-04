// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The play realm carries a project's own native modules.
 *
 * Without this a developer can only find out whether their module works by
 * packaging the game — the feedback delay the editor exists to remove. The
 * realm is staged from the same `.esengine/modules/` the export reads, so what
 * Play loads and what ships are the same files.
 *
 * The ordering here is load-bearing and was wrong once: `syncDir` DELETES its
 * destination before copying, so project modules have to be staged after it,
 * and unconditionally — a stamp-skipped sync must not leave the previous run's
 * modules as the only copy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPlayRealm } from '../electron/buildPlayRealm';

let root: string;
let stage: string;

/** The three inputs buildPlayRealm copies from. */
async function fixture(): Promise<{ playHostArtifact: string; sdkDistDir: string; wasmDir: string }> {
  const hostFile = path.join(stage, 'playHost.js');
  await writeFile(hostFile, '// play host bundle');
  const sdkDistDir = path.join(stage, 'sdk');
  await mkdir(sdkDistDir, { recursive: true });
  await writeFile(path.join(sdkDistDir, 'index.js'), '// sdk');
  const wasmDir = path.join(stage, 'wasm');
  await mkdir(wasmDir, { recursive: true });
  await writeFile(path.join(wasmDir, 'esengine.js'), '// engine glue');
  await writeFile(path.join(wasmDir, 'esengine.wasm'), 'enginebytes');
  return { playHostArtifact: hostFile, sdkDistDir, wasmDir };
}

async function writeModule(id: string, platformDir: string): Promise<void> {
  const dir = path.join(root, '.esengine', 'modules', id, platformDir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, '.esengine', 'modules', id, 'module.json'),
    JSON.stringify({ file: id, globalName: `${id}Module` }));
  await writeFile(path.join(dir, `${id}.js`), `var ${id}Module = () => Promise.resolve({});`);
  await writeFile(path.join(dir, `${id}.wasm`), 'modulebytes');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'es-play-'));
  stage = await mkdtemp(path.join(tmpdir(), 'es-play-src-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(stage, { recursive: true, force: true });
});

describe('buildPlayRealm — project modules', () => {
  it('stages them beside the engine runtime and declares them to the realm', async () => {
    await writeModule('rive', 'web');
    const res = await buildPlayRealm({ root, ...await fixture() });
    expect(res.ok).toBe(true);
    const staged = (await readdir(path.join(root, '.esengine', 'play', 'wasm'))).sort();
    expect(staged).toEqual(['esengine.js', 'esengine.wasm', 'rive.js', 'rive.wasm']);
    expect(res.sideModules).toEqual([{ id: 'rive', file: 'rive', globalName: 'riveModule' }]);
  });

  it('survives the wasm sync that deletes its own destination', async () => {
    await writeModule('rive', 'web');
    const inputs = await fixture();
    await buildPlayRealm({ root, ...inputs });
    // Second build with the engine runtime CHANGED, so syncDir re-copies (and
    // therefore wipes wasm/ first). The project module must still be there.
    await writeFile(path.join(inputs.wasmDir, 'esengine.wasm'), 'enginebytes-v2');
    const res = await buildPlayRealm({ root, ...inputs });
    expect(res.ok).toBe(true);
    expect(await readdir(path.join(root, '.esengine', 'play', 'wasm')))
      .toContain('rive.js');
  });

  it('re-stages an edited module even when the engine runtime did not change', async () => {
    await writeModule('rive', 'web');
    const inputs = await fixture();
    await buildPlayRealm({ root, ...inputs });
    await writeFile(path.join(root, '.esengine', 'modules', 'rive', 'web', 'rive.js'), '// rebuilt');
    await buildPlayRealm({ root, ...inputs });
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path.join(root, '.esengine', 'play', 'wasm', 'rive.js'), 'utf8'))
      .toBe('// rebuilt');
  });

  it('does not stop Play over a module with no web build, but says so', async () => {
    await writeModule('rive', 'wechat');   // mini-game build only
    const res = await buildPlayRealm({ root, ...await fixture() });
    expect(res.ok).toBe(true);
    expect(res.sideModules).toEqual([]);
    expect(res.warnings.join('\n')).toContain('"rive"');
  });

  it('says nothing at all for a project that declares no modules', async () => {
    const res = await buildPlayRealm({ root, ...await fixture() });
    expect(res.ok).toBe(true);
    expect(res.sideModules).toEqual([]);
    expect(res.warnings).toEqual([]);
  });
});
