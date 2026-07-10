// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  exportPreview.ts — preview an http-servable export (web / playable) over a
 *        loopback http server, the way it actually deploys.
 *
 *        A single-file playable or a web build opened via `file://` hits the browser's
 *        opaque-origin rules — every `file:` URL is a unique origin, so subresource
 *        loads are treated cross-origin (the "unsafe attempt to load URL … unique
 *        security origin" notice) and wasm can't stream-compile. Served over `http`
 *        (a real origin — exactly the ad-network iframe / static host the build ships
 *        to) both concerns vanish. So the correct preview is http, not the OS opening
 *        the file.
 *
 *        One server per served root, reused across re-previews (files are read per
 *        request with no-store, so a re-export serves fresh bytes on the same URL).
 *        All are closed on app quit. Pure Node (http/fs) — IPC wiring is in main.ts.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { httpContentType } from './mimeTypes';

/** Served root (absolute) → its running loopback server + URL. */
const servers = new Map<string, { server: http.Server; url: string }>();

/**
 * Start (or reuse) a loopback http server rooted at `rootDir` and return its base URL.
 * Throws if the directory has no `index.html` (nothing to preview) — a clear failure
 * beats silently serving 404s.
 */
export async function previewServer(rootDir: string): Promise<string> {
  const root = path.resolve(rootDir);
  if (!existsSync(path.join(root, 'index.html'))) {
    throw new Error(`no index.html in ${root} — nothing to preview`);
  }
  const existing = servers.get(root);
  if (existing) return existing.url;

  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const abs = path.join(root, rel);
      // Contain within the served root (no traversal out of the build).
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const bytes = await readFile(abs);
      res.writeHead(200, { 'content-type': httpContentType(abs), 'cache-control': 'no-store' });
      res.end(bytes);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}/`;
  servers.set(root, { server, url });
  return url;
}

/** Close every preview server (on app quit). */
export function closeAllPreviewServers(): void {
  for (const { server } of servers.values()) {
    try { server.close(); } catch { /* already closing */ }
  }
  servers.clear();
}
