// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Render-verifies a HOT UPDATE end-to-end against the shipped runtime.
 *        One loopback origin serves the shipped `build/` at `/` and the `cdn/`
 *        update under `/cdn/` (same origin, so the cooked build's CSP allows the
 *        update fetch — a different port would be a different origin and blocked).
 *        Boots the shipped game headless, asserts it renders GREEN (fetched from
 *        the `remote` group), drives `__estellaCooked.applyRemoteUpdate(...)`, and
 *        asserts the SAME running game now renders RED — proving a changed
 *        `remote` asset reaches the client from the CDN with no re-ship.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.hotupdate-verify');
const BUILD = path.join(ROOT, 'build');
const CDN = path.join(ROOT, 'cdn');
const W = 256, H = 256;

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.esscene': 'application/json',
  '.wasm': 'application/wasm', '.ktx2': 'application/octet-stream', '.png': 'image/png',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One origin: `/cdn/...` serves the update build, everything else the ship build. */
function serve(buildDir, cdnDir) {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      let dir = buildDir;
      if (rel === 'cdn' || rel.startsWith('cdn/')) { dir = cdnDir; rel = rel.slice(4); }
      rel = rel || 'index.html';
      const abs = path.join(dir, rel);
      if (!abs.startsWith(dir)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(abs);
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' });
      res.end(bytes);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

app.whenReady().then(async () => {
  let server;
  const diag = [];
  let before = null, after = null, changed = 0;
  try {
    server = await serve(BUILD, CDN);
    const base = `http://127.0.0.1:${server.address().port}`;

    const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    win.webContents.on('console-message', (...a) => {
      const m = a.map((x) => (x && typeof x === 'object' ? x.message ?? '' : String(x))).join(' ');
      if (/error|fail|unwind|exception|webgl|update|group|manifest/i.test(m)) diag.push(m.slice(0, 200));
    });
    await win.loadURL(`${base}/index.html?headless=1`);

    const exec = (code) => win.webContents.executeJavaScript(code, true);
    let ready = false;
    for (let i = 0; i < 150 && !ready; i++) { ready = await exec('!!window.__estellaCooked').catch(() => false); if (!ready) await sleep(100); }
    if (!ready) throw new Error('gameHost capture hook never appeared (boot failed?)');
    await sleep(1800); // demo system fetches the cdn group + stamps the texture

    const center = `(() => { const c = window.__estellaCooked.capture(); const { width: w, height: h, rgba } = c; const i = (((h >> 1) * w) + (w >> 1)) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]]; })()`;
    before = await exec(center);

    const upd = await exec(`window.__estellaCooked.applyRemoteUpdate(${JSON.stringify(`${base}/cdn/asset-manifest.json`)}, ${JSON.stringify(`${base}/cdn`)})`);
    changed = upd && typeof upd.changed === 'number' ? upd.changed : 0;
    await sleep(1800);
    after = await exec(center);

    const isGreen = ([r, g, b]) => g >= 130 && r <= 110 && b <= 120;
    const isRed = ([r, g, b]) => r >= 150 && g <= 100 && b <= 100;
    const ok = isGreen(before) && isRed(after) && changed >= 1;

    console.log(`\n[verify:render:hotupdate] ${ok ? 'PASS' : 'FAIL'}`);
    console.log('DRIVE_RESULT ' + JSON.stringify({ before, after, changed, greenBefore: isGreen(before), redAfter: isRed(after), diag: diag.slice(0, 8) }));
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.log('\n[verify:render:hotupdate] FAIL — ' + (e?.message ?? e));
    console.log('DRIVE_RESULT ' + JSON.stringify({ error: String(e?.message ?? e), before, after, changed, diag: diag.slice(0, 8) }));
    process.exitCode = 1;
  } finally {
    try { server?.close(); } catch { /* ignore */ }
    app.quit();
  }
});
