// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Autosave crash recovery. Two halves: the main-process snapshot store
 *        (sync → list → restore/clear roundtrip against a real temp dir, incl.
 *        the newer-than-saved recovery rule and stale-snapshot pruning) and the
 *        renderer scheduler's decisions (dirty-gate, play-skip, save-clear).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncAutosave, listAutosave, restoreAutosave, clearAutosave } from '../electron/autosave';
import { AutosaveService, type AutosaveEnv } from '@/document/Autosave';
import type { DocSnapshot } from '@/document/DirtyRegistry';

const SCENE = 'assets/scenes/main.esscene';
const snapPath = (root: string, rel: string) => path.join(root, '.esengine', 'autosave', rel);

describe('autosave snapshot store (main process)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'estella-autosave-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const writeReal = (rel: string, body: string, mtimeMs?: number) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    if (mtimeMs !== undefined) utimesSync(abs, new Date(mtimeMs), new Date(mtimeMs));
  };

  it('mirrors a dirty document under .esengine/autosave at its own path', async () => {
    await syncAutosave(root, [{ rel: SCENE, contents: 'DIRTY' }]);
    expect(readFileSync(snapPath(root, SCENE), 'utf8')).toBe('DIRTY');
  });

  it('lists a snapshot newer than its saved file as recoverable', async () => {
    writeReal(SCENE, 'SAVED', Date.now() - 60_000); // the on-disk file is older
    await syncAutosave(root, [{ rel: SCENE, contents: 'DIRTY' }]);
    const recoverable = await listAutosave(root);
    expect(recoverable.map((r) => r.rel)).toEqual([SCENE]);
    expect(recoverable[0].fileMtimeMs).not.toBeNull();
  });

  it('lists a snapshot whose saved file is gone as recoverable', async () => {
    await syncAutosave(root, [{ rel: SCENE, contents: 'DIRTY' }]);
    const recoverable = await listAutosave(root);
    expect(recoverable[0].rel).toBe(SCENE);
    expect(recoverable[0].fileMtimeMs).toBeNull();
  });

  it('does NOT list a snapshot that a later save superseded', async () => {
    await syncAutosave(root, [{ rel: SCENE, contents: 'DIRTY' }]);
    writeReal(SCENE, 'SAVED', Date.now() + 60_000); // saved after the snapshot
    expect(await listAutosave(root)).toEqual([]);
  });

  it('restore copies the snapshot over its real file, then clears the dir', async () => {
    writeReal(SCENE, 'SAVED', Date.now() - 60_000);
    await syncAutosave(root, [{ rel: SCENE, contents: 'RECOVERED' }]);
    await restoreAutosave(root, [SCENE]);
    expect(readFileSync(path.join(root, SCENE), 'utf8')).toBe('RECOVERED');
    expect(existsSync(path.join(root, '.esengine', 'autosave'))).toBe(false);
  });

  it('sync prunes a snapshot no longer in the dirty set (document saved)', async () => {
    await syncAutosave(root, [
      { rel: 'a.esscene', contents: 'A' },
      { rel: 'b.esscene', contents: 'B' },
    ]);
    expect(existsSync(snapPath(root, 'b.esscene'))).toBe(true);
    await syncAutosave(root, [{ rel: 'a.esscene', contents: 'A' }]); // b saved → absent
    expect(existsSync(snapPath(root, 'a.esscene'))).toBe(true);
    expect(existsSync(snapPath(root, 'b.esscene'))).toBe(false);
  });

  it('clear drops every snapshot and list is empty', async () => {
    await syncAutosave(root, [{ rel: SCENE, contents: 'DIRTY' }]);
    await clearAutosave(root);
    expect(await listAutosave(root)).toEqual([]);
  });
});

describe('AutosaveService scheduler (renderer)', () => {
  const snap: DocSnapshot[] = [{ path: SCENE, contents: 'DIRTY' }];
  const env = (over: Partial<AutosaveEnv>): AutosaveEnv & { sync: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } => ({
    isDirty: () => true,
    isPlaying: () => false,
    snapshotDirty: vi.fn(async () => snap),
    sync: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    ...over,
  } as AutosaveEnv & { sync: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> });

  it('gates snapshotting on dirty AND not playing', () => {
    expect(new AutosaveService(env({})).shouldSnapshot()).toBe(true);
    expect(new AutosaveService(env({ isDirty: () => false })).shouldSnapshot()).toBe(false);
    expect(new AutosaveService(env({ isPlaying: () => true })).shouldSnapshot()).toBe(false);
  });

  it('tick snapshots the dirty documents when the gate is open', async () => {
    const e = env({});
    await new AutosaveService(e).tick();
    expect(e.snapshotDirty).toHaveBeenCalledTimes(1);
    expect(e.sync).toHaveBeenCalledWith(snap);
  });

  it('tick is a no-op while a Play session is active', async () => {
    const e = env({ isPlaying: () => true });
    await new AutosaveService(e).tick();
    expect(e.sync).not.toHaveBeenCalled();
  });

  it('tick is a no-op when nothing is dirty', async () => {
    const e = env({ isDirty: () => false });
    await new AutosaveService(e).tick();
    expect(e.sync).not.toHaveBeenCalled();
  });

  it('clears snapshots when the project just became fully saved', () => {
    let dirty = true;
    const e = env({ isDirty: () => dirty });
    const svc = new AutosaveService(e);
    svc.noteDirtyChanged(); // still dirty
    expect(e.clear).not.toHaveBeenCalled();
    dirty = false;
    svc.noteDirtyChanged(); // dirty → clean transition
    expect(e.clear).toHaveBeenCalledTimes(1);
  });

  it('start runs the interval and stop halts it', async () => {
    vi.useFakeTimers();
    try {
      const e = env({});
      const svc = new AutosaveService(e, 1000);
      svc.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(e.sync).toHaveBeenCalledTimes(1);
      svc.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(e.sync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
