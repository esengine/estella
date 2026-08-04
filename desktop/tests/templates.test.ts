// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseManifest, resolveLayout, resolveScripts, isTransientProjectPath, PROJECT_MANIFEST_FILE } from '@/project/format';
import { scaffoldProjectFiles, npmPackageName } from '../electron/projectScaffold';

// The bundled starter templates (shipped to resources/templates by
// electron-builder) — every one must stay a complete, openable project:
// this is what guarantees "New project" always works in a packaged editor.
const TEMPLATES_ROOT = path.resolve(__dirname, '../templates');

describe('bundled starter templates', () => {
  const starters = readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it('ships at least the blank starter', () => {
    expect(starters).toContain('blank');
  });

  it.each(starters)('%s is a complete project', (name) => {
    const dir = path.join(TEMPLATES_ROOT, name);
    const manifest = parseManifest(
      JSON.parse(readFileSync(path.join(dir, PROJECT_MANIFEST_FILE), 'utf8')),
    );

    // The default scene must exist and carry an active camera — a template
    // that opens onto a black, cameraless viewport is not a starting point.
    expect(manifest.defaultScene).toBeTruthy();
    const scenePath = path.join(dir, manifest.defaultScene!);
    expect(existsSync(scenePath)).toBe(true);
    const scene = JSON.parse(readFileSync(scenePath, 'utf8')) as {
      entities: Array<{ components: Array<{ type: string; data?: Record<string, unknown> }> }>;
    };
    const cameras = scene.entities.flatMap((e) => e.components).filter((c) => c.type === 'Camera');
    expect(cameras.some((c) => c.data?.isActive === true)).toBe(true);

    // Script entry points (schema extraction + play-realm bundle entry).
    const scripts = resolveScripts(manifest);
    expect(existsSync(path.join(dir, scripts.register))).toBe(true);
    expect(existsSync(path.join(dir, scripts.main))).toBe(true);

    // Layout dirs referenced by the manifest resolve inside the template.
    const layout = resolveLayout(manifest);
    expect(manifest.defaultScene!.startsWith(layout.scenes)).toBe(true);
  });
});

describe('isTransientProjectPath (template-copy filter)', () => {
  it('excludes per-machine and derived trees at any depth', () => {
    expect(isTransientProjectPath('.esengine')).toBe(true);
    expect(isTransientProjectPath('.esengine/sdk/index.d.ts')).toBe(true);
    expect(isTransientProjectPath(String.raw`.esengine\workspace.json`)).toBe(true);
    expect(isTransientProjectPath('node_modules/esengine/package.json')).toBe(true);
    expect(isTransientProjectPath('dist/js/main.js')).toBe(true);
    expect(isTransientProjectPath('.DS_Store')).toBe(true);
    expect(isTransientProjectPath('assets/Thumbs.db')).toBe(true);
  });

  it('keeps project content, including the copy root itself', () => {
    expect(isTransientProjectPath('')).toBe(false);
    expect(isTransientProjectPath('project.esproject')).toBe(false);
    expect(isTransientProjectPath('assets/scenes/main.esscene')).toBe(false);
    expect(isTransientProjectPath(String.raw`assets\textures\logo.png`)).toBe(false);
    expect(isTransientProjectPath('src/main.ts')).toBe(false);
    expect(isTransientProjectPath('thumbnail.png')).toBe(false);
    expect(isTransientProjectPath('.gitignore')).toBe(false);
  });
});

// A project's scripts are bundled with esbuild, which resolves dependencies out
// of the project's own node_modules — so `npm install <a-library>` works and the
// library ships with the game. Without a package.json that starts with an
// `npm init` nobody would guess is a prerequisite.
describe('new-project scaffold', () => {
  let dest: string;
  beforeEach(async () => { dest = await mkdtemp(path.join(tmpdir(), 'es-scaffold-')); });
  afterEach(async () => { await rm(dest, { recursive: true, force: true }); });

  it('writes a package.json npm will accept', async () => {
    await scaffoldProjectFiles(dest, 'My Game');
    const pkg = JSON.parse(readFileSync(path.join(dest, 'package.json'), 'utf8'));
    expect(pkg).toEqual({ name: 'my-game', version: '0.0.0', private: true, type: 'module' });
  });

  it('makes an npm-legal name out of one npm would refuse', () => {
    expect(npmPackageName('My Game')).toBe('my-game');
    expect(npmPackageName('拾星 Starfall')).toBe('starfall');       // non-ASCII collapses
    expect(npmPackageName('_leading')).toBe('leading');             // npm bans a leading _
    expect(npmPackageName('.hidden.')).toBe('hidden');
    expect(npmPackageName('已经全是中文')).toBe('estella-game');     // nothing legal left
    expect(npmPackageName('a'.repeat(300)).length).toBe(214);       // npm's cap
  });

  it('gitignores what the editor and the exporters actually write', async () => {
    await scaffoldProjectFiles(dest, 'x');
    const ignored = readFileSync(path.join(dest, '.gitignore'), 'utf8');
    expect(ignored).toContain('node_modules/');
    // The template's own copy listed `dist/` only, while every export writes
    // dist-<platform>/ — which is how a packaged game ended up in git.
    expect(ignored).toContain('dist-*/');
    expect(ignored).toContain('.esengine/');
  });

  it('leaves a template\'s own files alone, and is a no-op run twice', async () => {
    writeFileSync(path.join(dest, 'package.json'), '{"name":"chosen-by-the-template"}');
    await scaffoldProjectFiles(dest, 'My Game');
    await scaffoldProjectFiles(dest, 'My Game');
    expect(JSON.parse(readFileSync(path.join(dest, 'package.json'), 'utf8')).name)
      .toBe('chosen-by-the-template');
  });
});
