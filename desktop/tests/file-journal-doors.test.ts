// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every project-write door announces itself to the journal.
 *
 * The journal is only as good as its coverage: one door that writes without
 * capturing is a file the "Revert" button silently leaves behind, and the UI has
 * no way to know. So this drives the DOORS — writeInRoot, renameInRoot, the
 * importer, the script scaffold — and asserts the disk comes back, rather than
 * testing the journal against itself (file-journal.test.ts does that).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  writeInRoot, renameInRoot, mkdirInRoot, duplicateInRoot,
} from '../electron/projectFs';
import { createAsset, importAssets } from '../electron/importAssets';
import { scaffoldScript } from '../electron/scriptScaffold';
import { beginTransaction, endTransaction, changes, revert, discardAll } from '../electron/fileJournal';

let root = '';
const abs = (rel: string) => path.join(root, rel);
const read = (rel: string) => readFile(abs(rel), 'utf8');
const seed = async (rel: string, text: string) => {
  await mkdir(path.dirname(abs(rel)), { recursive: true });
  await writeFile(abs(rel), text, 'utf8');
};

const ENTRIES = { main: 'src/main.ts', register: 'src/components.ts' };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'estella-doors-test-'));
});
afterEach(async () => {
  await discardAll();
  await rm(root, { recursive: true, force: true });
});

describe('the doors a turn writes through', () => {
  it('writeInRoot', async () => {
    await seed('HUD.esscene', 'v0');
    beginTransaction(root);
    await writeInRoot(root, 'HUD.esscene', 'v1');
    await revert(endTransaction()!);
    expect(await read('HUD.esscene')).toBe('v0');
  });

  it('renameInRoot puts the file back where it was', async () => {
    await seed('Art/hero.png', 'PNG');
    beginTransaction(root);
    await renameInRoot(root, 'Art/hero.png', 'Art/villain.png');
    await revert(endTransaction()!);
    expect(await read('Art/hero.png')).toBe('PNG');
    expect(existsSync(abs('Art/villain.png'))).toBe(false);
  });

  it('mkdirInRoot', async () => {
    beginTransaction(root);
    await mkdirInRoot(root, 'UI');
    await revert(endTransaction()!);
    expect(existsSync(abs('UI'))).toBe(false);
  });

  it('duplicateInRoot removes the copy it named itself', async () => {
    await seed('Art/hero.png', 'PNG');
    beginTransaction(root);
    const copy = await duplicateInRoot(root, 'Art/hero.png');
    expect(existsSync(abs(copy))).toBe(true);
    await revert(endTransaction()!);
    expect(existsSync(abs(copy))).toBe(false);
    expect(await read('Art/hero.png')).toBe('PNG');
  });

  it('createAsset takes the sidecar with the file', async () => {
    beginTransaction(root);
    const rel = await createAsset(root, 'Levels', 'Arena', '{}', 'scene');
    expect(existsSync(abs(rel + '.meta'))).toBe(true);
    await revert(endTransaction()!);
    expect(existsSync(abs(rel))).toBe(false);
    expect(existsSync(abs(rel + '.meta'))).toBe(false);
  });

  // Registering a file that was already in the project mints only a sidecar.
  // The revert has to take that back too: a `.meta` left behind is an asset in
  // the registry the user never adopted.
  it('importAssets un-registers a file it adopted in place', async () => {
    await seed('Art/loose.png', 'PNG');
    beginTransaction(root);
    await importAssets(root, 'Art', [abs('Art/loose.png')]);
    expect(existsSync(abs('Art/loose.png.meta'))).toBe(true);

    await revert(endTransaction()!);
    expect(await read('Art/loose.png')).toBe('PNG');
    expect(existsSync(abs('Art/loose.png.meta'))).toBe(false);
  });

  it('importAssets removes a file it copied in', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'estella-src-'));
    await writeFile(path.join(outside, 'sprite.png'), 'PNG', 'utf8');
    try {
      beginTransaction(root);
      const { imported } = await importAssets(root, 'Art', [path.join(outside, 'sprite.png')]);
      expect(imported).toEqual(['Art/sprite.png']);
      await revert(endTransaction()!);
      expect(existsSync(abs('Art/sprite.png'))).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  // The scaffold writes TWO files — the module and the entry line that makes it
  // live. A revert that took back only the module would leave an import of a
  // file that no longer exists, which is a project that will not build.
  it('scaffoldScript takes back the module AND the entry wiring', async () => {
    await seed(ENTRIES.main, 'export {};\n');
    await seed(ENTRIES.register, 'export {};\n');
    beginTransaction(root);
    const made = await scaffoldScript(root, {
      kind: 'component', name: 'HealthBarBehavior', entries: ENTRIES,
    });
    if (!made.ok || !made.path) throw new Error(made.error ?? 'no path');
    const module = made.path;
    // Asserted BEFORE the revert: an existsSync that was false all along would
    // pass this test without the journal doing anything.
    expect(existsSync(abs(module))).toBe(true);

    const id = endTransaction()!;
    expect(changes(id).map((c) => c.kind)).toContain('add');
    await revert(id);
    expect(existsSync(abs(module))).toBe(false);
    expect(await read(ENTRIES.register)).toBe('export {};\n');
    expect(await read(ENTRIES.main)).toBe('export {};\n');
  });
});

describe('what the change list says', () => {
  it('separates what the turn created from what it changed', async () => {
    await seed('HUD.esscene', 'v0');
    beginTransaction(root);
    await writeInRoot(root, 'HUD.esscene', 'v1');
    await writeInRoot(root, 'src/HealthBar.ts', 'export {};');

    expect(changes(endTransaction()!)).toEqual([
      { path: 'HUD.esscene', kind: 'modify', unjournaled: false },
      { path: 'src/HealthBar.ts', kind: 'add', unjournaled: false },
    ]);
  });

  it('is empty when no transaction was open', async () => {
    await seed('HUD.esscene', 'v0');
    await writeInRoot(root, 'HUD.esscene', 'v1');
    const id = beginTransaction(root);
    expect(changes(id)).toEqual([]);
    endTransaction();
  });
});
