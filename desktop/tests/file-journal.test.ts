// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  fileJournal — the half of an agent transaction that lives on disk.
 *
 * The claim under test is the one the UI makes on its behalf: after a revert the
 * project's files are what they were before the transaction opened. So the
 * assertions read the disk rather than the journal's own bookkeeping.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  beginTransaction, endTransaction, activeTransaction, capture, changes,
  revert, discard, discardAll, touchedPaths, isRestorable, __testing,
} from '../electron/fileJournal';

let root = '';

const abs = (rel: string) => path.join(root, rel);
const write = async (rel: string, text: string) => {
  await mkdir(path.dirname(abs(rel)), { recursive: true });
  await writeFile(abs(rel), text, 'utf8');
};
const read = (rel: string) => readFile(abs(rel), 'utf8');

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'estella-journal-test-'));
});

afterEach(async () => {
  await discardAll();
  await rm(root, { recursive: true, force: true });
});

describe('a transaction over project files', () => {
  it('puts back what a write overwrote', async () => {
    await write('Scripts/HP.ts', 'before');
    beginTransaction(root);
    await capture('Scripts/HP.ts', 'write');
    await write('Scripts/HP.ts', 'after');

    const id = endTransaction()!;
    expect(await read('Scripts/HP.ts')).toBe('after');
    await revert(id);
    expect(await read('Scripts/HP.ts')).toBe('before');
  });

  it('deletes what the transaction created', async () => {
    beginTransaction(root);
    await capture('Scripts/HealthBarBehavior.ts', 'write');
    await write('Scripts/HealthBarBehavior.ts', 'export class HealthBarBehavior {}');

    const id = endTransaction()!;
    await revert(id);
    expect(existsSync(abs('Scripts/HealthBarBehavior.ts'))).toBe(false);
  });

  // A turn that writes the same file four times must revert to what was there
  // before the FIRST write — the state the user last saw.
  it('keeps the first capture of a path, not the last', async () => {
    await write('HUD.esscene', 'v0');
    beginTransaction(root);
    for (const v of ['v1', 'v2', 'v3']) {
      await capture('HUD.esscene', 'write');
      await write('HUD.esscene', v);
    }

    const id = endTransaction()!;
    expect(changes(id)).toHaveLength(1);
    await revert(id);
    expect(await read('HUD.esscene')).toBe('v0');
  });

  // Creating a directory then a file inside it comes apart the other way round;
  // deleting the directory first would leave the file with nowhere to be.
  it('unwinds captures newest-first', async () => {
    beginTransaction(root);
    await capture('UI', 'write');
    await mkdir(abs('UI'), { recursive: true });
    await capture('UI/HealthBar.esprefab', 'write');
    await write('UI/HealthBar.esprefab', '{}');

    const id = endTransaction()!;
    const result = await revert(id);
    expect(result.failed).toEqual([]);
    expect(existsSync(abs('UI'))).toBe(false);
  });

  it('restores a .meta sidecar with its file, so the uuid survives', async () => {
    await write('Art/hero.png', 'PNG0');
    await write('Art/hero.png.meta', '{"uuid":"keep-me"}');
    beginTransaction(root);
    await capture('Art/hero.png', 'remove');
    await rm(abs('Art/hero.png'));
    await rm(abs('Art/hero.png.meta'));

    const id = endTransaction()!;
    await revert(id);
    expect(await read('Art/hero.png')).toBe('PNG0');
    expect(JSON.parse(await read('Art/hero.png.meta')).uuid).toBe('keep-me');
  });

  // A file that gained a sidecar during the transaction must lose it again:
  // leaving one behind puts an asset in the registry the revert claims to have
  // removed.
  it('removes a sidecar the transaction added', async () => {
    await write('Art/hero.png', 'PNG0');
    beginTransaction(root);
    await capture('Art/hero.png', 'write');
    await write('Art/hero.png.meta', '{"uuid":"new"}');

    const id = endTransaction()!;
    await revert(id);
    expect(existsSync(abs('Art/hero.png.meta'))).toBe(false);
  });

  it('restores a captured directory whole', async () => {
    await write('Levels/one.esscene', 'A');
    await write('Levels/two.esscene', 'B');
    beginTransaction(root);
    await capture('Levels', 'write');
    await rm(abs('Levels'), { recursive: true });
    await write('Levels/three.esscene', 'C');

    const id = endTransaction()!;
    await revert(id);
    expect(await read('Levels/one.esscene')).toBe('A');
    expect(await read('Levels/two.esscene')).toBe('B');
    expect(existsSync(abs('Levels/three.esscene'))).toBe(false);
  });
});

