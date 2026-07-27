// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// `.esplugin` packaging. Export is the easy direction; the tests that matter are on
// IMPORT, because a package is a file someone was handed.
//
// Three rules, in the order they run:
//   1. Inspect writes nothing and inflates nothing — so a hostile archive is refused
//      before it can cost anything.
//   2. Install refuses to overwrite, and cleans up after itself if it fails partway.
//   3. Install never approves. That decision stays with the user, in the panel.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeZip } from '../../build-tools/utils/zip.js';
import {
  packPlugin, packageFileName, inspectPluginPackage, installPluginPackage, PLUGIN_PACKAGE_EXT,
} from '../electron/pluginPackage';
import { scaffoldPlugin } from '../electron/pluginScaffold';

let root: string;
/** Where plugins get installed to, distinct from where they are authored. */
let dest: string;

const MANIFEST = {
  id: 'acme.tools',
  name: 'Acme Tools',
  version: '1.2.0',
  main: { editor: 'src/editor.ts' },
};

/** A package built entry-by-entry, so a test can make one that is subtly wrong. */
const pack = (entries: Record<string, string>): Buffer =>
  makeZip(Object.entries(entries).map(([name, data]) => ({ name, data: Buffer.from(data, 'utf8') })));

const validPackage = (over: Record<string, unknown> = {}): Buffer =>
  pack({
    'plugin.json': JSON.stringify({ ...MANIFEST, ...over }),
    'src/editor.ts': 'export default { activate() {} };\n',
  });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'es-plugpkg-'));
  dest = path.join(root, 'installed');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('packPlugin', () => {
  it('round-trips a scaffolded plugin: what it writes, it can read back', async () => {
    const authored = path.join(root, 'authored');
    mkdirSync(authored, { recursive: true });
    await scaffoldPlugin(authored, { id: 'acme.tools', name: 'Acme Tools', editorVersion: '0.34.1' });

    const packed = await packPlugin(path.join(authored, 'acme.tools'));
    expect(packed.ok).toBe(true);

    const info = inspectPluginPackage(packed.data!);
    expect(info.ok).toBe(true);
    expect(info.manifest?.id).toBe('acme.tools');
    expect(info.files?.map((f) => f.name)).toEqual(
      expect.arrayContaining(['plugin.json', 'tsconfig.json', 'src/editor.ts']),
    );
  });

  it('leaves out build output and vendored dependencies', async () => {
    const dir = path.join(root, 'acme.tools');
    mkdirSync(path.join(dir, 'node_modules', 'left-pad'), { recursive: true });
    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(MANIFEST));
    writeFileSync(path.join(dir, 'src', 'editor.ts'), 'export default {};');
    writeFileSync(path.join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;');
    writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'nope');

    const packed = await packPlugin(dir);
    const names = inspectPluginPackage(packed.data!).files!.map((f) => f.name);
    expect(names).toContain('src/editor.ts');
    expect(names.some((n) => n.startsWith('node_modules/'))).toBe(false);
    expect(names.some((n) => n.startsWith('dist/'))).toBe(false);
  });

  it('refuses to export a folder whose manifest has drifted invalid', async () => {
    const dir = path.join(root, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ ...MANIFEST, id: 'NotDotted' }));
    const packed = await packPlugin(dir);
    expect(packed.ok).toBe(false);
    expect(packed.error).toMatch(/not valid/);
  });

  it('names the file after the id and version', () => {
    expect(packageFileName(MANIFEST)).toBe(`acme.tools-1.2.0.${PLUGIN_PACKAGE_EXT}`);
  });
});

describe('inspectPluginPackage', () => {
  it('reports the manifest, capabilities and file list without extracting', () => {
    const info = inspectPluginPackage(validPackage({ capabilities: ['fs:project', 'net'] }));
    expect(info.ok).toBe(true);
    expect(info.name).toBe('Acme Tools');
    expect(info.capabilities).toEqual(['fs:project', 'net']);
    expect(info.files).toHaveLength(2);
  });

  it('reports a file that is not an archive instead of throwing', () => {
    const info = inspectPluginPackage(Buffer.from('this is a text file, not a zip'));
    expect(info.ok).toBe(false);
    expect(info.error).toBeTruthy();
  });

  it('refuses a package with no manifest, but still lists what is inside', () => {
    const info = inspectPluginPackage(pack({ 'readme.txt': 'hi' }));
    expect(info.ok).toBe(false);
    expect(info.error).toMatch(/no plugin.json/);
    // The listing survives the rejection: "what IS this file, then?" is the next
    // question, and answering it costs nothing.
    expect(info.files?.map((f) => f.name)).toEqual(['readme.txt']);
  });

  it('refuses an entry that would escape the install folder', () => {
    const info = inspectPluginPackage(pack({
      'plugin.json': JSON.stringify(MANIFEST),
      '../../evil.js': 'pwned',
    }));
    expect(info.ok).toBe(false);
    expect(info.error).toMatch(/unsafe entry name/);
  });

  it('refuses an absolute entry name', () => {
    const info = inspectPluginPackage(pack({ '/etc/passwd': 'x' }));
    expect(info.ok).toBe(false);
    expect(info.error).toMatch(/unsafe entry name/);
  });

  it('names the manifest problem rather than a generic failure', () => {
    const info = inspectPluginPackage(validPackage({ version: 'one' }));
    expect(info.ok).toBe(false);
    expect(info.error).toMatch(/`version`/);
  });
});

describe('installPluginPackage', () => {
  it('installs under the id the manifest declares, not the file name', async () => {
    const r = await installPluginPackage(validPackage(), dest);
    expect(r.ok).toBe(true);
    expect(r.id).toBe('acme.tools');
    expect(existsSync(path.join(dest, 'acme.tools', 'plugin.json'))).toBe(true);
    expect(readFileSync(path.join(dest, 'acme.tools', 'src', 'editor.ts'), 'utf8'))
      .toContain('activate');
  });

  it('refuses to overwrite a plugin that is already there', async () => {
    expect((await installPluginPackage(validPackage(), dest)).ok).toBe(true);
    const before = readFileSync(path.join(dest, 'acme.tools', 'src', 'editor.ts'), 'utf8');

    const second = await installPluginPackage(
      pack({ 'plugin.json': JSON.stringify(MANIFEST), 'src/editor.ts': 'REPLACED' }),
      dest,
    );
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already installed/);
    expect(readFileSync(path.join(dest, 'acme.tools', 'src', 'editor.ts'), 'utf8')).toBe(before);
  });

  it('writes nothing at all when the package is rejected', async () => {
    const r = await installPluginPackage(pack({ 'readme.txt': 'hi' }), dest);
    expect(r.ok).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  it('leaves no half-plugin behind when extraction fails', async () => {
    // A corrupt PAYLOAD: the central directory still reads cleanly (so inspect
    // passes and the user is shown a sane preview), but the entry's CRC no longer
    // matches — which readZip only discovers partway through extracting.
    const corrupt = Buffer.from(validPackage());
    // Locate the first entry's compressed data from its own local header, rather
    // than guessing an offset: a guess that lands in the name corrupts nothing.
    const nameLen = corrupt.readUInt16LE(26);
    const extraLen = corrupt.readUInt16LE(28);
    const dataAt = 30 + nameLen + extraLen;
    corrupt[dataAt + 2] ^= 0xff;

    const r = await installPluginPackage(corrupt, dest);
    expect(r.ok).toBe(false);
    expect(existsSync(path.join(dest, 'acme.tools'))).toBe(false);
  });
});
