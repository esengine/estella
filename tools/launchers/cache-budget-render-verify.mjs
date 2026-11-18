// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Exported mini-game/cache/editor verification on a contract host, not physical WeChat.
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { mkdir, readFile, writeFile, readdir, stat, rename, unlink } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { HOST_PAGE } from './minigameHost.mjs';
import { createDebugChannelServer } from '../../desktop/shared/debugChannelServer.mjs';
import { onRendererConsole } from '../lib/rendererConsole.mjs';
import { ROOT } from '../lib/repo.mjs';
import { MIME } from '../lib/staticServer.mjs';

const OUT = path.join(ROOT, 'output/cache-budget/render');
const STORE = path.join(OUT, `cache-${randomUUID()}`);
// Other headless verifiers use Electron too. Sharing its default user-data
// profile can race their network-service shutdown; this run owns its profile.
const PROFILE = path.join(OUT, `profile-${randomUUID()}`);
mkdirSync(PROFILE, { recursive: true });
app.setPath('userData', PROFILE);
const { WebSocketServer } = createRequire(path.join(ROOT, 'sdk/package.json'))('ws');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-gpu-sandbox');
if (process.platform === 'linux') app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// The restart deliberately closes the sole window before opening its successor.
// Keep the verifier alive until its final evidence has been written.
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Additional vendor filesystem methods are implemented over the fixture's
 * loopback store. The normal packaged-file reader/image/socket/wasm host stays
 * unchanged. The game and SDK see the same API contract as a mini-game device. */
function installCacheHost(wx, fs) {
    wx.env = { USER_DATA_PATH: '/__cache' };
    const request = async (op, options, body) => {
        const query = new URLSearchParams({ op });
        for (const key of ['filePath', 'oldPath', 'newPath']) if (options[key]) query.set(key, options[key]);
        const response = await fetch('/__fs?' + query, { method: body ? 'POST' : 'GET', body });
        if (!response.ok) throw Error(await response.text());
        return response.json();
    };
    const callbacks = (promise, options, transform = x => x) => promise.then(result => options.success?.(transform(result)))
        .catch(error => options.fail?.({ errMsg: String(error) }));
    fs.writeFile = o => callbacks(request('write', o, o.data), o);
    fs.rename = o => callbacks(request('rename', o), o);
    fs.unlink = o => callbacks(request('unlink', o), o);
    fs.readdir = o => callbacks(request('list', o), o);
    fs.stat = o => callbacks(request('stat', { filePath: o.path }), o,
        r => ({ stats: { ...r, isFile: () => true } }));
}

const marker = '  globalThis.wx = wx;';
const originalPage = HOST_PAGE('game.js');
if (!originalPage.includes(marker)) throw Error('mini-game host injection point changed');
const page = originalPage.replace(marker, `  (${installCacheHost.toString()})(wx, fs);\n${marker}`);

