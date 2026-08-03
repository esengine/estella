// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    updateCheck.ts
 * @brief   Release update check against GitHub Releases. Unsigned builds rule
 *          out silent auto-update (Squirrel.Mac requires a valid signature),
 *          so the honest architecture is notify + one-click download: compare
 *          the running version to the latest published release and hand the
 *          renderer a link. Pure logic — `fetch` is injected so tests need no
 *          network and main needs no mock.
 *
 *          Asked of the mirror first, when one is configured: the same copy the
 *          runtime templates come from, so an editor that downloads fast updates
 *          fast. The origin answers when there is no mirror, or when its answer is
 *          missing, malformed or older than what GitHub publishes.
 */

import { releaseMirrors } from '../../build-tools/utils/nativeTemplate.js';

const RELEASES_LATEST = 'https://api.github.com/repos/esengine/estella/releases/latest';

/**
 * What a mirror publishes at its root so an editor can ask "what is current?"
 * without the origin's API. Written by the release workflow's mirror step beside
 * the version folders.
 */
interface MirrorLatest {
  version?: string;
  /** Generic landing place — a page a human can download from. */
  url?: string;
  /** Per-platform installers at stable, version-less aliases. Keyed as below. */
  downloads?: Record<string, { url?: string; name?: string; size?: number }>;
}

/**
 * The `downloads` key for a build, or null where no installer is published for it.
 *
 * The notification's button says "Download", so it should land on the installer for
 * the machine reading it rather than on a page listing every platform — and the
 * mirror already publishes exactly that, at an alias that survives releases.
 */
export function downloadKeyFor(platform: string, arch: string): string | null {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux';
  return null;
}

export interface LatestRelease {
  /** Normalized version, no leading `v` (e.g. "0.18.0"). */
  version: string;
  /** Release page URL for the download button. */
  url: string;
}

/**
 * What the check found — three answers, not two.
 *
 * "No update" and "nobody answered" used to be the same `null`, and the editor
 * reported both as "you are up to date": a machine that cannot reach either source
 * was told, in green, that it had the newest build. `unreachable` is the difference,
 * and it is the only outcome that should offer the download page instead.
 */
export type UpdateOutcome =
  | { status: 'update'; release: LatestRelease }
  | { status: 'current' }
  | { status: 'unreachable' };

/**
 * How long one source gets to answer.
 *
 * There was no limit at all, and `catch` only catches a connection that FAILS.
 * A blackholed one — dropped rather than refused, which is what a filtered network
 * usually does — leaves `fetch` pending forever, and with it the menu command that
 * is waiting on it. That is not a slow check; it is a check that never ends, and no
 * amount of spinner makes it finish. Per source, so a dead first mirror costs this
 * much and not the whole budget.
 */
export const PROBE_TIMEOUT_MS = 6000;

export interface ProbeOptions {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  platform?: string;
  arch?: string;
  /** Per-source deadline; tests shorten it. */
  timeoutMs?: number;
}

/**
 * The same question this file answers, in electron-updater's vocabulary: which
 * sources to ask, fastest-first. Mirrors publish the channel files under `latest/`
 * beside the files they name (mirror-release.yml), so a feed is a base and nothing
 * more — see autoUpdate.ts for who consumes these.
 *
 * Differential download is off for mirrors: it asks for several byte ranges in one
 * request, which object storage behind a CDN answers with the whole file, and
 * electron-updater fails the block map rather than falling back.
 */
export function updateFeeds(env: NodeJS.ProcessEnv = process.env): Array<Record<string, unknown>> {
  return [
    ...releaseMirrors(env).map((base) => ({
      provider: 'generic',
      url: `${base}/latest`,
      useMultipleRangeRequest: false,
    })),
    { provider: 'github', owner: 'esengine', repo: 'estella' },
  ];
}

