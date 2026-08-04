// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Optional native modules a project supplies.
 *
 * The engine's own side modules (physics, basis, the spine runtimes) get real
 * treatment on every target: acquired through one host, staged into the package,
 * required by name on a mini-game. A third-party runtime had none of it, and the
 * platform where doing it by hand is impossible — a mini-game, with no `fetch`
 * and a binary that must be IN the package — is the platform this engine targets
 * first.
 *
 * The invariant that matters most here is the boring one: a module is DECLARED
 * only if it was STAGED. A declaration whose binary is not in the package turns
 * "this target doesn't support it" into "the file 404'd", which is a much harder
 * thing to understand from a device.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadProjectModules, sideModuleDeclarations, stageProjectModules, PROJECT_MODULES_DIR,
} from '../electron/projectModules';

let root: string;

/** A module directory as a project would lay one out. */
async function writeModule(id: string, opts: {
  manifest?: Record<string, unknown> | null;
  builds?: Record<string, string[]>;
} = {}): Promise<void> {
  const dir = path.join(root, PROJECT_MODULES_DIR, id);
  await mkdir(dir, { recursive: true });
  if (opts.manifest !== null) {
    await writeFile(path.join(dir, 'module.json'), JSON.stringify(opts.manifest ?? { file: id }));
  }
  for (const [platform, files] of Object.entries(opts.builds ?? {})) {
    await mkdir(path.join(dir, platform), { recursive: true });
    for (const f of files) await writeFile(path.join(dir, platform, f), `/* ${f} */`);
  }
}

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'es-modules-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('discovery', () => {
  it('finds nothing in a project that declares nothing', async () => {
    expect(await loadProjectModules(root, 'web')).toEqual([]);
  });

  it('takes the directory name as the id, and the manifest for the rest', async () => {
    await writeModule('rive', {
      manifest: { file: 'rive_runtime', globalName: 'RiveModule' },
      builds: { web: ['rive_runtime.js', 'rive_runtime.wasm'] },
    });
    const [m] = await loadProjectModules(root, 'web');
    expect(m.id).toBe('rive');
    expect(m.file).toBe('rive_runtime');
    expect(m.globalName).toBe('RiveModule');
    expect(m.buildDir).toContain(path.join('rive', 'web'));
  });

  it('needs no manifest when the files follow the convention', async () => {
    await writeModule('lottie', { manifest: null, builds: { web: ['lottie.js', 'lottie.wasm'] } });
    const [m] = await loadProjectModules(root, 'web');
    expect(m).toMatchObject({ id: 'lottie', file: 'lottie' });
    expect(m.buildDir).not.toBeNull();
  });

  it('serves desktop and playable from the web build — same glue, same engine', async () => {
    await writeModule('rive', { builds: { web: ['rive.js', 'rive.wasm'] } });
    for (const platform of ['web', 'desktop', 'playable'] as const) {
      expect((await loadProjectModules(root, platform))[0].buildDir).not.toBeNull();
    }
  });

  it('will not serve a mini-game from the web build', async () => {
    // WeChat needs its own emscripten build (WXWebAssembly glue, a different
    // es-target) — which is why the engine builds its own modules twice too.
    // Substituting the web one produces a package that fails on a device.
    await writeModule('rive', { builds: { web: ['rive.js', 'rive.wasm'] } });
    expect((await loadProjectModules(root, 'wechat'))[0].buildDir).toBeNull();
  });

  it('lets a project vendor use its own directory, else the wechat build', async () => {
    await writeModule('rive', { builds: { wechat: ['rive.js'], 'acme-play': ['rive.js'] } });
    expect((await loadProjectModules(root, 'acme-play'))[0].buildDir).toContain('acme-play');
    await rm(path.join(root, PROJECT_MODULES_DIR, 'rive', 'acme-play'), { recursive: true });
    expect((await loadProjectModules(root, 'acme-play'))[0].buildDir).toContain('wechat');
  });
});

describe('declarations', () => {
  it('declares only what was staged', async () => {
    await writeModule('has-build', { builds: { web: ['has-build.js'] } });
    await writeModule('no-build', {});
    const modules = await loadProjectModules(root, 'web');
    expect(sideModuleDeclarations(modules, 'web').map((d) => d.id)).toEqual(['has-build']);
  });

  it('declares nothing for native, which cannot load one', async () => {
    await writeModule('rive', { builds: { web: ['rive.js'] } });
    const modules = await loadProjectModules(root, 'android');
    expect(sideModuleDeclarations(modules, 'android')).toEqual([]);
  });

  it('carries globalName only when there is one', async () => {
    await writeModule('a', { manifest: { file: 'a', globalName: 'AModule' }, builds: { web: ['a.js'] } });
    await writeModule('b', { builds: { web: ['b.js'] } });
    const decls = sideModuleDeclarations(await loadProjectModules(root, 'web'), 'web');
    expect(decls.find((d) => d.id === 'a')).toEqual({ id: 'a', file: 'a', globalName: 'AModule' });
    expect(decls.find((d) => d.id === 'b')).toEqual({ id: 'b', file: 'b' });
  });
});

describe('staging', () => {
  let out: string;
  beforeEach(async () => { out = await mkdtemp(path.join(tmpdir(), 'es-wasm-')); });
  afterEach(async () => { await rm(out, { recursive: true, force: true }); });

  it('puts glue and binary where every transport already looks', async () => {
    await writeModule('rive', { builds: { web: ['rive.js', 'rive.wasm'] } });
    const warnings = await stageProjectModules(await loadProjectModules(root, 'web'), out, 'web');
    expect(warnings).toEqual([]);
    expect((await readdir(out)).sort()).toEqual(['rive.js', 'rive.wasm']);
  });

  it('tolerates a build whose binary is embedded in the glue', async () => {
    await writeModule('rive', { builds: { web: ['rive.js'] } });
    const warnings = await stageProjectModules(await loadProjectModules(root, 'web'), out, 'web');
    expect(warnings).toEqual([]);
    expect(await readdir(out)).toEqual(['rive.js']);
  });

  it('names the module and where it looked when there is no build for the target', async () => {
    await writeModule('rive', { builds: { web: ['rive.js'] } });
    const warnings = await stageProjectModules(await loadProjectModules(root, 'wechat'), out, 'wechat');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"rive"');
    expect(warnings[0]).toContain('wechat/rive.js');
    expect(existsSync(path.join(out, 'rive.js'))).toBe(false);
  });

  it('stages nothing on native, and says why', async () => {
    await writeModule('rive', { builds: { web: ['rive.js'] } });
    const warnings = await stageProjectModules(await loadProjectModules(root, 'android'), out, 'android');
    expect(warnings.join('\n')).toContain('app binary');
    expect(await readdir(out)).toEqual([]);
  });

  it('rewrites the glue when the vendor demands it', async () => {
    // Mini-game hosts reject syntax emscripten emits by default; the export
    // already down-levels the engine's glue, and a project module's glue is the
    // same kind of file.
    await writeModule('rive', { builds: { wechat: ['rive.js', 'rive.wasm'] } });
    await stageProjectModules(await loadProjectModules(root, 'wechat'), out, 'wechat',
      async (code) => `${code}// down-levelled`);
    expect(await readFile(path.join(out, 'rive.js'), 'utf8')).toContain('// down-levelled');
    // …and leaves the binary alone.
    expect(await readFile(path.join(out, 'rive.wasm'), 'utf8')).not.toContain('down-levelled');
  });
});
