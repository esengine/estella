// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project filesystem mutations (Content Browser asset ops). Covers the
 *        non-obvious correctness: rename carries the `.meta` sidecar (asset
 *        identity is stable), duplicate assigns a FRESH uuid (two assets can't
 *        share one in the registry), and the root sandbox refuses escapes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveInRoot,
  readDirInRoot,
  listFilesInRoot,
  renameInRoot,
  mkdirInRoot,
  duplicateInRoot,
  statInRoot,
  readInRoot,
  writeInRoot,
  readSliceInRoot,
  searchInRoot,
  snapshotForTrash,
  restoreTrashed,
} from '../electron/projectFs';
import { isIgnoredPath } from '../electron/projectWatcher';
import { importAssets, createAsset } from '../electron/importAssets';

let root: string;
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
/** Link a directory. Windows refuses plain symlinks without elevation but allows
 *  junctions, which defeat a lexical containment check just the same. */
const linkDir = (target: string, link: string): void => {
  if (process.platform === 'win32') symlinkSync(target, link, 'junction');
  else symlinkSync(target, link, 'dir');
};
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

describe('content visibility (contentPolicy)', () => {
  beforeEach(() => {
    // Pipeline internals + non-content dirs that must never surface as entries.
    writeFileSync(path.join(root, 'assets', '.DS_Store'), '');
    mkdirSync(path.join(root, '.esengine'));
    mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', 'pkg', 'icon.png'), 'PNG');
  });

  it('readDir hides .meta sidecars, dot entries and non-content dirs', async () => {
    expect((await readDirInRoot(root, '')).map((e) => e.name)).toEqual(['assets']);
    expect((await readDirInRoot(root, 'assets')).map((e) => e.name)).toEqual(['hero.png']);
  });

  it('subtree search agrees with readDir (same policy)', async () => {
    expect(await listFilesInRoot(root, '')).toEqual(['assets/hero.png']);
  });
});

