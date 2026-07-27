// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { parseVersion, isNewerVersion, checkForUpdate, downloadKeyFor, updateFeeds } from '../electron/updateCheck';
import { DEFAULT_RELEASE_MIRROR } from '../../build-tools/utils/nativeTemplate.js';

describe('parseVersion', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseVersion('0.17.0')).toEqual({ parts: [0, 17, 0], pre: null });
    expect(parseVersion('v1.2.3')).toEqual({ parts: [1, 2, 3], pre: null });
    expect(parseVersion('v1.0.0-rc.1')).toEqual({ parts: [1, 0, 0], pre: 'rc.1' });
  });

  it('rejects non-versions', () => {
    expect(parseVersion('docs-v0.17.0')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('compares major/minor/patch', () => {
    expect(isNewerVersion('0.18.0', '0.17.0')).toBe(true);
    expect(isNewerVersion('0.17.1', '0.17.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.17.0', '0.17.0')).toBe(false);
    expect(isNewerVersion('0.16.9', '0.17.0')).toBe(false);
  });

  it('ranks a release above its own prereleases', () => {
    expect(isNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(true);
    expect(isNewerVersion('1.0.0-rc.1', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0-rc.2', '1.0.0-rc.1')).toBe(true);
  });

  it('never reports malformed input as newer', () => {
    expect(isNewerVersion('garbage', '0.17.0')).toBe(false);
    expect(isNewerVersion('0.18.0', 'garbage')).toBe(false);
  });
});

const fetchReturning = (status: number, body: unknown): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

describe('checkForUpdate', () => {
  it('returns the release when newer', async () => {
    const f = fetchReturning(200, { tag_name: 'v0.18.0', html_url: 'https://example.com/r/v0.18.0' });
    expect(await checkForUpdate('0.17.0', f)).toEqual({ version: '0.18.0', url: 'https://example.com/r/v0.18.0' });
  });

  it('returns null when up to date or older', async () => {
    const f = fetchReturning(200, { tag_name: 'v0.17.0', html_url: 'https://example.com' });
    expect(await checkForUpdate('0.17.0', f)).toBeNull();
    expect(await checkForUpdate('0.18.0', f)).toBeNull();
  });

  it('resolves null on API failure, network error, and malformed payloads', async () => {
    expect(await checkForUpdate('0.17.0', fetchReturning(403, {}))).toBeNull();
    expect(await checkForUpdate('0.17.0', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
    expect(await checkForUpdate('0.17.0', fetchReturning(200, { tag_name: 'latest' }))).toBeNull();
    expect(await checkForUpdate('0.17.0', fetchReturning(200, {}))).toBeNull();
  });

  it('ignores drafts', async () => {
    const f = fetchReturning(200, { tag_name: 'v9.9.9', html_url: 'https://example.com', draft: true });
    expect(await checkForUpdate('0.17.0', f)).toBeNull();
  });
});

// — The mirror path —————————————————————————————————————————————————————————————
//
// The notification's button says "Download", so where it lands is the whole point.
// It used to land on `<mirror>/v<version>/`, composed here rather than published by
// the mirror — a bucket directory, which 404s on any static host because object
// storage has no directory index. Every update notification led to an error page.

const MIRROR = 'https://m.test';
const env = { ESTELLA_RELEASE_MIRROR: MIRROR } as NodeJS.ProcessEnv;

/** Routes by URL, so one stub can answer both the mirror and the GitHub origin. */
const fetchRouting = (routes: Record<string, unknown>): typeof fetch =>
  (async (url: string) => {
    const hit = Object.entries(routes).find(([prefix]) => String(url).startsWith(prefix));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => hit[1] };
  }) as unknown as typeof fetch;

const LATEST = {
  version: '0.35.0',
  url: 'https://estellaengine.com/#download',
  downloads: {
    win: { url: 'https://m.test/latest/Estella-Editor-Setup.exe', name: 'Estella-Editor-Setup-0.35.0.exe', size: 1 },
    'mac-arm64': { url: 'https://m.test/latest/Estella-Editor-arm64.dmg', name: 'Estella-Editor-0.35.0-arm64.dmg', size: 1 },
  },
};

describe('downloadKeyFor', () => {
  it('maps a build to the key the mirror publishes it under', () => {
    expect(downloadKeyFor('win32', 'x64')).toBe('win');
    expect(downloadKeyFor('darwin', 'arm64')).toBe('mac-arm64');
    expect(downloadKeyFor('darwin', 'x64')).toBe('mac-x64');
    expect(downloadKeyFor('linux', 'x64')).toBe('linux');
    expect(downloadKeyFor('freebsd', 'x64')).toBeNull();
  });
});

describe('checkForUpdate — mirror', () => {
  const f = fetchRouting({ [MIRROR]: LATEST });

  it('downloads THIS machine`s installer, not a page listing every platform', async () => {
    expect(await checkForUpdate('0.34.1', f, env, 'win32', 'x64')).toEqual({
      version: '0.35.0',
      url: 'https://m.test/latest/Estella-Editor-Setup.exe',
    });
    expect((await checkForUpdate('0.34.1', f, env, 'darwin', 'arm64'))?.url)
      .toBe('https://m.test/latest/Estella-Editor-arm64.dmg');
  });

  it('falls back to the published page when this platform has no installer', async () => {
    // An Intel Mac, or Linux: the mirror ships neither, and a page a human can
    // choose from is the honest answer — not a guess at a filename.
    expect((await checkForUpdate('0.34.1', f, env, 'darwin', 'x64'))?.url)
      .toBe('https://estellaengine.com/#download');
    expect((await checkForUpdate('0.34.1', f, env, 'linux', 'x64'))?.url)
      .toBe('https://estellaengine.com/#download');
  });

  it('never composes a url the mirror did not publish', async () => {
    // The regression. A mirror naming neither an installer nor a page is "no
    // answer" — the origin's release page is real, and a fabricated directory
    // url is one nobody has ever loaded.
    const bare = fetchRouting({
      [MIRROR]: { version: '0.35.0' },
      'https://api.github.com': { tag_name: 'v0.35.0', html_url: 'https://github.com/x/releases/v0.35.0' },
    });
    const found = await checkForUpdate('0.34.1', bare, env, 'win32', 'x64');
    expect(found?.url).toBe('https://github.com/x/releases/v0.35.0');
    expect(found?.url).not.toMatch(/\/v0\.35\.0\/$/);
  });

  it('still reports nothing when the mirror is not newer', async () => {
    expect(await checkForUpdate('0.35.0', f, env, 'win32', 'x64')).toBeNull();
  });

  it('lets the origin answer when the mirror is unreachable', async () => {
    const originOnly = fetchRouting({
      'https://api.github.com': { tag_name: 'v0.35.0', html_url: 'https://github.com/x/releases/v0.35.0' },
    });
    expect((await checkForUpdate('0.34.1', originOnly, env, 'win32', 'x64'))?.url)
      .toBe('https://github.com/x/releases/v0.35.0');
  });
});

// — The updater's feed ——————————————————————————————————————————————————————————
//
// electron-updater downloads from whichever feed answered the check, so the order
// here IS the download speed. `latest/` is where mirror-release.yml puts the channel
// files, beside the files they name.

describe('updateFeeds', () => {
  it('asks the mirror before the origin', () => {
    expect(updateFeeds({})).toEqual([
      { provider: 'generic', url: `${DEFAULT_RELEASE_MIRROR}/latest`, useMultipleRangeRequest: false },
      { provider: 'github', owner: 'esengine', repo: 'estella' },
    ]);
  });

  it('follows the mirror override, in the order it is given', () => {
    const feeds = updateFeeds({ ESTELLA_RELEASE_MIRROR: 'https://a.test, https://b.test/' });
    expect(feeds.map((f) => f.url)).toEqual([
      'https://a.test/latest',
      'https://b.test/latest',
      undefined, // GitHub is named by owner/repo, not a url
    ]);
  });

  it('leaves the origin alone when the mirror is turned off', () => {
    expect(updateFeeds({ ESTELLA_RELEASE_MIRROR: '' }))
      .toEqual([{ provider: 'github', owner: 'esengine', repo: 'estella' }]);
  });

  it('never asks a mirror for several byte ranges at once', () => {
    // Object storage behind a CDN answers a multi-range request with the whole
    // file, and electron-updater fails the block map instead of falling back — so
    // differential download is off wherever the response is a CDN's to shape.
    for (const feed of updateFeeds({ ESTELLA_RELEASE_MIRROR: 'https://a.test' })) {
      if (feed.provider === 'generic') expect(feed.useMultipleRangeRequest).toBe(false);
    }
  });
});
