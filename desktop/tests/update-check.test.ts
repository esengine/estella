// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { parseVersion, isNewerVersion, checkForUpdate } from '../electron/updateCheck';

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
