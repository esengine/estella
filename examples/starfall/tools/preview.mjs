import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.ktx2': 'image/ktx2', '.wav': 'audio/wav' };
export async function servePreview(directory, port = 0) {
    const root = path.resolve(directory);
    const server = createServer(async (req, res) => {
        try {
            const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
            const file = path.resolve(root, name), rel = path.relative(root, file);
            if (rel.startsWith('..') || path.isAbsolute(rel)) return void res.writeHead(403).end();
            if (!(await stat(file)).isFile()) return void res.writeHead(404).end();
            res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
            res.end(await readFile(file));
        } catch { res.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return server;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    const root = process.argv[2] || fileURLToPath(new URL('../../../output/starfall/web/', import.meta.url));
    const server = await servePreview(root, Number(process.env.PORT || 5194));
    console.log(`Starfall: http://127.0.0.1:${server.address().port}`);
}
