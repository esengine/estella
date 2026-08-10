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
 *        Then drives two updates that MUST be refused whole (a manifest whose
 *        hash the bytes do not match, and one naming an asset that is not
 *        there) and asserts the game is still red — an update either lands or
 *        leaves the player where they were.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRendererConsole } from './rendererConsole.mjs';

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

/** A hash no file has, so a manifest carrying it is lying about its bytes. */
const BOGUS_HASH = 'ffffffffffffffff';

/**
 * The two manifests a good client must refuse, built from the SHIPPED one so the
 * asset they point at is the GREEN art: an update that half-applies is then
 * visible as the game going back to green, which a red-to-red comparison could
 * never show. Keyed by the url prefix each is served under.
 */
function brokenManifests(buildManifestJson) {
  const artOf = (m) => {
    const assets = m.groups?.cdn?.assets ?? {};
    const key = Object.keys(assets)[0];
    if (!key) throw new Error('the shipped manifest has no cdn group to break');
    return assets[key];
  };
  const tampered = JSON.parse(buildManifestJson);
  artOf(tampered).contentHash = BOGUS_HASH;

  const gone = JSON.parse(buildManifestJson);
  const missing = artOf(gone);
  missing.contentHash = BOGUS_HASH;
  missing.path = `remote/cdn/assets/${BOGUS_HASH}.png`;

  return { tampered: JSON.stringify(tampered), gone: JSON.stringify(gone) };
}

/** One origin: `/cdn/...` serves the update build, `/tampered/` and `/gone/` the
 *  ship build under a manifest that lies, everything else the ship build. */
function serve(buildDir, cdnDir, broken) {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      let dir = buildDir;
      for (const [name, root] of [['cdn', cdnDir], ['tampered', buildDir], ['gone', buildDir]]) {
        if (rel !== name && !rel.startsWith(`${name}/`)) continue;
        dir = root;
        rel = rel.slice(name.length + 1);
        if (broken[name] && rel === 'asset-manifest.json') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(broken[name]);
          return;
        }
        break;
      }
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
  let failed = true;
  const refused = [];
  try {
    const broken = brokenManifests(await readFile(path.join(BUILD, 'asset-manifest.json'), 'utf8'));
    server = await serve(BUILD, CDN, broken);
    const base = `http://127.0.0.1:${server.address().port}`;

    const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    onRendererConsole(win.webContents, (m) => {
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

    // A broken update must leave the player exactly where they were. Both of
    // these are SEEN as an update (changed >= 1) and point at the green art, so
    // "nothing happened because nothing was offered" cannot pass for a rollback.
    for (const name of ['tampered', 'gone']) {
      const r = await exec(`window.__estellaCooked.applyRemoteUpdate(`
        + `${JSON.stringify(`${base}/${name}/asset-manifest.json`)}, ${JSON.stringify(`${base}/${name}`)})`);
      await sleep(1200);
      const pixel = await exec(center);
      refused.push({
        name,
        offered: r?.changed ?? 0,
        applied: !!r?.applied,
        failed: r?.failed ?? 0,
        pixel,
        ok: (r?.changed ?? 0) >= 1 && !r?.applied && (r?.failed ?? 0) >= 1 && isRed(pixel),
      });
    }

    const ok = isGreen(before) && isRed(after) && changed >= 1 && refused.every((r) => r.ok);

    console.log(`\n[verify:render:hotupdate] ${ok ? 'PASS' : 'FAIL'}`);
    console.log('DRIVE_RESULT ' + JSON.stringify({ before, after, changed, greenBefore: isGreen(before), redAfter: isRed(after), refused, diag: diag.slice(0, 8) }));
    failed = !ok;
  } catch (e) {
    console.log('\n[verify:render:hotupdate] FAIL — ' + (e?.message ?? e));
    console.log('DRIVE_RESULT ' + JSON.stringify({ error: String(e?.message ?? e), before, after, changed, refused, diag: diag.slice(0, 8) }));
    failed = true;
  } finally {
    try { server?.close(); } catch { /* ignore */ }
    // app.exit, not process.exitCode + app.quit: Electron quits with status 0
    // whatever exitCode says, so a FAIL would be reported to the caller as a pass.
    app.exit(failed ? 1 : 0);
  }
});
