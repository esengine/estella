// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The plugin scaffolder. The point of it is that what it writes LOADS — so the
// tests assert against the same validators the loader uses rather than against the
// template's text, which would only pin the template to itself.
//
// The version pin is the one that actually bit: `engines.editor` below 1.0 treats
// the MINOR as the breaking axis, so a template carrying a hard-coded range makes
// every plugin scaffolded from it born `incompatible` the moment the editor's minor
// moves. That is not hypothetical — the guide's sample said `^0.33` against a 0.34
// editor.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldPlugin, editorRangeFor, SCAFFOLD_CONTRIBUTIONS } from '../electron/pluginScaffold';
import { validateManifest, satisfiesEditorRange } from '@/plugins/manifest';

let root: string;

const EDITOR = '0.34.1';

const create = (opts: Partial<Parameters<typeof scaffoldPlugin>[1]> = {}) =>
  scaffoldPlugin(root, {
    id: 'acme.level-tools',
    name: 'Level Tools',
    editorVersion: EDITOR,
    ...opts,
  });

const manifestOf = (id = 'acme.level-tools'): unknown =>
  JSON.parse(readFileSync(path.join(root, id, 'plugin.json'), 'utf8'));

const entryOf = (id = 'acme.level-tools'): string =>
  readFileSync(path.join(root, id, 'src', 'editor.ts'), 'utf8');

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'es-plugscaffold-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scaffoldPlugin', () => {
  it('writes a plugin whose manifest the loader accepts', async () => {
    const r = await create();
    expect(r.ok).toBe(true);
    expect(r.files).toEqual(expect.arrayContaining(['plugin.json', 'tsconfig.json', 'src/editor.ts']));

    const parsed = validateManifest(manifestOf());
    if ('error' in parsed) throw new Error(`scaffold wrote an invalid manifest: ${parsed.error}`);
    expect(parsed.manifest.id).toBe('acme.level-tools');
    expect(parsed.manifest.main?.editor).toBe('src/editor.ts');
  });

  it('pins engines.editor to the RUNNING editor, so the plugin is not born incompatible', async () => {
    await create();
    const parsed = validateManifest(manifestOf());
    if ('error' in parsed) throw new Error(parsed.error);
    const range = parsed.manifest.engines?.editor;
    expect(range).toBe('^0.34');
    expect(satisfiesEditorRange(EDITOR, range!).ok).toBe(true);
    // The bug this guards: a range from an older line refuses the running editor.
    expect(satisfiesEditorRange(EDITOR, '^0.33').ok).toBe(false);
  });

  it('derives the range from any version, and degrades to * rather than guessing', () => {
    expect(editorRangeFor('1.2.3')).toBe('^1.2');
    expect(editorRangeFor('0.34.1-beta.2')).toBe('^0.34');
    expect(editorRangeFor('nonsense')).toBe('*');
  });

  it('refuses an id the loader would later reject, before writing anything', async () => {
    const r = await scaffoldPlugin(root, { id: 'Tools', name: 'Tools', editorVersion: EDITOR });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/dotted, lowercase/);
    expect(existsSync(path.join(root, 'Tools'))).toBe(false);
  });

  it('refuses a nameless plugin', async () => {
    const r = await create({ name: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name/);
  });

  it('never clobbers an existing folder', async () => {
    expect((await create()).ok).toBe(true);
    const before = entryOf();
    const second = await create({ name: 'Something Else' });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already exists/);
    expect(entryOf()).toBe(before);
  });

  it('writes only the samples asked for, with the types each one needs', async () => {
    await create({ contributions: ['overlay', 'tool'] });
    const src = entryOf();
    expect(src).toContain('ctx.overlays.register');
    expect(src).toContain('ctx.tools.register');
    expect(src).not.toContain('ctx.panels.register');
    // A sample that names a type must import it, or the file it wrote does not
    // compile in the author's editor — the first thing they would see.
    expect(src).toContain('type OverlayGraphics');
    expect(src).toContain('type PointerInput');
    expect(src).not.toContain('type InspectorSectionBuilder');
  });

  it('produces a valid, loadable plugin even with no samples at all', async () => {
    const r = await create({ contributions: [] });
    expect(r.ok).toBe(true);
    expect('error' in validateManifest(manifestOf())).toBe(false);
    const src = entryOf();
    expect(src).toContain('definePlugin');
    expect(src).toContain('activate(ctx: PluginContext)');
  });

  it('offers every sample kind, and each writes something', async () => {
    await create({ contributions: SCAFFOLD_CONTRIBUTIONS });
    const src = entryOf();
    for (const marker of ['ctx.commands.register', 'ctx.panels.register', 'ctx.inspector.register',
      'ctx.overlays.register', 'ctx.tools.register']) {
      expect(src).toContain(marker);
    }
  });

  it('writes the typings sidecar the generated tsconfig points at', async () => {
    await create({ apiTypes: '// editor api types\n' });
    const tsconfig = JSON.parse(readFileSync(path.join(root, 'acme.level-tools', 'tsconfig.json'), 'utf8')) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    const rel = tsconfig.compilerOptions.paths['@estella/editor-api'][0];
    // Resolve the tsconfig's own path claim rather than restating it — that is the
    // link that breaks silently if either half moves.
    const resolved = path.resolve(path.join(root, 'acme.level-tools'), rel);
    expect(existsSync(resolved)).toBe(true);
    expect(readFileSync(resolved, 'utf8')).toBe('// editor api types\n');
  });

  it('leaves no sidecar when the caller supplies no typings', async () => {
    await create();
    expect(existsSync(path.join(root, '.types'))).toBe(false);
  });
});
