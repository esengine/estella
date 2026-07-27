// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    updateToast.ts
 * @brief   What the editor shows when a newer release exists. One place, because
 *          two surfaces raise it — the startup check and Help ▸ Check for Updates —
 *          and an update that behaves differently depending on which one found it
 *          would be a bug nobody would think to look for.
 *
 *          A build that can install the update downloads it here, in the toast:
 *          progress rewrites the same line, and the button becomes Restart. A build
 *          that cannot (see electron/autoUpdate.ts) keeps the older, honest
 *          behaviour of handing the user a link.
 */
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

interface AvailableUpdate {
  version: string;
  url: string;
  selfInstall: boolean;
}

const pct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Post the "there is a newer Estella" toast, wired to whatever this build can do. */
export function notifyUpdate(release: AvailableUpdate): void {
  const openInBrowser = { label: t('ui.download'), run: () => window.open(release.url) };

  if (!release.selfInstall) {
    Toasts.push(t('toast.updateAvailable', { version: release.version }), 'info', 0, openInBrowser);
    return;
  }

  let id = 0;
  id = Toasts.push(t('toast.updateAvailable', { version: release.version }), 'info', 0, {
    label: t('ui.download'),
    run: () => void download(id, release),
  });
}

async function download(id: number, release: AvailableUpdate): Promise<void> {
  const bridge = window.estella?.app;
  if (!bridge?.downloadUpdate) return;

  const show = (percent: number) =>
    Toasts.revise(id, {
      message: t('toast.updateDownloading', { version: release.version, percent }),
      action: undefined,
    });
  show(0);
  const stop = bridge.onUpdateProgress?.((p) => show(pct(p.percent)));

  try {
    await bridge.downloadUpdate();
    Toasts.revise(id, {
      message: t('toast.updateReady', { version: release.version }),
      kind: 'success',
      action: { label: t('ui.restart'), run: () => void bridge.installUpdate?.() },
    });
  } catch (err) {
    console.error('[update] download failed', err);
    // The link still works when the download did not — a failed update should cost
    // the user a click, not the update.
    Toasts.revise(id, {
      message: t('toast.updateFailed'),
      kind: 'error',
      action: { label: t('ui.download'), run: () => window.open(release.url) },
    });
  } finally {
    stop?.();
  }
}
