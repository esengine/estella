// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  serve.mjs — the browser benchmark, on a LAN address a phone can open.
 *
 * Serves the three artifacts a shipped web build carries (the SDK, the engine
 * wasm, the compiled module) plus the page that drives them, and takes the
 * result back on POST /result so the run ends up in the terminal that started
 * it rather than only on the phone's screen.
 *
 * No cable and no adb on purpose: a device on the same network is all this
 * needs, and that is the setup most likely to exist.
 *
 *   node bench/aot-frame/build.mjs      # once, on a machine with emsdk
 *   node bench/aot-frame/serve.mjs      # prints the URL to open
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PORT = Number(process.env['PORT'] ?? 8788);

/**
 * URL prefix → directory. Nothing outside these is reachable, and the last one
 * is the benchmark's own directory because the page and the desktop runner share
 * `measure.mjs` — `/web/bench.js` imports it as `../measure.mjs`.
 */
const MOUNTS = {
    '/sdk/': join(REPO, 'sdk', 'dist'),
    '/wasm/': join(REPO, 'build', 'wasm', 'web'),
    '/build/': join(HERE, '.build'),
    '/': HERE,
};

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.wasm': 'application/wasm', '.map': 'application/json',
};

function resolveFile(urlPath) {
    let clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/\\/g, '/');
    if (clean === '/') clean = '/web/index.html';
    for (const [prefix, dir] of Object.entries(MOUNTS)) {
        if (!clean.startsWith(prefix)) continue;
        const rest = clean.slice(prefix.length) || 'index.html';
        const file = join(dir, rest);
        // The mount is the boundary: a path that climbs out of it is not served.
        if (!file.startsWith(dir)) return null;
        if (existsSync(file) && statSync(file).isFile()) return file;
    }
    return null;
}

const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
            res.writeHead(204).end();
            console.log(`\n${'='.repeat(72)}\nRESULT ${body}\n${'='.repeat(72)}`);
        });
        return;
    }
    const file = resolveFile(req.url ?? '/');
    if (!file) {
        console.log(`404 ${req.url}`);
        res.writeHead(404).end('not found');
        return;
    }
    res.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        // The page fetches nothing cross-origin, but a phone's browser is stricter
        // about a bare LAN address than a desktop's; this removes the question.
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`serving ${HERE}`);
    for (const [name, list] of Object.entries(networkInterfaces())) {
        for (const i of list ?? []) {
            if (i.family === 'IPv4' && !i.internal) console.log(`  http://${i.address}:${PORT}/   (${name})`);
        }
    }
    console.log(`  http://127.0.0.1:${PORT}/   (this machine)`);
    console.log('waiting for a run…');
});
