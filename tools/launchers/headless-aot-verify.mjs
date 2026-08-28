// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Drives a REAL exported package and asks whether it is running the
 *        systems it promised to compile.
 *
 *        Every other AOT gate substitutes something: a synthetic project, a
 *        hand-written system, or a host built for the test. This one exports
 *        examples/ecs-basics through the CLI — the project that carries the
 *        corpus's only `@compiled` marker — serves the package, boots it, and
 *        reads the game host's own hook.
 *
 *        It asks DISPATCHED, not installed. A module can load and never be
 *        reached, and no comparison of positions can tell: the closure a twin
 *        replaced moves the entity to the same place.
 *
 *          pnpm exec electron tools/launchers/headless-aot-verify.mjs <packageDir>
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PACKAGE = path.resolve(process.argv[process.argv.length - 1]);
const W = 256, H = 256;

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.esscene': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.ktx2': 'application/octet-stream',
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
    if (!existsSync(path.join(PACKAGE, 'index.html'))) throw new Error(`no package at ${PACKAGE}`);
    // Asked of the CONFIG the host reads, which is where the module's path and
    // the inlined manifest actually live. This looked for `systems.json` at the
    // package root until now — a shape the export dropped, unnoticed, unrun.
    const config = JSON.parse(await readFile(path.join(PACKAGE, 'game.config.json'), 'utf8'));
    if (!config.aot) throw new Error('game.config.json carries no `aot` — the export compiled nothing');
    if (!config.aot.manifest?.systems?.length) throw new Error('the aot manifest declares no systems');
    if (!existsSync(path.join(PACKAGE, config.aot.module))) {
      throw new Error(`the config names ${config.aot.module}, which the package does not carry`);
    }

    server = await serve(PACKAGE);
    const url = `http://127.0.0.1:${server.address().port}/index.html?headless=1`;
    const win = new BrowserWindow({ show: false, width: W, height: H });
    win.webContents.on('console-message', (_e, _l, m) => {
      if (/error|fail|refus|exception|wasm/i.test(m)) diag.push(String(m).slice(0, 200));
    });
    await win.loadURL(url);

    const exec = (code) => win.webContents.executeJavaScript(code, true);
    let ready = false;
    for (let i = 0; i < 150 && !ready; i++) {
      ready = await exec('!!(window.__estellaCooked && window.__estellaCooked.compiled)').catch(() => false);
      if (!ready) await sleep(100);
    }
    if (!ready) throw new Error('the game host hook never appeared (boot failed?)');

    // Dispatched, and repeatedly: one call could be a startup pass.
    const WANT_CALLS = 10;
    // Waited for, not slept through: a fixed 1.5s is a frame COUNT, and a runner
    // with no GPU draws about four in it — six calls from a module that had
    // loaded and was dispatching fine. The bar itself does not move.
    let got = await exec('window.__estellaCooked.compiled()');
    for (let i = 0; i < 100 && got.calls < WANT_CALLS; i++) {
      await sleep(100);
      got = await exec('window.__estellaCooked.compiled()');
    }
    const installedOk = got.installed.includes('MoveSystem');
    const dispatchedOk = got.calls >= WANT_CALLS;
    const ok = installedOk && dispatchedOk;
    console.log(`\n[verify:aot] ${ok ? 'PASS' : 'FAIL'} — installed ${JSON.stringify(got.installed)}, ${got.calls} twin call(s)`);
    console.log('DRIVE_RESULT ' + JSON.stringify({ ...got, installedOk, dispatchedOk, diag: diag.slice(0, 6) }));
    failed = !ok;
  } catch (e) {
    console.log('\n[verify:aot] FAIL — ' + (e?.message ?? e));
    console.log('DRIVE_RESULT ' + JSON.stringify({ error: String(e?.message ?? e), diag: diag.slice(0, 6) }));
    failed = true;
  } finally {
    try { server?.close(); } catch { /* ignore */ }
    // app.exit, not exitCode: Electron reports 0 whatever exitCode says.
    app.exit(failed ? 1 : 0);
  }
});
