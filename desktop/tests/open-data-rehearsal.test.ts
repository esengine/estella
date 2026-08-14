// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The open data context, built for the play realm and rehearsed in it.
 *
 * The point of both halves is that what the editor plays is the file that
 * SHIPS: bundled by the same rules the exporter uses (no engine in there), and
 * run against a host shaped like the one on a device.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildOpenDataContext } from '../../pipeline/src/bundle/buildOpenData';
import { rehearseOpenData } from '@/engine/openDataRehearsal';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-opendata-'));
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function context(source: string): void {
  mkdirSync(path.join(root, 'open-data'), { recursive: true });
  writeFileSync(path.join(root, 'open-data', 'index.ts'), source);
}

describe('buildOpenDataContext', () => {
  it('has nothing to build, and says so, when the project declares no context', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'estella-nocontext-'));
    const res = await buildOpenDataContext(empty);
    expect(res.ok).toBe(true);
    expect(res.outputPath).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });

  it('bundles the context and its own modules into one script', async () => {
    writeFileSync(path.join(root, 'draw.ts'), 'export const mark = () => { (globalThis as never as Record<string, unknown>).__DREW__ = 1; };\n');
    context("import { mark } from '../draw';\ndeclare const wx: { onMessage(cb: (m: unknown) => void): void };\nwx.onMessage(() => mark());\n");

    const res = await buildOpenDataContext(root);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    const code = readFileSync(res.outputPath!, 'utf8');
    expect(code).toContain('__DREW__');   // the local module came in
    expect(code).not.toContain('import '); // one self-contained script
  }, 30_000);

  it('refuses a context that imports the engine — here, not on a device', async () => {
    context("import { Assets } from 'esengine';\nAssets.toString();\n");
    const res = await buildOpenDataContext(root);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/esengine/);
  }, 30_000);
});

describe('rehearseOpenData', () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  let removed: string[] = [];

  beforeEach(() => {
    removed = [];
    for (const [key, value] of Object.entries({
      document: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) },
      Image: class {},
    })) {
      if (!(key in globals)) { globals[key] = value; removed.push(key); }
    }
  });
  afterEach(() => {
    for (const key of removed) delete globals[key];
    delete globals.wx;
  });

  /** A context written the way one for a device is: reads the host global, keeps
   *  the messages it is sent. */
  const SOURCE = `
    var seen = [];
    globalThis.__SEEN__ = seen;
    var host = globalThis.wx;
    globalThis.__CANVAS__ = host.getSharedCanvas();
    host.onMessage(function (m) {
      seen.push(m);
      host.getFriendCloudStorage({ keyList: [m.key], success: function (res) { seen.push(res.data); } });
    });
  `;

  it('runs a context and delivers what the game posted', () => {
    const rehearsal = rehearseOpenData(SOURCE);
    expect(globals.__CANVAS__).toBe(rehearsal.canvas);

    rehearsal.post({ kind: 'show', key: 'es.score' });
    const seen = globals.__SEEN__ as unknown[];
    expect(seen[0]).toEqual({ kind: 'show', key: 'es.score' });

    // The friends it invents are re-keyed to what the game asked for, and the
    // one who never played carries no row at all.
    const friends = seen[1] as Array<{ nickname: string; KVDataList: Array<{ key: string }> }>;
    expect(friends.map((f) => f.nickname)).toContain('Sample Friend');
    expect(friends.every((f) => f.KVDataList.every((kv) => kv.key === 'es.score'))).toBe(true);
    expect(friends.find((f) => f.nickname === 'Never Played')!.KVDataList).toEqual([]);
  });

  it('gives the player back the score the game submitted', () => {
    const rehearsal = rehearseOpenData(SOURCE);
    rehearsal.write({ 'es.score': '777' });
    rehearsal.post({ kind: 'show', key: 'es.score' });

    const friends = (globals.__SEEN__ as unknown[])[1] as Array<{ nickname: string; KVDataList: Array<{ value: string }> }>;
    expect(friends[0].nickname).toBe('You');
    expect(friends[0].KVDataList[0].value).toBe('777');
  });

  it('leaves no `wx` behind — the platform is the seam, not a global', () => {
    rehearseOpenData(SOURCE);
    expect('wx' in globals).toBe(false);
  });
});
