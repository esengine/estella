// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    serveDir.mjs
 * @brief   A folder served as it is on 127.0.0.1: an exported web package, `/` its index.html.
 *
 * @details `staticServer.mjs` serves the render host with the fixture trees mounted beside it; a package needs none of that,
 *          and a request for `/` has to answer with the package's own page.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
    '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css',
};

/** Serve `dir` on a free port of 127.0.0.1; resolves with the listening server. */
export function serveDir(dir) {
    return new Promise((resolve) => {
        const server = createServer(async (req, res) => {
            const relative = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
            const file = path.resolve(dir, relative);
            if (!file.startsWith(path.resolve(dir))) { res.writeHead(403); res.end(); return; }
            try {
                const body = await readFile(file);
                res.writeHead(200, { 'Content-Type': TYPES[path.extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
                res.end(body);
            } catch {
                res.writeHead(404);
                res.end();
            }
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}
