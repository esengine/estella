// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Main-process plugin discovery + compilation, driven against the REAL
 *        sample plugin in examples/, so the sample is a fixture that can't silently
 *        rot: if the example stops compiling or its manifest stops validating, this
 *        fails.
 *
 * Also covers the two discovery behaviours that matter most — a broken plugin is
 * reported rather than dropped, and a project plugin shadows a user one of the same
 * id (with the shadowed one still listed, so the user can see why it isn't running).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPlugins, compilePlugin, PROJECT_PLUGIN_DIR } from '../electron/pluginHost';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = path.resolve(HERE, '../../examples/sprite-animation');
const SAMPLE_ID = 'estella.scene-report';
/** The plugins the editor ships with, as a dev run resolves them. */
const SHIPPED_PLUGINS = path.resolve(HERE, '../../plugins');

let scratch: string;
/** A second project, for the npm-installed plugins (its own package.json). */
let pkgRoot: string;
/** A throwaway userData dir, so the real one is never read or written. */
let userData: string;

const writePlugin = (root: string, folder: string, manifest: unknown, entry?: string): string => {
  const dir = path.join(root, PROJECT_PLUGIN_DIR, folder);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  if (entry !== undefined) writeFileSync(path.join(dir, 'src', 'editor.ts'), entry);
  return dir;
};

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'estella-plugins-'));
  pkgRoot = mkdtempSync(path.join(tmpdir(), 'estella-pkgplugins-'));
  userData = mkdtempSync(path.join(tmpdir(), 'estella-userdata-'));
});
afterAll(() => {
  for (const dir of [scratch, pkgRoot, userData]) rmSync(dir, { recursive: true, force: true });
});

describe('plugin discovery', () => {
  it('finds the sample plugin shipped with the sprite-animation example', async () => {
    const found = await discoverPlugins(SAMPLE_PROJECT, userData);
    const sample = found.find((p) => p.id === SAMPLE_ID);
    expect(sample, 'sample plugin missing from examples/sprite-animation').toBeDefined();
    expect(sample!.error).toBeUndefined();
    expect(sample!.scope).toBe('project');
    expect(sample!.manifest?.main?.editor).toBe('src/editor.ts');
  });

  it('reports a broken manifest instead of dropping the folder', async () => {
    writePlugin(scratch, 'broken-json', '{ not json');
    writePlugin(scratch, 'no-id', { name: 'x', version: '1.0.0', main: { editor: 'src/editor.ts' } });
    mkdirSync(path.join(scratch, PROJECT_PLUGIN_DIR, 'not-a-plugin'), { recursive: true });

    const found = await discoverPlugins(scratch, userData);
    const byFolder = new Map(found.map((p) => [path.basename(p.dir), p]));
    expect(byFolder.get('broken-json')?.error).toMatch(/not valid JSON/);
    expect(byFolder.get('no-id')?.error).toMatch(/`id`/);
    expect(byFolder.get('not-a-plugin')?.error).toMatch(/no plugin.json/);
    // Reported, every one of them — that's the point.
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores dot-prefixed folders (the generated typings sidecar)', async () => {
    mkdirSync(path.join(scratch, PROJECT_PLUGIN_DIR, '.types'), { recursive: true });
    const found = await discoverPlugins(scratch, userData);
    expect(found.some((p) => path.basename(p.dir) === '.types')).toBe(false);
  });

  it('lets a project plugin shadow a user plugin of the same id, and says so', async () => {
    const shared = { id: 'acme.dup', name: 'Dup', version: '1.0.0', main: { editor: 'src/editor.ts' } };
    writePlugin(scratch, 'dup', shared, 'export default { activate() {} }');
    const userDir = path.join(userData, 'plugins', 'dup');
    mkdirSync(userDir, { recursive: true });
    writeFileSync(path.join(userDir, 'plugin.json'), JSON.stringify(shared));

    const found = await discoverPlugins(scratch, userData);
    const dups = found.filter((p) => p.id === 'acme.dup');
    expect(dups).toHaveLength(2); // both listed
    expect(dups.find((p) => p.scope === 'project')!.shadowedBy).toBeUndefined();
    expect(dups.find((p) => p.scope === 'user')!.shadowedBy).toBe('project');
  });

  it('returns nothing (rather than throwing) with no project open', async () => {
    await expect(discoverPlugins(null, path.join(userData, 'absent'))).resolves.toEqual([]);
  });

  it('finds the editor’s own plugins, without a project', async () => {
    // They ship with the app, so they are there before anything is opened.
    const found = await discoverPlugins(null, userData, SHIPPED_PLUGINS);
    const mixer = found.find((p) => p.id === 'estella.audio-mixer');
    expect(mixer, 'the shipped mixer is missing from plugins/').toBeDefined();
    expect(mixer!.scope).toBe('builtin');
    expect(mixer!.error).toBeUndefined();
  });

  it('passes over a shipped package that has no editor half', async () => {
    // plugins/ holds packages, and a runtime-only one is not a broken plugin.
    const shipped = (await discoverPlugins(null, userData, SHIPPED_PLUGINS))
      .filter((p) => p.scope === 'builtin');
    expect(shipped.some((p) => p.error)).toBe(false);
    expect(shipped.some((p) => p.dir.endsWith('minigame-services'))).toBe(false);
  });

  it('lets a project plugin shadow a shipped one of the same id', async () => {
    // How a project pins its own build of a plugin the editor ships.
    writePlugin(scratch, 'mixer', {
      id: 'estella.audio-mixer', name: 'Mine', version: '9.0.0', main: { editor: 'src/editor.ts' },
    }, 'export default { activate() {} }');
    const found = (await discoverPlugins(scratch, userData, SHIPPED_PLUGINS))
      .filter((p) => p.id === 'estella.audio-mixer');
    expect(found.find((p) => p.scope === 'project')!.shadowedBy).toBeUndefined();
    expect(found.find((p) => p.scope === 'builtin')!.shadowedBy).toBe('project');
  });
});

