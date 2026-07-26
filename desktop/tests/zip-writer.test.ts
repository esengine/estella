// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ZIP writer, checked against a REAL unzip rather than against a reader
 *        of our own — a hand-rolled archive that only our own code can open is worth
 *        nothing, since the thing that opens it for real is an ad network's pipeline.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeZip } from '../electron/zipWriter';

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
  it('writes an archive a real unzip accepts, with the content intact', () => {
    if (!hasUnzip) return;
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

  it('round-trips binary content and multiple entries', () => {
    if (!hasUnzip) return;
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
