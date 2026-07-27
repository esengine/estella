// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The scripted file-dialog seam. Two properties carry the whole design:
//
//   1. Outside shot mode it must be a pure delegation — an automation hook that
//      changed real behaviour would be worse than no hook.
//   2. Inside shot mode with nothing scripted it must CANCEL, never open a real
//      dialog. A headless run that opened one would block until the harness timed
//      out, and the failure would read as a hang rather than a missing script.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const showOpen = vi.fn();
const showSave = vi.fn();

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpen(...args),
    showSaveDialog: (...args: unknown[]) => showSave(...args),
  },
}));

// Imported after the mock, and re-imported per test because the queues are module
// state consumed once — which is the behaviour under test.
async function load() {
  vi.resetModules();
  return import('../electron/shotDialogs');
}

const win = {} as never;

beforeEach(() => {
  showOpen.mockReset().mockResolvedValue({ canceled: false, filePaths: ['/real/pick'] });
  showSave.mockReset().mockResolvedValue({ canceled: false, filePath: '/real/save' });
  delete process.env.ESTELLA_SHOT;
  delete process.env.ESTELLA_SHOT_PICK_FILE;
  delete process.env.ESTELLA_SHOT_SAVE_FILE;
});

afterEach(() => {
  delete process.env.ESTELLA_SHOT;
  delete process.env.ESTELLA_SHOT_PICK_FILE;
  delete process.env.ESTELLA_SHOT_SAVE_FILE;
});

describe('outside shot mode', () => {
  it('delegates to the real dialog, unchanged', async () => {
    const { showOpenDialog, showSaveDialog } = await load();
    expect(await showOpenDialog(win, { title: 'Open' })).toEqual({ canceled: false, filePaths: ['/real/pick'] });
    expect(await showSaveDialog(win, { title: 'Save' })).toEqual({ canceled: false, filePath: '/real/save' });
    expect(showOpen).toHaveBeenCalledOnce();
    expect(showSave).toHaveBeenCalledOnce();
  });

  it('ignores a scripted path when not in shot mode', async () => {
    process.env.ESTELLA_SHOT_PICK_FILE = '/scripted/a.esplugin';
    const { showOpenDialog } = await load();
    expect((await showOpenDialog(win, {})).filePaths).toEqual(['/real/pick']);
  });
});

describe('in shot mode', () => {
  beforeEach(() => {
    process.env.ESTELLA_SHOT = 'out.png';
  });

  it('cancels rather than opening a real dialog when nothing is scripted', async () => {
    const { showOpenDialog, showSaveDialog } = await load();
    expect(await showOpenDialog(win, { title: 'Open' })).toEqual({ canceled: true, filePaths: [] });
    expect(await showSaveDialog(win, { title: 'Save' })).toEqual({ canceled: true });
    // The point of the whole file: a headless run must never block on a modal.
    expect(showOpen).not.toHaveBeenCalled();
    expect(showSave).not.toHaveBeenCalled();
  });

  it('hands back a single scripted path', async () => {
    process.env.ESTELLA_SHOT_PICK_FILE = 'C:/tmp/a.esplugin';
    process.env.ESTELLA_SHOT_SAVE_FILE = 'C:/tmp/out.esplugin';
    const { showOpenDialog, showSaveDialog } = await load();
    expect(await showOpenDialog(win, {})).toEqual({ canceled: false, filePaths: ['C:/tmp/a.esplugin'] });
    expect(await showSaveDialog(win, {})).toEqual({ canceled: false, filePath: 'C:/tmp/out.esplugin' });
  });

  it('feeds successive dialogs from a JSON queue, then cancels', async () => {
    process.env.ESTELLA_SHOT_PICK_FILE = JSON.stringify(['/one', '/two']);
    const { showOpenDialog } = await load();
    expect((await showOpenDialog(win, {})).filePaths).toEqual(['/one']);
    expect((await showOpenDialog(win, {})).filePaths).toEqual(['/two']);
    // Exhausted — and still no real dialog.
    expect(await showOpenDialog(win, {})).toEqual({ canceled: true, filePaths: [] });
    expect(showOpen).not.toHaveBeenCalled();
  });

  it('supports a multi-selection entry', async () => {
    process.env.ESTELLA_SHOT_PICK_FILE = JSON.stringify([['/a.png', '/b.png'], '/c.png']);
    const { showOpenDialog } = await load();
    expect((await showOpenDialog(win, {})).filePaths).toEqual(['/a.png', '/b.png']);
    expect((await showOpenDialog(win, {})).filePaths).toEqual(['/c.png']);
  });

  it('treats an unparseable value as one literal path rather than guessing', async () => {
    process.env.ESTELLA_SHOT_PICK_FILE = '[not json';
    const { showOpenDialog } = await load();
    expect((await showOpenDialog(win, {})).filePaths).toEqual(['[not json']);
  });

  it('keeps the open and save queues independent', async () => {
    process.env.ESTELLA_SHOT_PICK_FILE = '/in';
    process.env.ESTELLA_SHOT_SAVE_FILE = '/out';
    const { showOpenDialog, showSaveDialog } = await load();
    // Consuming one must not drain the other — a shot that exports then imports
    // scripts both, and an interleaved queue would hand back the wrong file.
    expect((await showOpenDialog(win, {})).filePaths).toEqual(['/in']);
    expect((await showSaveDialog(win, {})).filePath).toBe('/out');
  });
});
