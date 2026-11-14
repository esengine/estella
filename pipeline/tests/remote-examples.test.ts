// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadExample, installedExample, fetchExampleIndex } from '../src/project/remoteExamples';
import { makeZip } from '../../build-tools/utils/zip.js';
import {
  EXAMPLE_INDEX_KIND, EXAMPLE_INDEX_FORMAT, exampleArchiveName, parseExampleIndex,
} from '../../build-tools/utils/remoteExamples.js';

let store: string;
beforeEach(() => { store = mkdtempSync(path.join(tmpdir(), 'es-ex-')); });
afterEach(() => { rmSync(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

const zip = makeZip([
  { name: 'project.esproject', data: Buffer.from('{"name":"bistro"}') },
  { name: 'assets/a.bin', data: Buffer.alloc(64, 7) },
]);
const sha = createHash('sha256').update(zip).digest('hex');
const entry = { name: 'bistro', file: exampleArchiveName('bistro', sha), sha256: sha, bytes: zip.length };
const indexDoc = (e = entry) => ({ kind: EXAMPLE_INDEX_KIND, formatVersion: EXAMPLE_INDEX_FORMAT, examples: [e] });

const serve = (files: Record<string, Buffer | object | number>): typeof fetch => (async (url: string) => {
  const key = String(url);
  const hit = Object.entries(files).find(([k]) => key.endsWith(k));
  if (!hit) return new Response('', { status: 404 });
  const [, v] = hit;
  if (typeof v === 'number') return new Response('', { status: v });
  return new Response(Buffer.isBuffer(v) ? new Uint8Array(v) : JSON.stringify(v), { status: 200 });
}) as typeof fetch;

describe('downloadable examples', () => {
  it('installs an archive whose size and digest match the index', async () => {
    const progress: number[] = [];
    const r = await downloadExample('bistro', {
      storeDir: store, bases: ['https://m/examples'],
      fetchImpl: serve({ 'index.json': indexDoc(), [entry.file]: zip }),
      onProgress: (p) => progress.push(p.received),
    });
    expect(r.ok).toBe(true);
    expect(installedExample('bistro', store)).toBe(path.join(store, 'bistro'));
    expect(readFileSync(path.join(store, 'bistro', 'assets', 'a.bin')).length).toBe(64);
    expect(progress.at(-1)).toBe(zip.length);
  });

  it('refuses a body that hashes to something else and leaves nothing installed', async () => {
    const bad = Buffer.from(zip); bad[bad.length - 1] ^= 1;
    const r = await downloadExample('bistro', {
      storeDir: store, bases: ['https://m/examples'], fetchImpl: serve({ 'index.json': indexDoc(), [entry.file]: bad }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/checksum/);
    expect(installedExample('bistro', store)).toBeNull();
    expect(existsSync(path.join(store, 'bistro'))).toBe(false);
  });

  it('refuses a body of another length', async () => {
    const r = await downloadExample('bistro', {
      storeDir: store, bases: ['https://m/examples'],
      fetchImpl: serve({ 'index.json': indexDoc(), [entry.file]: zip.subarray(0, zip.length - 1) }),
    });
    expect(r.error).toMatch(/bytes/);
  });

  it('tries the next base when the first has no index', async () => {
    const calls: string[] = [];
    const inner = serve({ 'b/examples/index.json': indexDoc(), [`b/examples/${entry.file}`]: zip });
    const r = await downloadExample('bistro', {
      storeDir: store, bases: ['https://a/examples', 'https://b/examples'],
      fetchImpl: ((u: string) => { calls.push(String(u)); return inner(u); }) as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(calls[0]).toContain('https://a/');
  });

  it('will not install a name the editor does not list as downloadable', async () => {
    const r = await downloadExample('hello-world', { storeDir: store, bases: ['https://m/examples'], fetchImpl: serve({}) });
    expect(r.ok).toBe(false);
    expect(installedExample('hello-world', store)).toBeNull();
  });

  it('reads no index out of a page that is not one', async () => {
    expect(parseExampleIndex({ kind: 'other' })).toBeNull();
    expect(parseExampleIndex(indexDoc({ ...entry, file: '../x.zip' }))).toBeNull();
    expect(await fetchExampleIndex(serve({ 'index.json': 404 }), ['https://m/examples'])).toBeNull();
  });
});
