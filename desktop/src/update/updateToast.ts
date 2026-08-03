// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    updateToast.ts
 * @brief   What the editor shows for an update, from the click to the restart. One
 *          place, because two surfaces raise it — the startup check and Help ▸ Check
 *          for Updates — and an update that behaves differently depending on which
 *          one found it would be a bug nobody would think to look for.
 *
 *          Every phase has a visible state, because the check crosses a network and
 *          the download crosses it again: the click posts a toast immediately and
 *          that same toast is rewritten in place — checking → the outcome →
 *          downloading → restart. The one thing it must never do is answer a
 *          question it does not have the answer to: a source that never replied is
 *          reported as exactly that, not as "you are up to date".
 *
 *          A build that cannot install the update (see electron/autoUpdate.ts) keeps
 *          the older, honest behaviour of handing the user a link.
 */
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

interface AvailableUpdate {
  version: string;
  url: string;
  selfInstall: boolean;
}

type UpdateStatus =
  | { status: 'update'; update: AvailableUpdate }
  | { status: 'current' }
  | { status: 'unreachable' };

const RELEASES = 'https://github.com/esengine/estella/releases/latest';

const pct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Bytes as the size a human would quote — one decimal, MB up to a gigabyte. */
function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/** A check is one at a time: the second click should join the first, not race it. */
let checking: Promise<void> | null = null;

/**
 * Run a manual check and report all three outcomes. The toast exists BEFORE the
 * request does — the whole complaint was that clicking the menu item did nothing
 * for as long as the network took, which on a filtered one was forever.
 */
export function checkForUpdatesInteractive(): Promise<void> {
  if (checking) return checking;
  const id = Toasts.push(t('toast.updateChecking'), 'info', 0, undefined, {
    progress: 'indeterminate',
    pinned: true,
  });

  checking = (async () => {
    let result: UpdateStatus;
    try {
      result = (await window.estella?.app?.checkUpdates?.()) ?? { status: 'unreachable' };
    } catch (err) {
      console.error('[update] check failed', err);
      result = { status: 'unreachable' };
    }

    if (result.status === 'update') {
      Toasts.dismiss(id);
      notifyUpdate(result.update);
      return;
    }
    if (result.status === 'current') {
      Toasts.revise(id, {
        message: t('toast.upToDate'),
        kind: 'success',
        progress: undefined,
        pinned: false,
      });
      setTimeout(() => Toasts.dismiss(id), 3200);
      return;
    }
    // Nobody answered. Say so, and leave the door the user can walk through anyway.
    Toasts.revise(id, {
      message: t('toast.updateUnreachable'),
      kind: 'warn',
      progress: undefined,
      pinned: false,
      action: { label: t('ui.download'), run: () => window.open(RELEASES) },
    });
  })().finally(() => {
    checking = null;
  });

  return checking;
}

/**
 * The version a toast is already about, so the two surfaces that raise this — the
 * startup check and the menu — announce one release once. Clicking Check for
 * Updates a few seconds after launch used to answer with two identical lines.
 */
let announced: { version: string; id: number } | null = null;

/** Post the "there is a newer Estella" toast, wired to whatever this build can do. */
export function notifyUpdate(release: AvailableUpdate): void {
  if (announced?.version === release.version && Toasts.has(announced.id)) return;
  const openInBrowser = { label: t('ui.download'), run: () => window.open(release.url) };

  if (!release.selfInstall) {
    const linked = Toasts.push(
      t('toast.updateAvailable', { version: release.version }), 'info', 0, openInBrowser,
    );
    announced = { version: release.version, id: linked };
    return;
  }

  let id = 0;
  id = Toasts.push(t('toast.updateAvailable', { version: release.version }), 'info', 0, {
    label: t('ui.download'),
    run: () => void download(id, release),
  });
  announced = { version: release.version, id };
}

async function download(id: number, release: AvailableUpdate): Promise<void> {
  const bridge = window.estella?.app;
  if (!bridge?.downloadUpdate) return;

  // The download outlives its toast if the user closes it — and then there is no
  // way back to "Restart", so the line re-posts itself rather than disappearing.
  let live = id;
  const write = (patch: Parameters<typeof Toasts.revise>[1]): void => {
    if (!Toasts.has(live)) {
      live = Toasts.push(patch.message ?? '', patch.kind ?? 'info', 0, patch.action, {
        progress: patch.progress,
        pinned: patch.pinned,
      });
      // The line this release owns moved; keep the "announce once" guard pointing
      // at the toast that is actually on screen.
      if (announced?.version === release.version) announced.id = live;
      return;
    }
    Toasts.revise(live, patch);
  };

  // Until the first byte report there is nothing to be a percentage OF: connecting,
  // resolving, and (on a mirror) a redirect all land here, and "0%" reads as stuck.
  write({
    message: t('toast.updateConnecting', { version: release.version }),
    action: undefined,
    progress: 'indeterminate',
    pinned: true,
  });

  const stop = bridge.onUpdateProgress?.((p) => {
    const percent = pct(p.percent);
    const total = size(p.total);
    write({
      message: total
        ? t('toast.updateDownloadingOf', { version: release.version, percent, size: total })
        : t('toast.updateDownloading', { version: release.version, percent }),
      action: undefined,
      progress: percent,
      pinned: true,
    });
  });

  try {
    await bridge.downloadUpdate();
    write({
      message: t('toast.updateReady', { version: release.version }),
      kind: 'success',
      progress: undefined,
      pinned: false,
      action: { label: t('ui.restart'), run: () => void bridge.installUpdate?.() },
    });
  } catch (err) {
    console.error('[update] download failed', err);
    // The link still works when the download did not — a failed update should cost
    // the user a click, not the update.
    write({
      message: t('toast.updateFailed'),
      kind: 'error',
      progress: undefined,
      pinned: false,
      action: { label: t('ui.download'), run: () => window.open(release.url) },
    });
  } finally {
    stop?.();
  }
}
