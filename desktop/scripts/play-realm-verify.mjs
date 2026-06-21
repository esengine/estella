/**
 * @file  Play-realm verification runner (REARCH_EDITOR_REALM Phase R1).
 *
 * Proves the isolated play realm boots the SHIPPING runtime against a posted
 * scene snapshot + a fetched asset manifest — the play==ship path, in isolation
 * from the editor. Static-serves dist/ over loopback http, opens a show:false
 * window on play.html, posts an `estella:play:init` with a real scene snapshot +
 * uuid→url manifest, and waits for the realm's `estella:play:ready` handshake
 * (reaching ready means createWebApp + initRuntime + asset fetch + app.run all
 * succeeded). A capturePage spread check is reported as bonus evidence.
 *
 * Runs by Electron (real WebGL2). `pnpm --filter ./desktop play:verify`.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SCENE = process.env.ESTELLA_VERIFY_SCENE ?? '/scenes/sprite-rendering.esscene';
const MANIFEST = process.env.ESTELLA_VERIFY_MANIFEST ?? '/scenes/sprite-rendering.textures.json';
const W = 640;
const H = 480;

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.esscene': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

function serveDist() {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const abs = path.join(DIST, rel);
      if (!abs.startsWith(DIST)) return void res.writeHead(403).end();
      const bytes = await readFile(abs);
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' });
      res.end(bytes);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function finish(result, server) {
  const ok = result.ok && result.handshake === 'estella:play:ready';
  console.log(`\n[play:verify] ${ok ? 'PASS' : 'FAIL'} — ${SCENE}`);
  console.log('DRIVE_RESULT ' + JSON.stringify(result));
  process.exitCode = ok ? 0 : 1;
  try { server?.close(); } catch { /* ignore */ }
  app.quit();
}

app.whenReady().then(async () => {
  let server;
  try {
    server = await serveDist();
    const base = `http://127.0.0.1:${server.address().port}`;
    const sceneData = JSON.parse(await readFile(path.join(DIST, SCENE.replace(/^\//, '')), 'utf8'));
    const assetManifest = JSON.parse(await readFile(path.join(DIST, MANIFEST.replace(/^\//, '')), 'utf8'));

    const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    win.webContents.on('console-message', (...a) => {
      const m = a.map((x) => (x && typeof x === 'object' ? x.message ?? '' : String(x))).join(' ');
      if (/error|fail|exception|webgl/i.test(m) && !/unwind/i.test(m)) console.log('[realm]', m.slice(0, 240));
    });
    await win.loadURL(`${base}/play.html`);
    const exec = (code) => win.webContents.executeJavaScript(code, true);

    // Record the realm's outbound handshake, then post the scene snapshot in.
    await exec(`window.__msgs=[];addEventListener('message',e=>{if(e.data&&String(e.data.type||'').startsWith('estella:play:'))window.__msgs.push(e.data)});true`);
    await exec(`window.postMessage(${JSON.stringify({ type: 'estella:play:init', sceneData, assetManifest })},'*');true`);

    const msg = await exec(`(async()=>{for(let i=0;i<400;i++){const m=(window.__msgs||[]).find(x=>x.type==='estella:play:ready'||x.type==='estella:play:error');if(m)return m;await new Promise(r=>setTimeout(r,50));}return{type:'timeout'};})()`);

    let capture = null;
    try {
      const img = await win.capturePage();
      const b = img.toBitmap(); // BGRA
      const min = [255, 255, 255], max = [0, 0, 0];
      let nonZero = 0;
      for (let i = 0; i < b.length; i += 4) {
        for (let k = 0; k < 3; k++) { const v = b[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
        if (b[i] | b[i + 1] | b[i + 2]) nonZero++;
      }
      capture = { spread: (max[0] - min[0]) + (max[1] - min[1]) + (max[2] - min[2]), nonZeroPixels: nonZero };
    } catch (e) {
      capture = { error: String(e) };
    }

    finish({ ok: true, handshake: msg.type, detail: msg, capture }, server);
  } catch (e) {
    finish({ ok: false, error: String((e && e.stack) || e) }, server);
  }
});

setTimeout(() => finish({ ok: false, error: 'timeout' }), 45000);
