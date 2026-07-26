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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPlugins, compilePlugin, PROJECT_PLUGIN_DIR } from '../electron/pluginHost';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = path.resolve(HERE, '../../examples/sprite-animation');
const SAMPLE_ID = 'estella.scene-report';

let scratch: string;
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
  userData = mkdtempSync(path.join(tmpdir(), 'estella-userdata-'));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
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