describe('searchInRoot', () => {
  beforeEach(() => {
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'systems.ts'), 'const s = defineSystem([]);\n');
    mkdirSync(path.join(root, '.esengine', 'sdk', 'shared'), { recursive: true });
    writeFileSync(
      path.join(root, '.esengine', 'sdk', 'shared', 'app.d.ts'),
      'interface PrefabOverride {\n  prefabEntityId: string;\n}\n',
    );
    mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', 'dep', 'i.ts'), 'interface PrefabOverride {}\n');
  });

  it('finds the project\'s own source', async () => {
    const hits = await searchInRoot(root, { query: 'defineSystem' });
    expect(hits.map((h) => h.file)).toEqual(['src/systems.ts']);
    expect(hits[0].line).toBe(1);
  });

  // The SDK types are what this tool exists for, and the dot-dir rule that keeps
  // them out of the Content Browser was hiding them here too — so a search for a
  // declaration the compiler had just named came back empty, which reads as "no
  // such type" and sends the caller back to paging the .d.ts by line offset.
  it('reaches the staged SDK types under .esengine/sdk', async () => {
    const hits = await searchInRoot(root, { query: 'interface PrefabOverride' });
    expect(hits.map((h) => h.file)).toContain('.esengine/sdk/shared/app.d.ts');
  });

  it('still stays out of node_modules', async () => {
    const hits = await searchInRoot(root, { query: 'interface PrefabOverride' });
    expect(hits.some((h) => h.file.startsWith('node_modules/'))).toBe(false);
  });

  it('skips the generated re-export barrels', async () => {
    // One line of several hundred aliases matches every query and points at
    // nothing; the declaration it re-exports is still found in its own file.
    writeFileSync(
      path.join(root, '.esengine', 'sdk', 'index.d.ts'),
      `export { ${Array.from({ length: 60 }, (_, i) => `a${i} as Sym${i}, x${i} as PrefabOverride${i}`).join(', ')} } from './shared/app.js';\n`,
    );
    const hits = await searchInRoot(root, { query: 'PrefabOverride' });
    expect(hits.map((h) => h.file)).toEqual(['.esengine/sdk/shared/app.d.ts']);
  });

  it('puts the project ahead of the SDK', async () => {
    writeFileSync(path.join(root, 'src', 'own.ts'), 'interface PrefabOverride {}\n');
    const hits = await searchInRoot(root, { query: 'interface PrefabOverride' });
    expect(hits[0].file).toBe('src/own.ts');
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

  it('accepts ordinary paths, existing or not', () => {
    expect(() => resolveInRoot(root, 'assets/hero.png')).not.toThrow();
    expect(() => resolveInRoot(root, 'assets/deep/not/created/yet.txt')).not.toThrow();
    expect(resolveInRoot(root, '')).toBe(path.resolve(root));
  });

  // A project is not trusted input — it can be cloned, unzipped or shared, and a
  // link inside it holds no `..` for a lexical check to catch.
  it('refuses a link that points out of the root', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'estella-outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'PRIVATE');
    try {
      linkDir(outside, path.join(root, 'assets', 'escape'));
    } catch {
      return; // no permission to make one here; the check is exercised below anyway
    }
    expect(() => resolveInRoot(root, 'assets/escape/secret.txt')).toThrow(/link/);
    expect(() => resolveInRoot(root, 'assets/escape')).toThrow(/link/);
    // Reaching THROUGH the link for a path that does not exist yet is a write.
    expect(() => resolveInRoot(root, 'assets/escape/planted.txt')).toThrow(/link/);
    rmSync(outside, { recursive: true, force: true });
  });

  // The door itself, not just the helper: a real read and a real write.
  it('does not read or write through a link, end to end', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'estella-outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'PRIVATE');
    try {
      linkDir(outside, path.join(root, 'assets', 'escape'));
    } catch {
      return;
    }
    await expect(readInRoot(root, 'assets/escape/secret.txt')).rejects.toThrow(/link/);
    await expect(writeInRoot(root, 'assets/escape/planted.txt', 'x')).rejects.toThrow(/link/);
    expect(existsSync(path.join(outside, 'planted.txt'))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  // The counterpart: a link that stays inside is ordinary project content.
  it('allows a link that stays within the root', () => {
    mkdirSync(path.join(root, 'assets', 'shared'), { recursive: true });
    writeFileSync(path.join(root, 'assets', 'shared', 'note.txt'), 'ok');
    try {
      linkDir(path.join(root, 'assets', 'shared'), path.join(root, 'assets', 'alias'));
    } catch {
      return;
    }
    expect(() => resolveInRoot(root, 'assets/alias/note.txt')).not.toThrow();
  });

  // A project living under a symlinked path (macOS /tmp, a symlinked projects dir)
  // must not have every one of its own files rejected.
  it('works when the ROOT is itself reached through a link', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'estella-linkroot-'));
    const alias = path.join(base, 'alias');
    try {
      linkDir(root, alias);
    } catch {
      return;
    }
    expect(() => resolveInRoot(alias, 'assets/hero.png')).not.toThrow();
    expect(() => resolveInRoot(alias, '../secret')).toThrow(/escapes/);
    rmSync(base, { recursive: true, force: true });
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

describe('trash undo (snapshotForTrash / restoreTrashed)', () => {
  const rmAt = (rel: string) => rmSync(path.join(root, rel), { force: true, recursive: true });

  it('restores a deleted file + .meta with the SAME uuid (refs stay valid)', async () => {
    const token = await snapshotForTrash(root, 'assets/hero.png');
    rmAt('assets/hero.png'); // stands in for shell.trashItem
    rmAt('assets/hero.png.meta');
    await restoreTrashed(root, 'assets/hero.png', token);
    expect(read('assets/hero.png')).toBe('PNG');
    expect(JSON.parse(read('assets/hero.png.meta')).uuid).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('restores a folder recursively, sidecars included', async () => {
    mkdirSync(path.join(root, 'assets', 'pack'));
    writeFileSync(path.join(root, 'assets', 'pack', 'a.png'), 'A');
    writeFileSync(path.join(root, 'assets', 'pack', 'a.png.meta'), meta('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));
    const token = await snapshotForTrash(root, 'assets/pack');
    rmAt('assets/pack');
    await restoreTrashed(root, 'assets/pack', token);
    expect(read('assets/pack/a.png')).toBe('A');
    expect(JSON.parse(read('assets/pack/a.png.meta')).uuid).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('refuses to clobber a path re-taken since the delete', async () => {
    const token = await snapshotForTrash(root, 'assets/hero.png');
    // The path was re-taken (e.g. a new import with the same name).
    await expect(restoreTrashed(root, 'assets/hero.png', token)).rejects.toThrow(/already exists/);
    expect(read('assets/hero.png')).toBe('PNG'); // untouched
  });

  it('a snapshot restores only once; malformed tokens are rejected', async () => {
    const token = await snapshotForTrash(root, 'assets/hero.png');
    rmAt('assets/hero.png');
    rmAt('assets/hero.png.meta');
    await restoreTrashed(root, 'assets/hero.png', token);
    rmAt('assets/hero.png');
    await expect(restoreTrashed(root, 'assets/hero.png', token)).rejects.toThrow(/nothing to restore/);
    await expect(restoreTrashed(root, 'assets/hero.png', '../../etc')).rejects.toThrow(/invalid restore token/);
  });

  it('snapshotting a missing path fails up front (no empty undo)', async () => {
    await expect(snapshotForTrash(root, 'assets/ghost.png')).rejects.toThrow(/does not exist/);
  });
});

describe('createAsset', () => {
  it('writes the file + a .meta (fresh uuid + type) and dedups the name', async () => {
    const p1 = await createAsset(root, 'assets', 'scene.esscene', '{"v":"1.0"}', 'scene');
    expect(p1).toBe('assets/scene.esscene');
    expect(read('assets/scene.esscene')).toBe('{"v":"1.0"}');
    const m = JSON.parse(read('assets/scene.esscene.meta'));
    expect(m.type).toBe('scene');
    expect(m.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);

    // A second create with the same base name dedups rather than clobbering.
    const p2 = await createAsset(root, 'assets', 'scene.esscene', '{}', 'scene');
    expect(p2).toBe('assets/scene 2.esscene');
    expect(read('assets/scene.esscene')).toBe('{"v":"1.0"}'); // original untouched
  });
});

describe('readSliceInRoot (paging a file too big for one reply)', () => {
  const LINES = 500;
  const NL = String.fromCharCode(10);
  beforeEach(() => {
    writeFileSync(path.join(root, 'big.ts'), Array.from({ length: LINES }, (_, i) => `line ${i + 1}`).join(NL));
  });

  it('returns the whole file byte for byte when neither bound is given', async () => {
    const all = await readSliceInRoot(root, 'big.ts');
    expect(all).toBe(readFileSync(path.join(root, 'big.ts'), 'utf8'));
  });

  it('takes offset as a 1-based line and limit as a count', async () => {
    expect(await readSliceInRoot(root, 'big.ts', 1, 2)).toBe(['line 1', 'line 2'].join(NL));
    expect(await readSliceInRoot(root, 'big.ts', 100, 3)).toBe(['line 100', 'line 101', 'line 102'].join(NL));
    // A limit past the end simply stops at the end.
    expect(await readSliceInRoot(root, 'big.ts', 499, 50)).toBe(['line 499', 'line 500'].join(NL));
    // An offset with no limit runs to the end.
    expect(await readSliceInRoot(root, 'big.ts', 498)).toBe(['line 498', 'line 499', 'line 500'].join(NL));
  });

  it('refuses an offset past the end, naming the length', async () => {
    // Empty would read as "the file ends here", which is how a caller decides it
    // has seen everything — the exact wrong conclusion.
    await expect(readSliceInRoot(root, 'big.ts', 501)).rejects.toThrow(/past the end/);
    await expect(readSliceInRoot(root, 'big.ts', 501)).rejects.toThrow(/500 line/);
  });

  it('still refuses to leave the project root', async () => {
    await expect(readSliceInRoot(root, '../outside.txt', 1, 1)).rejects.toThrow();
  });
});
