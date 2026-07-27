// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    autoUpdate.ts
 * @brief   The editor installs its own update where it can, and links to a
 *          download where it cannot. electron-updater does the check, the download
 *          and the handover to the installer; updateCheck.ts remains the fallback.
 *          The two never both decide — `findUpdate` picks one and reports which.
 *
 *          Two builds cannot install an update. An unpackaged one has no
 *          app-update.yml to read. An UNSIGNED macOS bundle reads one, downloads
 *          the entire update, and only then does Squirrel.Mac refuse it for want of
 *          a signature — so the signature is settled up front, and a build that
 *          would fail at the end never starts.
 *
 *          The feed is the mirror before the origin, for the reason the update
 *          check and the runtime templates already ask a mirror first: the origin
 *          is slow where most of the users are. A mirror publishes the channel
 *          files under `latest/` beside the files they name (mirror-release.yml),
 *          so pointing at one is a base swap and nothing else.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { app } from 'electron';
import { checkForUpdate, updateFeeds, type LatestRelease } from './updateCheck';

/** Where a self-installing update sends anyone who would rather read about it first. */
const RELEASE_PAGE = 'https://github.com/esengine/estella/releases/latest';

export interface AvailableUpdate extends LatestRelease {
  /** The editor can download and install this one; `url` is then only a fallback. */
  selfInstall: boolean;
}

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

type Updater = (typeof import('electron-updater'))['autoUpdater'];

let updaterPromise: Promise<Updater> | null = null;

/**
 * The updater, loaded on first use.
 *
 * Lazily, like esbuild (see esbuildRuntime.ts): constructing it reads
 * app-update.yml and picks a platform implementation, which is work no build that
 * links to a download should pay for at startup.
 *
 * `default ?? namespace` because electron-updater is CommonJS and publishes
 * `autoUpdater` through `Object.defineProperty` — a getter that cjs-module-lexer
 * cannot see, so Node's ESM interop may expose it only under `default`.
 */
async function updater(): Promise<Updater> {
  if (!updaterPromise) {
    updaterPromise = import('electron-updater').then((mod) => {
      const autoUpdater = (mod.default ?? mod).autoUpdater;
      // A 200 MB download is the user's call, not a background surprise. Installing
      // on quit IS left on: someone who took the download and then never restarted
      // still gets the update, at the moment it costs them nothing.
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.logger = console;
      return autoUpdater;
    });
  }
  return updaterPromise;
}

let macSignature: boolean | null = null;

/**
 * Whether the running macOS bundle carries a signature Squirrel.Mac will accept.
 *
 * An ad-hoc signature passes `codesign`'s exit code but not Squirrel, which matches
 * the update's identity against the running app's — so it is rejected here too.
 */
function macBundleIsSigned(): boolean {
  if (macSignature === null) {
    try {
      // …/Estella Editor.app/Contents/MacOS/Estella Editor → the .app itself.
      const bundle = path.resolve(path.dirname(app.getPath('exe')), '..', '..');
      const probe = spawnSync('/usr/bin/codesign', ['-dv', bundle], { encoding: 'utf8' });
      macSignature = probe.status === 0 && !/Signature=adhoc/.test(probe.stderr ?? '');
    } catch {
      macSignature = false;
    }
  }
  return macSignature;
}

/** Whether this build can download and install an update in place. */
export function canSelfInstall(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === 'darwin') return macBundleIsSigned();
  return process.platform === 'win32';
}

/** Reached a feed and got an answer, or reached none at all. */
type CheckOutcome = { reached: true; update: AvailableUpdate | null } | { reached: false };

async function checkWithUpdater(): Promise<CheckOutcome> {
  const autoUpdater = await updater();
  for (const feed of updateFeeds()) {
    try {
      autoUpdater.setFeedURL(feed as Parameters<typeof autoUpdater.setFeedURL>[0]);
      const result = await autoUpdater.checkForUpdates();
      if (!result) continue;
      // The feed that answered stays selected, so the download comes from the
      // source that was fast enough to be asked.
      if (!result.isUpdateAvailable) return { reached: true, update: null };
      return {
        reached: true,
        update: { version: result.updateInfo.version, url: RELEASE_PAGE, selfInstall: true },
      };
    } catch (err) {
      console.warn('[update] feed unusable, trying the next', err);
    }
  }
  return { reached: false };
}

/**
 * The newest release if it is newer than this build, else null.
 *
 * Never throws: an update check must not be able to break editor startup.
 */
export async function findUpdate(currentVersion: string = app.getVersion()): Promise<AvailableUpdate | null> {
  if (canSelfInstall()) {
    // Catches what the per-feed handler cannot: loading the updater at all.
    const outcome = await checkWithUpdater().catch((err): CheckOutcome => {
      console.warn('[update] updater unavailable, falling back to the link', err);
      return { reached: false };
    });
    // Only a feed that ANSWERED settles the question. "No feed could be reached" is
    // not "no update", so it falls through to the check that speaks GitHub's API.
    if (outcome.reached) return outcome.update;
  }
  const release = await checkForUpdate(currentVersion);
  return release ? { ...release, selfInstall: false } : null;
}

let downloaded = false;

/** Download the update found by the last `findUpdate`, reporting progress. */
export async function downloadUpdate(onProgress: (p: DownloadProgress) => void): Promise<void> {
  const autoUpdater = await updater();
  const relay = (p: DownloadProgress) => onProgress(p);
  autoUpdater.on('download-progress', relay);
  try {
    await autoUpdater.downloadUpdate();
    downloaded = true;
  } finally {
    autoUpdater.removeListener('download-progress', relay);
  }
}

/** Quit and hand the app to the installer. No-op until a download has finished. */
export async function installUpdate(): Promise<boolean> {
  if (!downloaded) return false;
  const autoUpdater = await updater();
  autoUpdater.quitAndInstall();
  return true;
}
