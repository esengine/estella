// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Serve the engine pixel probe in an ordinary browser. Does not launch Electron.
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = path.join(root, 'build/render-host');
await stat(path.join(host, 'host.js'));
const port = Number(process.env.PORT ?? 5192);
const output = process.env.PROBE_OUTPUT ? path.resolve(process.env.PROBE_OUTPUT) : null;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };
const page = `<!doctype html><meta charset="utf-8"><title>Sprite nine-slice pixel probe</title>
<style>body{background:#18202e;color:#e7edf5;font:16px system-ui;margin:24px}button{padding:10px}canvas{image-rendering:pixelated}#result{white-space:pre-wrap}</style>
<h1>Sprite nine-slice</h1><p>Native / five times wider / shared UI geometry</p>
<button id="run">Run pixel checks</button><p id="summary">Booting…</p><canvas id="preview"></canvas><details><summary>Evidence</summary><pre id="result"></pre></details>
<script type="module" src="/tools/sprite-nine-slice-probe.mjs"></script>`;
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/report' && req.method === 'POST') {
            let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) throw Error('Report too large'); }
            const report = JSON.parse(body);
            if (!['webgl2', 'webgpu'].includes(report.backend)) throw Error('Invalid backend');
            if (output) {
                await mkdir(output, { recursive: true });
                await writeFile(path.join(output, `${report.backend}.json`), JSON.stringify(report, null, 2) + '\n');
            }
            res.writeHead(200); res.end('saved'); return;
        }
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); return; }
        const rel = decodeURIComponent(url.pathname).slice(1);
        const base = rel.startsWith('tools/') ? root : rel.startsWith('textures/') || rel.startsWith('scenes/') ? path.join(root, 'fixtures') : host;
        const file = path.resolve(base, rel);
        if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
        res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
        res.end(await readFile(file));
    } catch (error) { res.writeHead(404); res.end(String(error)); }
});
server.listen(port, '127.0.0.1', () => {
    for (const backend of ['webgl2', 'webgpu']) console.log(`http://127.0.0.1:${port}/?w=320&h=128&textures=runtime&backend=${backend}`);
});
