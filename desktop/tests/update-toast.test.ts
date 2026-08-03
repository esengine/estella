// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the user sees for an update, from the click to the restart.
 *
 *        The complaint this answers was "clicking Check for Updates does nothing":
 *        the toast used to be posted only once the network had answered, and on a
 *        network that never answers, never. So the assertions here are mostly about
 *        WHEN a toast exists, not just what it says — and about the one outcome the
 *        old code could not express, a source that said nothing being reported as
 *        "up to date" in green.
 *
 *        The download half is driven through a stand-in bridge because the real one
 *        (electron-updater) only exists in a packaged, signed build; what is covered
 *        here is every state the renderer puts on screen in between.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Toasts, type Toast } from '@/store/Toasts';
import { checkForUpdatesInteractive, notifyUpdate } from '@/update/updateToast';

interface AppBridge {
  checkUpdates?: () => Promise<unknown>;
  downloadUpdate?: () => Promise<void>;
  installUpdate?: () => Promise<boolean>;
  onUpdateProgress?: (cb: (p: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => () => void;
}

const opened: string[] = [];

function bridge(app: AppBridge | undefined): void {
  (globalThis as unknown as { window: unknown }).window = {
    estella: app ? { app } : undefined,
    open: (url: string) => { opened.push(url); return null; },
  };
}

const toasts = (): Toast[] => Toasts.getSnapshot();
const only = (): Toast => {
  const list = toasts();
  expect(list).toHaveLength(1);
  return list[0];
};
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  for (const toast of toasts()) Toasts.dismiss(toast.id);
  opened.length = 0;
  bridge({});
});

describe('checkForUpdatesInteractive', () => {
  it('shows that it is checking BEFORE the network answers', async () => {
    let answer: (v: unknown) => void = () => {};
    bridge({ checkUpdates: () => new Promise((r) => { answer = r; }) });

    const done = checkForUpdatesInteractive();
    // The whole bug: this instant used to be empty, for as long as the request took.
    const checking = only();
    expect(checking.message).toBe('Checking for updates…');
    expect(checking.progress).toBe('indeterminate');
    expect(checking.pinned).toBe(true); // nothing to close: it is not an outcome yet

    answer({ status: 'current' });
    await done;
    expect(only().message).toBe('Estella is up to date');
  });

  it('rewrites the same line rather than stacking a second toast', async () => {
    bridge({ checkUpdates: async () => ({ status: 'current' }) });
    await checkForUpdatesInteractive();
    const settled = only();
    expect(settled.kind).toBe('success');
    expect(settled.progress).toBeUndefined();
    expect(settled.pinned).toBe(false); // an outcome can be dismissed
  });

  it('says nobody answered instead of claiming you are up to date', async () => {
    bridge({ checkUpdates: async () => ({ status: 'unreachable' }) });
    await checkForUpdatesInteractive();

    const toast = only();
    expect(toast.message).toBe('Could not reach the update server');
    expect(toast.kind).toBe('warn');
    // And it still leaves a way through: the release page is reachable by hand.
    expect(toast.action?.label).toBe('Download');
    toast.action?.run();
    expect(opened).toEqual(['https://github.com/esengine/estella/releases/latest']);
  });

  it('treats a check that threw, and a bridge that is not there, as unreachable', async () => {
    bridge({ checkUpdates: async () => { throw new Error('EAI_AGAIN'); } });
    await checkForUpdatesInteractive();
    expect(only().message).toBe('Could not reach the update server');

    for (const toast of toasts()) Toasts.dismiss(toast.id);
    bridge(undefined); // no preload at all — a browser tab, or a bridge that failed
    await checkForUpdatesInteractive();
    expect(only().message).toBe('Could not reach the update server');
  });

  it('hands an update to the notification instead of leaving the checking line up', async () => {
    bridge({
      checkUpdates: async () => ({
        status: 'update',
        update: { version: '9.9.9', url: 'https://example.test', selfInstall: false },
      }),
    });
    await checkForUpdatesInteractive();

    const toast = only(); // one line, not "checking" plus "available"
    expect(toast.message).toBe('Estella 9.9.9 is available');
    expect(toast.progress).toBeUndefined();
  });

  it('announces one release once, however many surfaces found it', async () => {
    // Startup checks ~5s after launch; a user who clicks the menu item in that
    // window used to get the same line twice.
    const release = { version: '9.9.9', url: 'https://example.test', selfInstall: false };
    notifyUpdate(release);
    notifyUpdate(release);
    expect(toasts()).toHaveLength(1);

    // A different version is different news, and a dismissed one may be re-raised.
    notifyUpdate({ ...release, version: '9.9.10' });
    expect(toasts()).toHaveLength(2);
    for (const toast of toasts()) Toasts.dismiss(toast.id);
    notifyUpdate(release);
    expect(toasts()).toHaveLength(1);
  });

  it('a second click joins the check in flight instead of starting another', async () => {
    let calls = 0;
    let answer: (v: unknown) => void = () => {};
    bridge({ checkUpdates: () => { calls++; return new Promise((r) => { answer = r; }); } });

    const first = checkForUpdatesInteractive();
    const second = checkForUpdatesInteractive();
    expect(calls).toBe(1);
    expect(toasts()).toHaveLength(1);

    answer({ status: 'current' });
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });
});

