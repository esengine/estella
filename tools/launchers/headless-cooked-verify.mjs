// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Render-verifies a COOKED game build (the shipped runtime path), unlike
 *        headless-verify.mjs which drives the editor host. Static-serves the
 *        cooked build in .cooked-verify/ (produced by the cooked-verify fixture
 *        test), opens it in a show:false window with ?headless, waits for the
 *        gameHost capture hook, and asserts the content-addressed KTX2 sprite
 *        rendered green — proving runtimeLoader transcodes + uploads + draws KTX2
 *        and resolves content-addressed asset paths.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRendererConsole } from '../lib/rendererConsole.mjs';

const COOKED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', '.cooked-verify');
const W = 256, H = 256;

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.esscene': 'application/json',
  '.wasm': 'application/wasm', '.ktx2': 'application/octet-stream', '.png': 'image/png',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(dir) {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
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
  let failed = true;
  const diag = [];
  try {
    server = await serve(COOKED);
    const url = `http://127.0.0.1:${server.address().port}/index.html?headless=1`;
    const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    onRendererConsole(win.webContents, (m) => {
      if (/error|fail|unwind|exception|webgl|basis|ktx/i.test(m)) diag.push(m.slice(0, 200));
    });
    await win.loadURL(url);

    const exec = (code) => win.webContents.executeJavaScript(code, true);
    // Boot is async (wasm + scene load); poll for the capture hook, then let it render.
    let ready = false;
    for (let i = 0; i < 150 && !ready; i++) { ready = await exec('!!window.__estellaCooked').catch(() => false); if (!ready) await sleep(100); }
    if (!ready) throw new Error('gameHost capture hook never appeared (boot failed?)');
    await sleep(1000);

    const cap = await exec(`(() => {
      const c = window.__estellaCooked.capture();
      const { width: w, height: h, rgba } = c;
      const at = (x, y) => { const X = Math.round(x*(w-1)); const Y = (h-1)-Math.round(y*(h-1)); const i=(Y*w+X)*4; return [rgba[i], rgba[i+1], rgba[i+2]]; };
      return { w, h, left: at(0.3, 0.5), right: at(0.7, 0.5), corner: at(0.04, 0.04) };
    })()`);

    // Left quad = the KTX2 texture (green); right quad = the PATH-referenced
    // material chain (its shader paints u_tint red) — proving the cooked
    // logical→staged resolution end to end, not just uuid refs.
    const [lr, lg, lb] = cap.left;
    const greenOk = Math.abs(lg - 180) <= 70 && lr <= 70 && lb <= 70;
    const [rr, rg, rb] = cap.right;
    const redOk = rr >= 180 && rg <= 70 && rb <= 70;
    const cornerBlack = cap.corner[0] <= 40 && cap.corner[1] <= 40 && cap.corner[2] <= 40;
    const ok = greenOk && redOk && cornerBlack;
    console.log(`\n[verify:render:cooked] ${ok ? 'PASS' : 'FAIL'}`);
    console.log('DRIVE_RESULT ' + JSON.stringify({ ...cap, greenOk, redOk, cornerBlack, diag: diag.slice(0, 6) }));
    failed = !ok;
  } catch (e) {
    console.log('\n[verify:render:cooked] FAIL — ' + (e?.message ?? e));
    console.log('DRIVE_RESULT ' + JSON.stringify({ error: String(e?.message ?? e), diag: diag.slice(0, 6) }));
    failed = true;
  } finally {
    try { server?.close(); } catch { /* ignore */ }
    // app.exit, not process.exitCode + app.quit: Electron quits with status 0
    // whatever exitCode says, so a FAIL would be reported to the caller as a pass.
    app.exit(failed ? 1 : 0);
  }
});
