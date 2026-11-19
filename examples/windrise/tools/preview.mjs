import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
import { mimeOf } from '../../../tools/lib/staticServer.mjs';

const compressible = /\.(?:js|mjs|json|wasm|esscene|esmesh|esshader|estimeline|pack)$/;
const fingerprinted = /^(?:assets|packs)\/[0-9a-f]{16}\.[a-z0-9]+$|^chunks\/[\w-]+-[A-Z0-9]{8}\.js$/;

export async function servePreview(directory, port = 0) {
    const root = path.resolve(directory);
    const server = createServer(async (req, res) => {
        let relative;
        try {
            relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
        } catch {
            res.writeHead(400).end();
            return;
        }
        const file = path.resolve(root, relative), inside = path.relative(root, file);
        if (inside.startsWith('..') || path.isAbsolute(inside)) return void res.writeHead(403).end();
        try {
            const info = await stat(file);
            if (!info.isFile()) return void res.writeHead(404).end();
            const etag = 'W/"' + info.size.toString(16) + '-' + info.mtimeMs.toString(16) + '"';
            res.setHeader('ETag', etag);
            res.setHeader('Cache-Control', fingerprinted.test(relative) ? 'public, max-age=31536000, immutable' : 'no-cache');
            const canCompress = compressible.test(relative) && info.size >= 1024;
            if (canCompress) res.setHeader('Vary', 'Accept-Encoding');
            if (req.headers['if-none-match'] === etag) return void res.writeHead(304).end();
            res.setHeader('Content-Type', mimeOf(file));
            const gzip = canCompress && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && !/\bgzip\s*;\s*q=0(?:\.0*)?\s*(?:,|$)/i.test(req.headers['accept-encoding'] ?? '');
            if (gzip) res.setHeader('Content-Encoding', 'gzip');
            else res.setHeader('Content-Length', info.size);
            if (req.method === 'HEAD') return void res.end();
            const body = createReadStream(file);
            if (gzip) await pipeline(body, createGzip({ level: 1 }), res);
            else await pipeline(body, res);
        } catch {
            if (!res.headersSent && !res.destroyed) res.writeHead(404).end('Export the Windrise project first.');
        }
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    const root = fileURLToPath(new URL('../../../output/windrise/web/', import.meta.url));
    const server = await servePreview(root, Number(process.env.PORT || 5187));
    console.log('Windrise: http://127.0.0.1:' + server.address().port);
}
