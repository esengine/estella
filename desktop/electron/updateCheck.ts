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
 * without the origin's API: the version, and where its download page or installer
 * is. Written by the release workflow's mirror step beside the version folders.
 */
interface MirrorLatest {
  version?: string;
  url?: string;
}

export interface LatestRelease {
  /** Normalized version, no leading `v` (e.g. "0.18.0"). */
  version: string;
  /** Release page URL for the download button. */
  url: string;
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
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LatestRelease | null> {
  for (const mirror of releaseMirrors(env)) {
    const found = await checkMirror(mirror, currentVersion, fetchImpl);
    if (found) return found;
  }
  return checkOrigin(currentVersion, fetchImpl);
}

/** A mirror's `latest.json`. Anything unreadable is "no answer", not an error. */
async function checkMirror(
  mirror: string,
  currentVersion: string,
  fetchImpl: typeof fetch,
): Promise<LatestRelease | null> {
  try {
    const res = await fetchImpl(`${mirror}/latest.json`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as MirrorLatest;
    if (!body.version) return null;
    const parsed = parseVersion(body.version);
    if (!parsed || !isNewerVersion(body.version, currentVersion)) return null;
    const version = parsed.parts.join('.') + (parsed.pre ? `-${parsed.pre}` : '');
    // The mirror's own copy of that version's assets, so the download is as fast as
    // the check was. A mirror that names no url still gets the user to the release.
    return { version, url: body.url ?? `${mirror}/v${version}/` };
  } catch {
    return null;
  }
}

async function checkOrigin(
  currentVersion: string,
  fetchImpl: typeof fetch,
): Promise<LatestRelease | null> {
  try {
    const res = await fetchImpl(RELEASES_LATEST, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'estella-editor' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean };
    if (!body.tag_name || !body.html_url || body.draft) return null;
    const parsed = parseVersion(body.tag_name);
    if (!parsed || !isNewerVersion(body.tag_name, currentVersion)) return null;
    return { version: parsed.parts.join('.') + (parsed.pre ? `-${parsed.pre}` : ''), url: body.html_url };
  } catch {
    return null;
  }
}