describe('what it reports', () => {
  it('names each path once, with what was done to it', async () => {
    await write('HUD.esscene', 'v0');
    beginTransaction(root);
    await capture('HUD.esscene', 'write');
    await capture('Scripts/HP.ts', 'write');

    const id = endTransaction()!;
    expect(changes(id)).toEqual([
      { path: 'HUD.esscene', kind: 'modify', unjournaled: false },
      { path: 'Scripts/HP.ts', kind: 'add', unjournaled: false },
    ]);
    expect(touchedPaths(id)).toEqual(['HUD.esscene', 'Scripts/HP.ts']);
  });

  // A door captures before it looks, so it captures deletes that turn out to be
  // no-ops too. Recording one would put a phantom line in the history entry.
  it('records nothing for a remove of a path that is not there', async () => {
    beginTransaction(root);
    await capture('never-existed.txt', 'remove');
    expect(changes(endTransaction()!)).toEqual([]);
  });

  // The point of the report: a revert that leaves something in place says so,
  // rather than letting the UI claim the whole turn came back.
  it('says which paths it could not hold', async () => {
    const was = __testing.setBudget(100);
    try {
      await write('small.txt', 'x'.repeat(50));
      await write('Video/intro.mp4', 'y'.repeat(200));
      beginTransaction(root);
      await capture('small.txt', 'write');
      await capture('Video/intro.mp4', 'write');
      await write('small.txt', 'replaced');
      await write('Video/intro.mp4', 'replaced');

      const id = endTransaction()!;
      expect(changes(id)).toEqual([
        { path: 'small.txt', kind: 'modify', unjournaled: false },
        { path: 'Video/intro.mp4', kind: 'modify', unjournaled: true },
      ]);
      const result = await revert(id);
      expect(result.restored).toEqual(['small.txt']);
      expect(result.unjournaled).toEqual(['Video/intro.mp4']);
      expect(await read('small.txt')).toBe('x'.repeat(50));
      expect(await read('Video/intro.mp4')).toBe('replaced');
    } finally {
      __testing.setBudget(was);
    }
  });

  it('reports a restore that threw instead of swallowing it', async () => {
    await write('locked.txt', 'before');
    beginTransaction(root);
    await capture('locked.txt', 'write');
    const id = endTransaction()!;
    // The project root is gone — every restore under it must fail loudly.
    await rm(root, { recursive: true, force: true });
    await writeFile(root, 'now a file', 'utf8');

    const result = await revert(id);
    expect(result.restored).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe('locked.txt');
  });
});

describe('a transaction lifetime', () => {
  it('captures nothing while none is open', async () => {
    await write('a.txt', 'before');
    expect(activeTransaction()).toBeNull();
    await capture('a.txt', 'write');
    await write('a.txt', 'after');
    // No transaction, nothing held, nothing to revert.
    expect(changes('nope')).toEqual([]);
  });

  it('opening a second one closes the first', async () => {
    beginTransaction(root);
    await capture('a.txt', 'write');
    const second = beginTransaction(root);
    expect(activeTransaction()).toBe(second);
  });

  it('a revert consumes the transaction, so a second one is a no-op', async () => {
    await write('a.txt', 'before');
    beginTransaction(root);
    await capture('a.txt', 'write');
    await write('a.txt', 'after');
    const id = endTransaction()!;

    await revert(id);
    await write('a.txt', 'the user typed this');
    const again = await revert(id);
    expect(again.restored).toEqual([]);
    expect(await read('a.txt')).toBe('the user typed this');
  });

  it('discard drops the copies and stops offering a revert', async () => {
    await write('a.txt', 'before');
    beginTransaction(root);
    await capture('a.txt', 'write');
    const id = endTransaction()!;
    expect(isRestorable(id)).toBe(true);

    await discard(id);
    expect(isRestorable(id)).toBe(false);
  });

  it('reverting the open transaction closes it first', async () => {
    await write('a.txt', 'before');
    const id = beginTransaction(root);
    await capture('a.txt', 'write');
    await write('a.txt', 'after');

    await revert(id);
    expect(activeTransaction()).toBeNull();
    expect(await read('a.txt')).toBe('before');
  });
});