describe('plugins installed from npm', () => {
  /** A package in the project's node_modules, optionally declared as a dependency. */
  const writePackage = (root: string, name: string, manifest: unknown, declared = true): string => {
    const dir = path.join(root, 'node_modules', ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    if (manifest !== undefined) {
      writeFileSync(path.join(dir, 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    }
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    if (declared) {
      const file = path.join(root, 'package.json');
      const pkg = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: Record<string, string> }) : {};
      pkg.dependencies = { ...pkg.dependencies, [name]: '^1.0.0' };
      writeFileSync(file, JSON.stringify(pkg));
    }
    return dir;
  };
  const manifest = (id: string) => ({ id, name: id, version: '1.0.0', main: { editor: 'editor/index.js' } });

  it('finds a plugin the project depends on', async () => {
    writePackage(pkgRoot, 'estella-plugin-tiled', manifest('estella.tiled'));
    const found = await discoverPlugins(pkgRoot, userData);
    const hit = found.find((p) => p.id === 'estella.tiled');
    expect(hit?.scope).toBe('package');
    expect(hit?.error).toBeUndefined();
    expect(hit?.manifest?.main?.editor).toBe('editor/index.js');
  });

  it('finds one under a scope, which a name convention could not', async () => {
    writePackage(pkgRoot, '@acme/estella-plugin-yarn', manifest('acme.yarn'));
    const found = await discoverPlugins(pkgRoot, userData);
    expect(found.find((p) => p.id === 'acme.yarn')?.scope).toBe('package');
  });

  it('passes over an ordinary dependency in silence', async () => {
    // Most dependencies are not plugins. Reporting each one as a broken plugin
    // would bury the list under everything the project happens to install.
    writePackage(pkgRoot, 'left-pad', undefined);
    const found = await discoverPlugins(pkgRoot, userData);
    expect(found.some((p) => p.dir.endsWith('left-pad'))).toBe(false);
  });

  it('will not run a plugin the project never asked for', async () => {
    // Installed as somebody else's transitive dependency. Editor code arriving
    // because a package you did depend on depends on it is not a decision the
    // project made.
    writePackage(pkgRoot, 'estella-plugin-sneaky', manifest('sneaky.tools'), false);
    const found = await discoverPlugins(pkgRoot, userData);
    expect(found.some((p) => p.id === 'sneaky.tools')).toBe(false);
  });

  it('reports a package whose manifest is broken', async () => {
    writePackage(pkgRoot, 'estella-plugin-broken', '{ not json');
    const found = await discoverPlugins(pkgRoot, userData);
    const hit = found.find((p) => p.dir.endsWith('estella-plugin-broken'));
    expect(hit?.error).toMatch(/not valid JSON/);
    // Named by its package, since the manifest could not name it.
    expect(hit?.id).toBe('estella-plugin-broken');
  });

  it('is shadowed by a plugin folder in the project, and shadows a user one', async () => {
    const shared = 'acme.both';
    writePackage(pkgRoot, 'estella-plugin-both', manifest(shared));
    writePlugin(pkgRoot, 'both', { ...manifest(shared), main: { editor: 'src/editor.ts' } }, 'export default { activate() {} }');
    const userDir = path.join(userData, 'plugins', 'both');
    mkdirSync(userDir, { recursive: true });
    writeFileSync(path.join(userDir, 'plugin.json'), JSON.stringify(manifest(shared)));

    const found = (await discoverPlugins(pkgRoot, userData)).filter((p) => p.id === shared);
    expect(found).toHaveLength(3); // all three listed
    expect(found.find((p) => p.scope === 'project')!.shadowedBy).toBeUndefined();
    expect(found.find((p) => p.scope === 'package')!.shadowedBy).toBe('project');
    expect(found.find((p) => p.scope === 'user')!.shadowedBy).toBe('project');
  });
});

describe('plugin compilation', () => {
  it('compiles the sample plugin to a CJS module with host imports left external', async () => {
    const dir = path.join(SAMPLE_PROJECT, PROJECT_PLUGIN_DIR, SAMPLE_ID);
    const built = await compilePlugin(dir, 'src/editor.ts');
    expect(built.errors).toEqual([]);
    expect(built.ok).toBe(true);
    // CJS, because the renderer evaluates it with an injected `require` — that's
    // how React and the SDK stay the HOST's instances.
    expect(built.code).toMatch(/module\.exports|exports\./);
    // The API import must survive as a require, not be bundled in.
    expect(built.code).toMatch(/require\("@estella\/editor-api"\)/);
  }, 30_000);

  it('reports a syntax error rather than throwing', async () => {
    const dir = writePlugin(scratch, 'bad-syntax', { id: 'acme.bad', name: 'Bad', version: '1.0.0', main: { editor: 'src/editor.ts' } }, 'export default {{{');
    const built = await compilePlugin(dir, 'src/editor.ts');
    expect(built.ok).toBe(false);
    expect(built.errors.join(' ')).toMatch(/Expected|Unexpected/);
  }, 30_000);

  it('reports a missing entry file', async () => {
    const dir = writePlugin(scratch, 'no-entry', { id: 'acme.noentry', name: 'NE', version: '1.0.0', main: { editor: 'src/editor.ts' } });
    const built = await compilePlugin(dir, 'src/nope.ts');
    expect(built.ok).toBe(false);
    expect(built.errors[0]).toMatch(/entry not found/);
  });
});
