// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    autoUpdate.ts
 * @brief   The editor installs its own update where it can, and links to a
 *          download where it cannot. electron-updater does the check, the download
 *          and the handover to the installer; updateCheck.ts remains the fallback.
 *          The two never both decide — `findUpdate` picks one and reports which.
 *
 *          Three builds cannot install an update, and two of them only find out at
 *          the very end. An unpackaged one has no app-update.yml to read. An
 *          UNSIGNED macOS bundle reads one, downloads the entire update, and only
 *          then does Squirrel.Mac refuse it for want of a signature. A Windows
 *          install whose app-update.yml names a publisher its own executable cannot
 *          satisfy is refused the same way, by electron-updater, after the same
 *          full download. So the signature is settled up front on both, and a build
 *          that would fail at the end never starts.
 *
 *          The feed is the mirror before the origin, for the reason the update
 *          check and the runtime templates already ask a mirror first: the origin
 *          is slow where most of the users are. A mirror publishes the channel
 *          files under `latest/` beside the files they name (mirror-release.yml),
 *          so pointing at one is a base swap and nothing else.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { app } from 'electron';
import { describeUpdate, updateFeeds, PROBE_TIMEOUT_MS, type LatestRelease } from './updateCheck';
import { publisherNameIn, signatureSatisfies, type AuthenticodeProbe } from './updateSignature';

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

let winVerifiable: boolean | null = null;

/** `Get-AuthenticodeSignature` on a file, or null when Windows could not be asked. */
function probeAuthenticode(file: string): AuthenticodeProbe | null {
  try {
    const ps = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}' | ConvertTo-Json -Compress -Depth 3`],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true },
    );
    // Strip a leading BOM: a console whose code page PowerShell switches emits one,
    // and JSON.parse rejects it — which would read as "could not ask Windows" and
    // quietly promise a self-install that the updater then refuses.
    const out = ps.stdout?.replace(/^﻿/, '');
    return ps.status === 0 && out ? (JSON.parse(out) as AuthenticodeProbe) : null;
  } catch {
    return null;
  }
}

/**
 * Whether an update could clear electron-updater's Windows signature check here.
 *
 * The running executable came off the same signing pipeline the update will, so
 * Windows's verdict on it is the verdict the update will get — and asking now is
 * the difference between a link and a download that is refused at 100%. Cached:
 * neither the pin nor the executable changes while the editor runs.
 */
function winUpdateCanVerify(): boolean {
  if (winVerifiable === null) {
    let publisher: string | null = null;
    try {
      publisher = publisherNameIn(readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'));
    } catch {
      publisher = null; // no app-update.yml ⇒ the updater verifies nothing
    }
    winVerifiable = publisher === null || signatureSatisfies(publisher, probeAuthenticode(process.execPath));
    if (!winVerifiable) {
      console.warn(
        `[update] this install pins publisher "${publisher}", which Windows will not vouch for on its own ` +
        `executable — in-place updates cannot be verified here, so the editor links to the download instead. ` +
        `Reinstalling from the release page clears it.`,
      );
    }
  }
  return winVerifiable;
}

/** Whether this build can download and install an update in place. */
export function canSelfInstall(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === 'darwin') return macBundleIsSigned();
  return process.platform === 'win32' && winUpdateCanVerify();
}

/** Reached a feed and got an answer, or reached none at all. */
type CheckOutcome = { reached: true; update: AvailableUpdate | null } | { reached: false };

/**
 * Give a promise a deadline it cannot outlive.
 *
 * electron-updater exposes no request timeout, and its http executor inherits the
 * same hazard the plain fetches had: a source that accepts the connection and then
 * says nothing keeps the check pending for as long as the editor runs. Losing the
 * race only abandons the ANSWER — the request finishes into nothing — which is the
 * right trade for a check whose worst honest outcome is "ask again later".
 */
async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkWithUpdater(): Promise<CheckOutcome> {
  const autoUpdater = await updater();
  for (const feed of updateFeeds()) {
    try {
      autoUpdater.setFeedURL(feed as Parameters<typeof autoUpdater.setFeedURL>[0]);
      const result = await withDeadline(
        autoUpdater.checkForUpdates(),
        PROBE_TIMEOUT_MS,
        String(feed.url ?? feed.provider),
      );
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

/** What a check found, in the shape the renderer has to tell the user about. */
export type UpdateStatus =
  | { status: 'update'; update: AvailableUpdate }
  | { status: 'current' }
  | { status: 'unreachable' };

/**
 * What the newest published release means for this build.
 *
 * Never throws: an update check must not be able to break editor startup. It can,
 * however, come back saying nobody answered — which is a different thing from "you
 * are up to date" and must not be reported as one.
 */
export async function findUpdate(currentVersion: string = app.getVersion()): Promise<UpdateStatus> {
  if (canSelfInstall()) {
    // Catches what the per-feed handler cannot: loading the updater at all.
    const outcome = await checkWithUpdater().catch((err): CheckOutcome => {
      console.warn('[update] updater unavailable, falling back to the link', err);
      return { reached: false };
    });
    // Only a feed that ANSWERED settles the question. "No feed could be reached" is
    // not "no update", so it falls through to the check that speaks GitHub's API.
    if (outcome.reached) {
      return outcome.update ? { status: 'update', update: outcome.update } : { status: 'current' };
    }
  }
  const outcome = await describeUpdate(currentVersion);
  return outcome.status === 'update'
    ? { status: 'update', update: { ...outcome.release, selfInstall: false } }
    : outcome;
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
