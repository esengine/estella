// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { cspConnectSource, cspConnectSources } from '../src/export/cspConnect';

describe('web connect origins', () => {
  it('accepts origins and bare schemes, normalised', () => {
    expect(cspConnectSource('wss://play.example.com')).toBe('wss://play.example.com');
    expect(cspConnectSource('  wss://Play.Example.com:8443/ ')).toBe('wss://play.example.com:8443');
    expect(cspConnectSource('ws://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787');
    expect(cspConnectSource('https://api.example.com')).toBe('https://api.example.com');
    expect(cspConnectSource('wss:')).toBe('wss:');
    expect(cspConnectSource('ws://127.0.0.1:*')).toBe('ws://127.0.0.1:*');
  });

  it('refuses anything that is not only an origin, so no entry can end the directive and start another', () => {
    for (const bad of [
      'play.example.com', 'ftp://example.com', 'wss://', 'wss://user:pw@example.com', 'wss://example.com/play',
      'wss://example.com?x=1', 'wss://example.com#a', 'wss://*.example.com', "wss://example.com; script-src 'unsafe-inline'",
      'wss://example.com wss://other.com', 'wss://example.com:8443:*', 'wss://*.example.com:*', 'wss://*', "wss://exa'mple.com", '',
    ]) expect(() => cspConnectSource(bad), JSON.stringify(bad)).toThrow(/web\.connect/);
  });

  it('keeps order, drops duplicates, and treats no list as nothing', () => {
    expect(cspConnectSources(['wss://a.example', 'ws://b.example:1', 'wss://a.example'])).toEqual(['wss://a.example', 'ws://b.example:1']);
    expect(cspConnectSources(undefined)).toEqual([]);
    expect(() => cspConnectSources(['wss://a.example', 'nope'])).toThrow(/nope/);
  });
});

describe('web connect in a project', () => {
  const manifest = (connect: unknown) => ({ formatVersion: '1', name: 'g', packaging: { platforms: { web: { connect } } } });

  it('is read from the project, normalised, and reaches the export options', async () => {
    const { parseManifest } = await import('../src/project/format');
    const { projectExportOptions } = await import('../src/export/projectExportOptions');
    const parsed = parseManifest(manifest(['wss://Play.Example.com/', 'ws://127.0.0.1:*', 'wss://play.example.com']));
    expect(parsed.packaging?.platforms?.web?.connect).toEqual(['wss://play.example.com', 'ws://127.0.0.1:*']);
    const web = await projectExportOptions('/tmp/game', parsed, 'web');
    expect(web.webConnect).toEqual(['wss://play.example.com', 'ws://127.0.0.1:*']);
    // Another target has no page, so no policy to list them in.
    expect((await projectExportOptions('/tmp/game', parsed, 'wechat')).webConnect).toBeUndefined();
  });

  it('refuses a list that is not one, or an entry that is not an origin, when the project is read', async () => {
    const { parseManifest } = await import('../src/project/format');
    expect(() => parseManifest(manifest('wss://play.example.com'))).toThrow(/list of origins/);
    expect(() => parseManifest(manifest([42]))).toThrow(/list of origins/);
    expect(() => parseManifest(manifest(['wss://play.example.com/path']))).toThrow(/web\.connect/);
  });

  it('an empty list says nothing', async () => {
    const { parseManifest } = await import('../src/project/format');
    expect(parseManifest(manifest([])).packaging?.platforms?.web).toBeUndefined();
  });
});
