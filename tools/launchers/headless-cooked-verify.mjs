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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COOKED = path.join(ROOT, 'pipeline', '.cooked-verify');
/** The same fixture packaged without its compiled systems. */
const INTERP = path.join(ROOT, 'pipeline', '.cooked-verify-interp');
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

/** Wait for the boot hook, or give up. Boot is async: wasm, then the scene. */
async function waitForHook(exec) {
  for (let i = 0; i < 150; i++) {
    if (await exec('!!window.__estellaCooked').catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}

/**
 * How far the compiled entity travels over a FIXED number of FIXED steps.
 *
 * Not over half a second of wall clock: the loop is browser-scheduled, so two
 * runs of one package disagree by more than a wrong field offset does, and a
 * comparison built on it measures the runner.
 */
async function drift(exec, diag) {
  const before = await exec("window.__estellaCooked.probe(['Drifter']).at.Drifter");
  await exec('window.__estellaCooked.step(60, 1/60)');
  const after = await exec("window.__estellaCooked.probe(['Drifter']).at.Drifter");
  if (!before || !after) { diag.push(`no Drifter in the world (before=${!!before} after=${!!after})`); return null; }
  return { x: after.x - before.x, y: after.y - before.y };
}

/** The same measurement, on a package this run has not otherwise opened. */
async function driftOf(dir, diag) {
  let server;
  let win;
  try {
    server = await serve(dir);
    win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/index.html?headless=1`);
    const exec = (code) => win.webContents.executeJavaScript(code, true);
    if (!await waitForHook(exec)) { diag.push(`${path.basename(dir)}: hook never appeared`); return null; }
    // The hook exists before the scene does; the entity this measures arrives
    // with the scene, so probing on the hook alone finds an empty world.
    await sleep(1000);
    return await drift(exec, diag);
  } catch (e) {
    diag.push(`${path.basename(dir)}: ${e?.message ?? e}`);
    return null;
  } finally {
    try { win?.destroy(); } catch { /* already gone */ }
    try { server?.close(); } catch { /* ignore */ }
  }
}

app.whenReady().then(async () => {
  let server;
  let failed = true;
  const diag = [];
  // The twin's own channel: the main window's console filter fills six slots
  // with WebGL noise, and the report then says nothing about why it returned null.
  const twinDiag = [];
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
    if (!await waitForHook(exec)) throw new Error('gameHost capture hook never appeared (boot failed?)');
    await sleep(1000);

    const cap = await exec(`(() => {
      const c = window.__estellaCooked.capture();
      const { width: w, height: h, rgba } = c;
      const at = (x, y) => { const X = Math.round(x*(w-1)); const Y = (h-1)-Math.round(y*(h-1)); const i=(Y*w+X)*4; return [rgba[i], rgba[i+1], rgba[i+2]]; };
      return { w, h, left: at(0.3, 0.5), right: at(0.7, 0.5), corner: at(0.04, 0.04) };
    })()`);

    // The AOT road in the shipped runtime: the module installed, and the entity
    // only a compiled system touches is moving. Nothing draws it, so this claim
    // and the pixel ones stay independent.
    const compiledSystems = await exec('window.__estellaCooked.compiledSystems()');
    const moved = await drift(exec, diag);
    // What the interpreted twin computes over the SAME steps. Wall clock is out
    // of it, so this compares arithmetic and not the runner's scheduler: a twin
    // reading one field from the wrong offset lands somewhere else here.
    const twin = await driftOf(INTERP, twinDiag);
    // Relative, at the width the value is STORED in: position is f32, so the
    // same arithmetic rounds differently from the two runs' different starting
    // magnitudes. A wrong field is off by the whole displacement, not by an ulp.
    const same = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a));
    const aotOk = compiledSystems >= 1 && moved !== null && twin !== null
      && same(moved.x, twin.x) && same(moved.y, twin.y)
      && Math.abs(moved.x) > 1;

    // Left quad = the KTX2 texture (green); right quad = the PATH-referenced
    // material chain (its shader paints u_tint red) — proving the cooked
    // logical→staged resolution end to end, not just uuid refs.
    const [lr, lg, lb] = cap.left;
    const greenOk = Math.abs(lg - 180) <= 70 && lr <= 70 && lb <= 70;
    const [rr, rg, rb] = cap.right;
    const redOk = rr >= 180 && rg <= 70 && rb <= 70;
    const cornerBlack = cap.corner[0] <= 40 && cap.corner[1] <= 40 && cap.corner[2] <= 40;
    const ok = greenOk && redOk && cornerBlack && aotOk;
    console.log(`\n[verify:render:cooked] ${ok ? 'PASS' : 'FAIL'}`);
    console.log('DRIVE_RESULT ' + JSON.stringify({
      ...cap, greenOk, redOk, cornerBlack,
      aotOk, compiledSystems, drift: { compiled: moved, interpreted: twin },
      diag: diag.slice(0, 6), twinDiag: twinDiag.slice(0, 4),
    }));
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
