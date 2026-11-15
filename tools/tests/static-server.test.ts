// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { serveDir, mimeOf } from '../lib/staticServer.mjs';

let root = '';
let other = '';
const servers: Server[] = [];

const start = async (...args: Parameters<typeof serveDir>) => {
    const server = await serveDir(...args);
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'estella-static-'));
    other = mkdtempSync(path.join(os.tmpdir(), 'estella-static-cdn-'));
    writeFileSync(path.join(root, 'index.html'), '<html><head></head></html>');
    writeFileSync(path.join(root, 'game.js'), 'run()');
    writeFileSync(path.join(root, 'engine.wasm.br'), 'br-bytes');
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'assets', 'a.KTX2'), 'k');
    writeFileSync(path.join(other, 'asset-manifest.json'), '{"from":"cdn"}');
});

afterAll(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('serveDir', () => {
    it('serves the directory, its index at the root, and a type by extension', async () => {
        const base = await start(root);
        const index = await fetch(`${base}/`);
        expect(index.headers.get('content-type')).toBe('text/html');
        expect(await index.text()).toContain('<head>');
        expect((await fetch(`${base}/game.js`)).headers.get('content-type')).toBe('text/javascript');
        expect((await fetch(`${base}/assets/a.KTX2`)).headers.get('content-type')).toBe('image/ktx2');
        expect(mimeOf('x.unknown')).toBe('application/octet-stream');
    });

    it('answers 404 for what is absent and never leaves the directory', async () => {
        const base = await start(root);
        expect((await fetch(`${base}/nope.js`)).status).toBe(404);
        const escaped = await fetch(`${base}/..%2F..%2Fetc%2Fhosts`);
        expect([403, 404]).toContain(escaped.status);
    });

    it('lets a route answer a page or send a prefix to another directory', async () => {
        const base = await start(root, {
            route: (rel: string) => {
                if (rel === '' || rel === 'index.html') return { body: '<p>host</p>' };
                if (rel === 'tampered/asset-manifest.json') return { body: '{"lie":1}', type: 'application/json' };
                if (rel.startsWith('cdn/')) return { root: other, rel: rel.slice(4) };
                return null;
            },
        });
        expect(await (await fetch(`${base}/`)).text()).toBe('<p>host</p>');
        const lie = await fetch(`${base}/tampered/asset-manifest.json`);
        expect(lie.headers.get('content-type')).toBe('application/json');
        expect(await lie.text()).toBe('{"lie":1}');
        expect(await (await fetch(`${base}/cdn/asset-manifest.json`)).text()).toBe('{"from":"cdn"}');
        expect(await (await fetch(`${base}/game.js`)).text()).toBe('run()');
    });

    it('lets a shape rewrite the bytes and add headers', async () => {
        const base = await start(root, {
            shape: ({ rel, abs, bytes }: { rel: string; abs: string; bytes: Buffer }) => {
                if (abs.endsWith('.br')) return { headers: { 'content-type': mimeOf(abs.slice(0, -3)), 'x-inner': 'wasm' } };
                if (rel !== 'index.html') return null;
                const body = gzipSync(Buffer.from(String(bytes).replace('<head>', '<head><style></style>')));
                return { bytes: body, headers: { 'content-encoding': 'gzip', 'content-length': body.length } };
            },
        });
        const index = await fetch(`${base}/index.html`);
        expect(index.headers.get('content-encoding')).toBe('gzip');
        expect(await index.text()).toContain('<head><style></style>');
        const wasm = await fetch(`${base}/engine.wasm.br`);
        expect(wasm.headers.get('content-type')).toBe('application/wasm');
        expect(wasm.headers.get('x-inner')).toBe('wasm');
        expect(await (await fetch(`${base}/game.js`)).text()).toBe('run()');
    });

    it('rejects a port already taken instead of hanging', async () => {
        const base = await start(root);
        const port = Number(new URL(base).port);
        await expect(serveDir(root, { port })).rejects.toThrow(/EADDRINUSE/);
    });
});
