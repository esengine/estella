// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The loopback export-preview server: serves a build dir over http (its real
 *        deployment surface) so web/playable previews never hit file:// opaque-origin
 *        rules. Asserts it serves index.html + assets with correct content-types,
 *        contains within the root (no traversal), and fails fast without an index.html.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { previewServer, closeAllPreviewServers } from '../electron/exportPreview';

afterAll(() => closeAllPreviewServers());

function buildDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'estella-preview-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>P</title><canvas id="canvas"></canvas>');
  writeFileSync(path.join(dir, 'esengine.wasm'), 'WASMBYTES');
  return dir;
}

describe('exportPreview loopback server', () => {
  it('serves index.html and the wasm with correct content-types over http', async () => {
    const dir = buildDir();
    try {
      const url = await previewServer(dir);
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

  it('reuses one server per root (same URL on re-preview)', async () => {
    const dir = buildDir();
    try {
      expect(await previewServer(dir)).toBe(await previewServer(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('contains within the served root (no path traversal)', async () => {
    const dir = buildDir();
    try {
      const url = await previewServer(dir);
      const res = await fetch(`${url}../../etc/hosts`);
      expect([403, 404]).toContain(res.status);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast when the dir has no index.html', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'estella-preview-empty-'));
    mkdirSync(path.join(empty, 'sub'), { recursive: true });
    try {
      await expect(previewServer(empty)).rejects.toThrow(/index\.html/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
