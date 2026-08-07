// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The loopback static server (serves the packaged editor shell and export
 *        previews over http, so both get a real http origin instead of file:// or
 *        the app:// custom scheme). Asserts it serves index.html + assets with
 *        correct content-types, contains within the root (no traversal), reuses one
 *        server per root, and fails fast without an index.html.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loopbackServer, closeAllLoopbackServers } from '../electron/loopbackServer';

afterAll(() => closeAllLoopbackServers());

function buildDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'estella-loopback-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>P</title><canvas id="canvas"></canvas>');
  writeFileSync(path.join(dir, 'esengine.wasm'), 'WASMBYTES');
  return dir;
}

describe('loopback server', () => {
  it('serves index.html and the wasm with correct content-types over http', async () => {
    const dir = buildDir();
    try {
      const url = await loopbackServer(dir);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

      const index = await fetch(url);
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toBe('text/html');
      expect(await index.text()).toContain('<canvas id="canvas">');

      // wasm MUST be application/wasm (streaming compile) — the whole reason http beats file://.
      const wasm = await fetch(`${url}esengine.wasm`);
      expect(wasm.status).toBe(200);
      expect(wasm.headers.get('content-type')).toBe('application/wasm');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reuses one server per root (same URL on re-serve)', async () => {
    const dir = buildDir();
    try {
      expect(await loopbackServer(dir)).toBe(await loopbackServer(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('contains within the served root (no path traversal)', async () => {
    const dir = buildDir();
    try {
      const url = await loopbackServer(dir);
      const res = await fetch(`${url}../../etc/hosts`);
      expect([403, 404]).toContain(res.status);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a link out of the served root', async () => {
    const dir = buildDir();
    const outside = mkdtempSync(path.join(tmpdir(), 'estella-loopback-outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'PRIVATE');
    try {
      if (process.platform === 'win32') symlinkSync(outside, path.join(dir, 'escape'), 'junction');
      else symlinkSync(outside, path.join(dir, 'escape'), 'dir');
    } catch {
      return; // no permission to make one here
    }
    try {
      const url = await loopbackServer(dir);
      const res = await fetch(`${url}escape/secret.txt`);
      expect([403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain('PRIVATE');
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast when the dir has no index.html', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'estella-loopback-empty-'));
    mkdirSync(path.join(empty, 'sub'), { recursive: true });
    try {
      await expect(loopbackServer(empty)).rejects.toThrow(/index\.html/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
