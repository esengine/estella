// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  staticServer.mjs — the loopback file server every headless host serves from.
 *
 * The scene fixtures behind the pixel gates live in `fixtures/`, engine-side, and
 * outlive any one host: the engine's own verification host and the editor's both
 * mount them. Everything else comes from the host's own build output, so a host
 * is a build directory plus this.
 *
 * The host's own files win. A fixture tree is a project root — its scenes name
 * `/assets/…` — and so is a Vite build, whose chunks land in `assets/` too;
 * routing that prefix to the fixtures by name takes the page's own scripts away
 * from it, which reads as "the engine never booted".
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'fixtures');

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.esscene': 'application/json',
    '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.webm': 'video/webm',
};

/** Reads `rel` under `root`, or null when it is absent or would escape the root. */
async function readUnder(root, rel) {
    const abs = path.join(root, rel);
    if (!abs.startsWith(root)) return null;
    try {
        return await readFile(abs);
    } catch {
        return null;
    }
}

/**
 * Serves `dist` on an ephemeral loopback port, falling back to `fixtures/`.
 * Resolves to the listening server; the caller owns closing it.
 */
export function serveHost(dist) {
    const server = http.createServer(async (req, res) => {
        const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
        const bytes = (await readUnder(dist, rel)) ?? (await readUnder(FIXTURES, rel));
        if (!bytes) return void res.writeHead(404).end('not found');
        res.writeHead(200, { 'content-type': MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream' });
        res.end(bytes);
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export { FIXTURES, MIME };