app.whenReady().then(async () => {
    let channel, server, win;
    let code = 0;
    let offline = false, full = false;
    const blockedDownloads = [], diagnostics = [], requests = [], evidence = { host: 'mini-game contract host', physicalDevice: false };
    try {
        await mkdir(STORE, { recursive: true });
        channel = await createDebugChannelServer({ WebSocketServer, host: '127.0.0.1' });
        // Generate actual game packages using the current SDK and compiled wasm.
        // Exporting can take seconds; keep Electron's main loop answering the
        // network/GPU service startup while the child builds these packages.
        const fixture = await promisify(execFile)('node', [path.join(ROOT, 'tools/cache-budget-render-fixture.mjs'), OUT, channel.urlFor('127.0.0.1')],
            { cwd: ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
        process.stdout.write(fixture.stdout);
        process.stderr.write(fixture.stderr);
        const cached = file => {
            const name = String(file ?? '').replace(/^\/__cache\//, '');
            if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw Error('invalid cache file');
            return path.join(STORE, name);
        };
        server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url, 'http://fixture');
                if (url.pathname.startsWith('/cdn/')) requests.push(url.pathname);
                if (url.pathname === '/__fs') {
                    const op = url.searchParams.get('op');
                    let data = {};
                    if (op === 'list') data = { files: await readdir(STORE) };
                    else if (op === 'stat') {
                        const s = await stat(cached(url.searchParams.get('filePath')));
                        data = { size: s.size, lastAccessedTime: s.atimeMs / 1000 };
                    } else if (op === 'write') {
                        if (full) { res.writeHead(507).end('user storage quota exceeded'); return; }
                        const parts = []; for await (const part of req) parts.push(part);
                        await writeFile(cached(url.searchParams.get('filePath')), Buffer.concat(parts));
                    } else if (op === 'rename') await rename(cached(url.searchParams.get('oldPath')), cached(url.searchParams.get('newPath')));
                    else if (op === 'unlink') await unlink(cached(url.searchParams.get('filePath')));
                    else throw Error('unknown filesystem operation');
                    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
                    return;
                }
                if (url.pathname.startsWith('/__cache/')) {
                    const bytes = await readFile(cached(url.pathname));
                    res.writeHead(200, { 'content-type': 'image/png' }).end(bytes);
                    return;
                }
                if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }).end(page); return; }
                let dir = path.join(OUT, 'v0');
                let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
                const cdn = /^cdn\/v([123])\/(.*)$/.exec(relative);
                if (cdn) {
                    if (offline) { blockedDownloads.push(url.pathname); res.writeHead(503).end('offline'); return; }
                    dir = path.join(OUT, `v${cdn[1]}`); relative = cdn[2];
                }
                const file = path.resolve(dir, relative);
                if (!file.startsWith(dir + path.sep)) { res.writeHead(403).end(); return; }
                const compressed = file.endsWith('.br');
                const ext = path.extname(compressed ? file.slice(0, -3) : file);
                const bytes = await readFile(file);
                res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream',
                    ...(compressed ? { 'content-encoding': 'br' } : {}) }).end(bytes);
            } catch (e) { if (!res.headersSent) res.writeHead(404); res.end(String(e)); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const partition = `cache-budget-${randomUUID()}`;
        const boot = async () => {
            const w = new BrowserWindow({ show: false, width: 256, height: 256, useContentSize: true,
                webPreferences: { partition, backgroundThrottling: false } });
            onRendererConsole(w.webContents, message => { if (/error|fail|cache|update|exception/i.test(message)) diagnostics.push(message.slice(0, 300)); });
            await w.loadURL(base);
            const deadline = Date.now() + 30_000;
            while (!await w.webContents.executeJavaScript('!!globalThis.__cacheAcceptance && globalThis.__estellaIdentDone === true').catch(() => false)) {
                if (Date.now() > deadline) throw Error('mini-game did not reach its first scene');
                await sleep(100);
            }
            return w;
        };
        win = await boot();
        const target = async () => {
            const deadline = Date.now() + 10_000;
            while (!channel.targets().length) { if (Date.now() > deadline) throw Error('device channel did not connect'); await sleep(50); }
            return channel.targets()[0].id;
        };
        const query = async (kind, extra) => channel.query(await target(), kind, extra);
        const capture = async name => {
            const shot = await win.webContents.capturePage();
            await writeFile(path.join(OUT, name + '.png'), shot.toPNG());
            const bitmap = shot.toBitmap(), width = shot.getSize().width, height = shot.getSize().height;
            const offset = ((height >> 1) * width + (width >> 1)) * 4;
            return { pixel: [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]], bitmap,
                hash: createHash('sha256').update(bitmap).digest('hex') };
        };
        const colors = [[40, 190, 50], [210, 40, 40], [40, 70, 220]];
        evidence.updates = [];
        for (let v = 1; v <= 3; v++) {
            const cdn = `${base}/cdn/v${v}`;
            const update = await win.webContents.executeJavaScript(`globalThis.__cacheAcceptance.apply(${JSON.stringify(cdn + '/asset-manifest.json')}, ${JSON.stringify(cdn)})`);
            evidence.lastUpdate = update;
            if (!update.result.ok || update.result.stages.cached !== true || !update.result.stages.persisted) throw Error(`v${v} update did not commit/cache/persist`);
            let shot;
            const deadline = Date.now() + 10_000;
            do { await sleep(100); shot = await capture(`v${v}`); }
            while (shot.pixel.some((c, i) => Math.abs(c - colors[v - 1][i]) > 15) && Date.now() < deadline);
            if (shot.pixel.some((c, i) => Math.abs(c - colors[v - 1][i]) > 15)) throw Error(`v${v} rendered ${shot.pixel} rather than ${colors[v - 1]}`);
            evidence.updates.push({ revision: update.result.revision, stages: update.result.stages, pixel: shot.pixel });
        }
        const before = await query('diskCache');
        const previous = evidence.updates[0].revision;
        await query('retainDiskCacheVersion', { revision: previous, retain: true });
        const retained = await query('cleanDiskCache', { budgetBytes: 0, execute: true });
        if (retained.removed.length || retained.budgetMet) throw Error('retained/current/rollback resources were not protected');
        await query('retainDiskCacheVersion', { revision: previous, retain: false });
        const preview = await query('cleanDiskCache', { budgetBytes: before.protectedBytes });
        if (preview.candidates.length !== 1 || preview.releaseBytes <= 0) throw Error('cleanup preview did not identify the oldest resource');
        const first = await capture('before-cleanup');
        full = true;
        const cleaned = await query('cleanDiskCache', { budgetBytes: before.protectedBytes, execute: true });
        if (cleaned.removed.length !== 1 || cleaned.releaseBytes !== preview.releaseBytes || cleaned.indexPersisted !== false) throw Error('quota cleanup result was incorrect');
        full = false;
        await query('diskCache', { rescan: true });
        const after = await capture('after-cleanup');
        if (!first.bitmap.equals(after.bitmap)) throw Error('cleanup changed rendered pixels');
        evidence.cleanup = { before: before.usedBytes, after: cleaned.remainingBytes, released: cleaned.releaseBytes,
            protected: before.protectedBytes, atQuota: true, indexPersisted: cleaned.indexPersisted, pixelIdentical: true };
        offline = true;
        win.destroy();
        win = await boot();
        // A restart opens on the engine's ident, as every launch does: wait for the game under it as the updates above do,
        // rather than judge the frame half a second in, which is the ident's.
        let restart;
        const restartDeadline = Date.now() + 10_000;
        do { await sleep(100); restart = await capture('offline-restart'); }
        while (restart.pixel.some((c, i) => Math.abs(c - colors[2][i]) > 15) && Date.now() < restartDeadline);
        const status = await win.webContents.executeJavaScript('globalThis.__cacheAcceptance.status()');
        const report = await query('diskCache');
        if (restart.pixel.some((c, i) => Math.abs(c - colors[2][i]) > 15)
            || status.revision !== evidence.updates[2].revision || blockedDownloads.length
            || report.versions.some(v => v.reason && v.missing)) throw Error('offline mini-game restart did not preserve current/rollback');
        evidence.offline = { revision: status.revision, pixel: restart.pixel, blockedDownloads,
            protectedMissing: report.versions.filter(v => v.reason).map(v => ({ revision: v.revision, missing: v.missing })) };
        evidence.ok = true;
    } catch (e) { code = 1; evidence.ok = false; evidence.error = String(e?.stack ?? e); }
    finally {
        evidence.diagnostics = diagnostics.slice(-24);
        evidence.requests = requests;
        await mkdir(OUT, { recursive: true });
        await writeFile(path.join(OUT, 'verification.json'), JSON.stringify(evidence, null, 2));
        console.log('CACHE_RENDER_RESULT ' + JSON.stringify(evidence));
        win?.destroy(); await channel?.close(); server?.close(); app.exit(code);
    }
});