describe('the download', () => {
  /** A bridge whose download is driven by the test, byte report by byte report. */
  function downloadBridge() {
    let emit: ((p: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) | null = null;
    let finish: () => void = () => {};
    let fail: (e: Error) => void = () => {};
    let installed = false;
    bridge({
      onUpdateProgress: (cb) => { emit = cb; return () => { emit = null; }; },
      downloadUpdate: () => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }),
      installUpdate: async () => { installed = true; return true; },
    });
    return {
      report: (percent: number, total = 214_000_000) =>
        emit?.({ percent, transferred: (total * percent) / 100, total, bytesPerSecond: 5e6 }),
      finish: () => { finish(); return settle(); },
      fail: () => { fail(new Error('ECONNRESET')); return settle(); },
      installed: () => installed,
    };
  }

  const startDownload = async (): Promise<void> => {
    notifyUpdate({ version: '9.9.9', url: 'https://example.test', selfInstall: true });
    only().action?.run();
    await settle();
  };

  it('says it is starting rather than showing a 0% that has not moved', async () => {
    downloadBridge();
    await startDownload();

    const toast = only();
    expect(toast.message).toBe('Starting the Estella 9.9.9 download…');
    expect(toast.progress).toBe('indeterminate');
    expect(toast.pinned).toBe(true);
  });

  it('reports percentage and size once bytes are actually arriving', async () => {
    const dl = downloadBridge();
    await startDownload();

    dl.report(37.4);
    const toast = only();
    expect(toast.progress).toBe(37);
    expect(toast.message).toBe('Downloading Estella 9.9.9… 37% of 204.1 MB');
  });

  it('comes back if the user closes it, so Restart stays reachable', async () => {
    const dl = downloadBridge();
    await startDownload();
    dl.report(20);

    Toasts.dismiss(only().id); // the download keeps running with nothing on screen
    expect(toasts()).toHaveLength(0);

    dl.report(60);
    expect(only().progress).toBe(60);

    await dl.finish();
    const ready = only();
    expect(ready.message).toBe('Estella 9.9.9 is ready — restart to install');
    expect(ready.kind).toBe('success');
    expect(ready.progress).toBeUndefined();
    expect(ready.pinned).toBe(false);

    ready.action?.run();
    expect(dl.installed()).toBe(true);
  });

  it('falls back to the link when the download itself fails', async () => {
    const dl = downloadBridge();
    await startDownload();
    dl.report(12);
    await dl.fail();

    const toast = only();
    expect(toast.kind).toBe('error');
    expect(toast.progress).toBeUndefined();
    toast.action?.run();
    expect(opened).toEqual(['https://example.test']);
  });
});
