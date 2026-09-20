// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A web package carries the entry the page names and no other host's.
 *
 * `sdk/dist` holds every target's build side by side, and its eleven entries
 * share one code-split graph, so `shared/` is their union. The staging step is
 * the only thing standing between a browser package and the Node, WeChat,
 * mini-game and native SDKs — entries by the import map, chunks by the manifest
 * the bundler writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { shipsToBrowser } from '../src/export/exportGame';
import { IMPORT_MAP } from '../src/bundle/importMap';

/** The shape of a real dist, small enough to read: entries, chunks, a manifest. */
const ENTRIES = Object.values(IMPORT_MAP.imports).map((t) => t.replace('./sdk/', ''));
const OTHER_HOSTS = [
  'index.node.js', 'index.wechat.js', 'index.wechat.cjs.js', 'index.wechat.lean.js',
  'index.minigame.js', 'index.native.js', 'index.native.bundled.js', 'index.bundled.js',
];
const WEB_CHUNK = 'shared/webAppFactory.js';
const MINIGAME_CHUNK = 'shared/wechatRuntime.js';

let DIST: string;
const at = (rel: string) => path.join(DIST, rel);

beforeAll(() => {
  DIST = mkdtempSync(path.join(tmpdir(), 'ships-'));
  const write = (rel: string) => {
    mkdirSync(path.dirname(at(rel)), { recursive: true });
    writeFileSync(at(rel), '');
  };
  for (const f of [...ENTRIES, ...OTHER_HOSTS, WEB_CHUNK, MINIGAME_CHUNK]) write(f);
  for (const f of ['index.d.ts', 'index.js.map', 'index.wechat.js.map']) write(f);
  const manifest: Record<string, string[]> = { 'index.wechat.js': [MINIGAME_CHUNK] };
  for (const e of ENTRIES) manifest[e] = [WEB_CHUNK];
  writeFileSync(at('chunks.json'), JSON.stringify(manifest));
});

afterAll(() => rmSync(DIST, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('what a web export stages from sdk/dist', () => {
  it('keeps exactly the entries the import map names', () => {
    const keeps = shipsToBrowser(false, DIST);
    for (const f of ENTRIES) expect(keeps(at(f)), f).toBe(true);
  });

  it.each(OTHER_HOSTS)('drops %s — a browser page can never load it', (f) => {
    expect(shipsToBrowser(false, DIST)(at(f))).toBe(false);
  });

  it('keeps a chunk a web entry reaches and drops one only a mini-game entry does', () => {
    const keeps = shipsToBrowser(false, DIST);
    expect(keeps(at(WEB_CHUNK))).toBe(true);
    expect(keeps(at(MINIGAME_CHUNK))).toBe(false);
  });

  it('keeps a directory something wanted lives in, so the copy is not pruned', () => {
    const keeps = shipsToBrowser(false, DIST);
    expect(keeps(at('shared'))).toBe(true);
    expect(keeps(at('spine'))).toBe(true);
  });

  it('drops declarations, the manifest itself, and — without source maps — the maps', () => {
    const keeps = shipsToBrowser(false, DIST);
    expect(keeps(at('index.d.ts'))).toBe(false);
    expect(keeps(at('chunks.json'))).toBe(false);
    expect(keeps(at('index.js.map'))).toBe(false);
    expect(shipsToBrowser(true, DIST)(at('index.js.map'))).toBe(true);
    expect(shipsToBrowser(true, DIST)(at('index.wechat.js.map'))).toBe(false);
  });

  it('refuses a dist with no manifest rather than falling back to shipping it all', () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'bare-'));
    expect(() => shipsToBrowser(false, bare)).toThrow(/chunks\.json/);
    rmSync(bare, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
});
