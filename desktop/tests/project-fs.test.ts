/**
 * @file  Project filesystem mutations (Content Browser asset ops). Covers the
 *        non-obvious correctness: rename carries the `.meta` sidecar (asset
 *        identity is stable), duplicate assigns a FRESH uuid (two assets can't
 *        share one in the registry), and the root sandbox refuses escapes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveInRoot,
  renameInRoot,
  mkdirInRoot,
  duplicateInRoot,
  statInRoot,
} from '../electron/projectFs';
import { isIgnoredPath } from '../electron/projectWatcher';
import { importAssets } from '../electron/importAssets';

let root: string;
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const meta = (uuid: string, type = 'texture') =>
  JSON.stringify({ uuid, version: '2.0', type, importer: {} }, null, 2) + '\n';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-fs-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNG');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('importAssets', () => {
  let ext: string;
  beforeEach(() => {
    // An external source dir (outside the project root) to import from.
    ext = mkdtempSync(path.join(tmpdir(), 'estella-ext-'));
    writeFileSync(path.join(ext, 'logo.png'), 'PNGDATA');
    writeFileSync(path.join(ext, 'notes.xyz'), 'unknown');
  });
  afterEach(() => rmSync(ext, { recursive: true, force: true }));

  it('copies a file + writes a .meta with a uuid and extension-derived type', async () => {
    const res = await importAssets(root, 'assets', [path.join(ext, 'logo.png')]);
    expect(res.imported).toEqual(['assets/logo.png']);
    expect(read('assets/logo.png')).toBe('PNGDATA');
    const meta = JSON.parse(read('assets/logo.png.meta'));
    expect(meta.type).toBe('texture');
    expect(meta.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta.importer.maxSize).toBe(2048);
  });

  it('skips unknown extensions and dedupes existing names', async () => {
    const res = await importAssets(root, 'assets', [
      path.join(ext, 'notes.xyz'),
      path.join(ext, 'logo.png'),
      path.join(ext, 'logo.png'),
    ]);
    expect(res.skipped).toEqual(['notes.xyz']);
    expect(res.imported).toEqual(['assets/logo.png', 'assets/logo 2.png']);
  });
});

describe('isIgnoredPath (watcher noise filter)', () => {
  it('ignores the editor cache + heavy dirs (no refresh loop)', () => {
    // `.esengine` is where we write assets.json — refreshing on it would loop.
    expect(isIgnoredPath('.esengine/cache/assets.json')).toBe(true);
    expect(isIgnoredPath('node_modules/foo/index.js')).toBe(true);
    expect(isIgnoredPath('.git/HEAD')).toBe(true);
    expect(isIgnoredPath('build/out.png')).toBe(true);
  });
  it('does not ignore real assets', () => {
    expect(isIgnoredPath('assets/hero.png')).toBe(false);
    expect(isIgnoredPath('scenes/main.esscene')).toBe(false);
    // a file merely starting with an ignored name (not a dir boundary) is fine
    expect(isIgnoredPath('distortion.png')).toBe(false);
  });
});

describe('resolveInRoot', () => {
  it('refuses paths that escape the root', () => {
    expect(() => resolveInRoot(root, '../secret')).toThrow(/escapes/);
    expect(() => resolveInRoot(root, '/etc/passwd')).toThrow(/escapes/);
  });
});

describe('renameInRoot', () => {
  it('moves the file and its .meta sidecar together (uuid preserved)', async () => {
    await renameInRoot(root, 'assets/hero.png', 'assets/villain.png');
    expect(existsSync(path.join(root, 'assets', 'hero.png'))).toBe(false);
    expect(existsSync(path.join(root, 'assets', 'hero.png.meta'))).toBe(false);
    expect(read('assets/villain.png')).toBe('PNG');
    expect(JSON.parse(read('assets/villain.png.meta')).uuid).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('refuses to clobber an existing destination', async () => {
    writeFileSync(path.join(root, 'assets', 'taken.png'), 'X');
    await expect(renameInRoot(root, 'assets/hero.png', 'assets/taken.png')).rejects.toThrow(/already exists/);
  });
});

describe('mkdirInRoot', () => {
  it('creates a folder and refuses if it already exists', async () => {
    await mkdirInRoot(root, 'assets/sprites');
    expect(existsSync(path.join(root, 'assets', 'sprites'))).toBe(true);
    await expect(mkdirInRoot(root, 'assets/sprites')).rejects.toThrow(/already exists/);
  });
});

describe('statInRoot', () => {
  it('reports size + isDir for files and folders', async () => {
    const file = await statInRoot(root, 'assets/hero.png');
    expect(file.isDir).toBe(false);
    expect(file.size).toBe(3); // "PNG"
    expect(typeof file.mtimeMs).toBe('number');
    const dir = await statInRoot(root, 'assets');
    expect(dir.isDir).toBe(true);
  });
});

describe('duplicateInRoot', () => {
  it('copies a file to "… copy" and assigns the sidecar a fresh uuid', async () => {
    const rel = await duplicateInRoot(root, 'assets/hero.png');
    expect(rel).toBe('assets/hero copy.png');
    expect(read('assets/hero copy.png')).toBe('PNG');
    const dupUuid = JSON.parse(read('assets/hero copy.png.meta')).uuid;
    expect(dupUuid).not.toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(dupUuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('increments the suffix when a copy already exists', async () => {
    await duplicateInRoot(root, 'assets/hero.png');
    const rel2 = await duplicateInRoot(root, 'assets/hero.png');
    expect(rel2).toBe('assets/hero copy 2.png');
  });

  it('recurses into a folder and regenerates every nested uuid', async () => {
    mkdirSync(path.join(root, 'assets', 'pack'));
    writeFileSync(path.join(root, 'assets', 'pack', 'a.png'), 'A');
    writeFileSync(path.join(root, 'assets', 'pack', 'a.png.meta'), meta('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));
    const rel = await duplicateInRoot(root, 'assets/pack');
    expect(rel).toBe('assets/pack copy');
    expect(read('assets/pack copy/a.png')).toBe('A');
    expect(JSON.parse(read('assets/pack copy/a.png.meta')).uuid).not.toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });
});
