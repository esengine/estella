// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  loopbackServer.ts — serve a static directory over a loopback http origin.
 *
 *        Two callers, one need for a *real http origin* rather than `file://` or the
 *        `app://` custom scheme:
 *
 *        • The packaged editor shell (dist/). dockview's "pop a panel into its own OS
 *          window" opens a same-origin child via `window.open`, and it rejects any
 *          opener that isn't http(s) same-origin — the `app://` custom scheme fails
 *          that check. Serving dist/ over http gives popouts a valid origin. (Dev
 *          already runs on http via Vite, so this only matters when packaged.)
 *        • Export preview. A single-file playable or web build opened via `file://`
 *          hits opaque-origin rules — every `file:` URL is a unique origin, so
 *          subresource loads read cross-origin and wasm can't stream-compile. Served
 *          over http (the ad-network iframe / static host it ships to) both vanish.
 *
 *        One server per served root, reused across callers (files are read per request
 *        with no-store, so a re-export serves fresh bytes on the same URL). Bound to
 *        127.0.0.1 on an ephemeral port; all are closed on app quit. Pure Node
 *        (http/fs) — IPC wiring is in main.ts.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isInsideRoot } from './pathSandbox';
import { httpContentType } from './mimeTypes';

/** Served root (absolute) → its running loopback server + URL. */
const servers = new Map<string, { server: http.Server; url: string }>();

/**
 * Start (or reuse) a loopback http server rooted at `rootDir` and return its base URL
 * (with a trailing slash). Throws if the directory has no `index.html` — a clear
 * failure beats silently serving 404s.
 */
export async function loopbackServer(rootDir: string, preferredPort = 0): Promise<string> {
  const root = path.resolve(rootDir);
  if (!existsSync(path.join(root, 'index.html'))) {
    throw new Error(`no index.html in ${root} — nothing to serve`);
  }
  const existing = servers.get(root);
  if (existing) return existing.url;

  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const abs = path.join(root, rel);
      if (!isInsideRoot(root, abs)) {
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
  // The port IS the origin, and the origin is where the renderer's localStorage
  // lives. A caller that wants its preferences back next launch asks for the
  // port it had; anything already holding it falls back rather than failing.
  await new Promise<void>((resolve) => {
    server.once('error', () => { server.listen(0, '127.0.0.1', resolve); });
    server.listen(preferredPort, '127.0.0.1', resolve);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}/`;
  servers.set(root, { server, url });
  return url;
}

/** Close every loopback server (on app quit). */
export function closeAllLoopbackServers(): void {
  for (const { server } of servers.values()) {
    try { server.close(); } catch { /* already closing */ }
  }
  servers.clear();
}