/** Parse "v1.2.3" / "1.2.3" / "v1.2.3-rc.1" → parts + prerelease flag. Null if not a version. */
export function parseVersion(tag: string): { parts: [number, number, number]; pre: string | null } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag.trim());
  if (!m) return null;
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/** SemVer precedence: is `candidate` strictly newer than `current`? Prerelease < its release. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  }
  if (a.pre === b.pre) return false;
  if (a.pre === null) return true; // release > any prerelease of the same triplet
  if (b.pre === null) return false;
  return a.pre > b.pre; // lexicographic is enough for rc.1 < rc.2 style tags
}

/**
 * Latest published release if it is newer than `currentVersion`, else null.
 * Never throws: offline / rate-limited / malformed all resolve to null — an
 * update check must not be able to break editor startup.
 *
 * Keeps the two-valued answer for callers that only want the release; anything
 * that has to TELL the user what happened wants {@link describeUpdate} instead.
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  arch: string = process.arch,
): Promise<LatestRelease | null> {
  const outcome = await describeUpdate(currentVersion, { fetch: fetchImpl, env, platform, arch });
  return outcome.status === 'update' ? outcome.release : null;
}

/**
 * Ask every source in order and say which of the three things happened.
 *
 * A mirror that is merely CURRENT does not end the search — it may be lagging the
 * origin, which is the whole reason the origin is asked second (see the file
 * header). But it does mean something answered, so a later source going dark
 * downgrades the answer to "current" rather than "nobody answered".
 */
export async function describeUpdate(
  currentVersion: string,
  opts: ProbeOptions = {},
): Promise<UpdateOutcome> {
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;

  let answered = false;
  for (const mirror of releaseMirrors(opts.env ?? process.env)) {
    const found = await checkMirror(mirror, currentVersion, fetchImpl, platform, arch, timeoutMs);
    if (found.status === 'update') return found;
    if (found.status === 'current') answered = true;
  }
  const origin = await checkOrigin(currentVersion, fetchImpl, timeoutMs);
  if (origin.status === 'unreachable' && answered) return { status: 'current' };
  return origin;
}

/**
 * A source's deadline, as an init a caller cannot forget to pass on.
 *
 * `AbortSignal.timeout` aborts the body read too, not just the connect — a source
 * that answers a header and then stalls is the same hang with extra steps.
 */
function deadline(ms: number): Pick<RequestInit, 'signal'> {
  return { signal: AbortSignal.timeout(ms) };
}

/** A mirror's `latest.json`. Anything unreadable is "no answer", not an error. */
async function checkMirror(
  mirror: string,
  currentVersion: string,
  fetchImpl: typeof fetch,
  platform: string,
  arch: string,
  timeoutMs: number,
): Promise<UpdateOutcome> {
  try {
    const res = await fetchImpl(`${mirror}/latest.json`, {
      headers: { accept: 'application/json' },
      ...deadline(timeoutMs),
    });
    if (!res.ok) return { status: 'unreachable' };
    const body = (await res.json()) as MirrorLatest;
    if (!body.version) return { status: 'unreachable' };
    const parsed = parseVersion(body.version);
    // It answered, and what it published is not newer: current, not silence.
    if (!parsed) return { status: 'unreachable' };
    if (!isNewerVersion(body.version, currentVersion)) return { status: 'current' };
    const version = parsed.parts.join('.') + (parsed.pre ? `-${parsed.pre}` : '');

    // This machine's installer if the mirror publishes one, else whatever page it
    // named. NOTHING is composed from the version here: a bare `<mirror>/v<x>/` was
    // composed once as a "sensible" fallback, and it 404s on every static host —
    // object storage has no directory index. A url we did not get from the mirror
    // is a url nobody has ever loaded, so when the mirror names none, this reports
    // no answer and the origin (whose release page is real) gets asked instead.
    const key = downloadKeyFor(platform, arch);
    const url = (key ? body.downloads?.[key]?.url : undefined) ?? body.url;
    return url ? { status: 'update', release: { version, url } } : { status: 'unreachable' };
  } catch {
    return { status: 'unreachable' };
  }
}

async function checkOrigin(
  currentVersion: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<UpdateOutcome> {
  try {
    const res = await fetchImpl(RELEASES_LATEST, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'estella-editor' },
      ...deadline(timeoutMs),
    });
    if (!res.ok) return { status: 'unreachable' };
    const body = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean };
    // A draft is the origin answering — there is simply nothing published past this
    // build yet, which is "current" and not "the network ate it".
    if (!body.tag_name || !body.html_url) return { status: 'unreachable' };
    if (body.draft) return { status: 'current' };
    const parsed = parseVersion(body.tag_name);
    if (!parsed) return { status: 'unreachable' };
    if (!isNewerVersion(body.tag_name, currentVersion)) return { status: 'current' };
    return {
      status: 'update',
      release: {
        version: parsed.parts.join('.') + (parsed.pre ? `-${parsed.pre}` : ''),
        url: body.html_url,
      },
    };
  } catch {
    return { status: 'unreachable' };
  }
}
