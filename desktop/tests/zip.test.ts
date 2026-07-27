// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The repo's ZIP implementation.
 *
 *        The writer is checked against a REAL unzip rather than against a reader of
 *        our own — a hand-rolled archive that only our own code can open is worth
 *        nothing, since the thing that opens it for real is an ad network's
 *        pipeline. The reader is checked against a real `zip` for the same reason,
 *        and on what it must REFUSE: it opens runtime templates, which arrive as
 *        files someone was handed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeZip, readZip, extractZip } from '../../build-tools/utils/zip.js';

let dir: string;
/** `unzip` ships with macOS and most Linux; skip rather than fail where it doesn't. */
let hasUnzip = true;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'es-zip-'));
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    hasUnzip = false;
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('makeZip', () => {
  it('writes an archive a real unzip accepts, with the content intact', (ctx) => {
    if (!hasUnzip) ctx.skip();
    // Repetitive enough that deflate must actually be exercised (a stored-only
    // archive would pass a naive round-trip but not prove the deflate path).
    const html = `<!doctype html><html><body>${'<span>playable</span>'.repeat(500)}</body></html>`;
    const zip = makeZip([{ name: 'index.html', data: Buffer.from(html, 'utf8') }]);
    const file = path.join(dir, 'playable.zip');
    writeFileSync(file, zip);

    // -t verifies every entry's CRC — the check that catches a malformed header.
    expect(execFileSync('unzip', ['-t', file], { encoding: 'utf8' })).toContain('No errors detected');
    // The entry must sit at the archive ROOT: networks look for index.html there.
    expect(execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim()).toBe('index.html');
    expect(execFileSync('unzip', ['-p', file, 'index.html'], { encoding: 'utf8', maxBuffer: 1 << 24 })).toBe(html);
    // Deflate actually happened.
    expect(zip.length).toBeLessThan(html.length / 2);
  });

  it('is deterministic, so an export only changes when its content does', () => {
    const data = Buffer.from('same bytes', 'utf8');
    const a = makeZip([{ name: 'index.html', data }]);
    const b = makeZip([{ name: 'index.html', data }]);
    expect(a.equals(b)).toBe(true);
  });

  it('round-trips binary content and multiple entries', (ctx) => {
    if (!hasUnzip) ctx.skip();
    const bin = Buffer.from(Array.from({ length: 1024 }, (_, i) => i & 0xff));
    const zip = makeZip([
      { name: 'index.html', data: Buffer.from('<html></html>', 'utf8') },
      { name: 'payload.bin', data: bin },
    ]);
    const file = path.join(dir, 'multi.zip');
    writeFileSync(file, zip);
    expect(execFileSync('unzip', ['-t', file], { encoding: 'utf8' })).toContain('No errors detected');
    execFileSync('unzip', ['-o', file, '-d', path.join(dir, 'out')], { stdio: 'ignore' });
    expect(readFileSync(path.join(dir, 'out', 'payload.bin')).equals(bin)).toBe(true);
  });
});

describe('readZip / extractZip', () => {
  it('reads an archive a real `zip` produced, deflated and stored alike', (ctx) => {
    let hasZip = true;
    try {
      execFileSync('zip', ['-v'], { stdio: 'ignore' });
    } catch {
      hasZip = false;
    }
    if (!hasZip) ctx.skip();

    const src = path.join(dir, 'src');
    mkdirSync(path.join(src, 'nested'), { recursive: true });
    const text = 'estella'.repeat(400);
    writeFileSync(path.join(src, 'nested', 'a.txt'), text);
    writeFileSync(path.join(src, 'b.bin'), Buffer.from([0, 1, 2, 250, 251]));
    const file = path.join(dir, 'real.zip');
    // -0 stores the second copy, so both compression methods are exercised.
    execFileSync('zip', ['-r', file, '.'], { cwd: src, stdio: 'ignore' });
    execFileSync('zip', ['-0', file, 'b.bin'], { cwd: src, stdio: 'ignore' });

    const entries = readZip(readFileSync(file));
    const byName = new Map(entries.map((e) => [e.name, e.data]));
    expect(byName.get('nested/a.txt')?.toString('utf8')).toBe(text);
    expect([...byName.get('b.bin')!]).toEqual([0, 1, 2, 250, 251]);
  });

  it('round-trips what makeZip wrote, into a directory tree', () => {
    const zip = makeZip([
      { name: 'template.json', data: Buffer.from('{}') },
      { name: 'App/main.m', data: Buffer.from('int main(){}') },
    ]);
    const out = path.join(dir, 'extracted');

    expect(extractZip(zip, out).sort()).toEqual(['App/main.m', 'template.json']);
    expect(readFileSync(path.join(out, 'App', 'main.m'), 'utf8')).toBe('int main(){}');
  });

  it('refuses to write outside the destination, before writing anything', () => {
    const out = path.join(dir, 'guarded');
    const zip = makeZip([
      { name: 'ok.txt', data: Buffer.from('ok') },
      { name: '../escaped.txt', data: Buffer.from('nope') },
    ]);

    expect(() => extractZip(zip, out)).toThrow(/unsafe/);
    // The safe entry was not written either: the names are checked as a set.
    expect(existsSync(path.join(out, 'ok.txt'))).toBe(false);
    expect(existsSync(path.join(dir, 'escaped.txt'))).toBe(false);
  });

  it('rejects a corrupt entry rather than handing back wrong bytes', () => {
    const zip = makeZip([{ name: 'a.txt', data: Buffer.from('hello world') }]);
    // Flip a byte in the compressed payload; the CRC in the header no longer matches.
    zip[45] ^= 0xff;

    expect(() => readZip(zip)).toThrow();
  });
});
