/**
 * @file  Headless render verification runner (docs/REARCH_EDITOR_AUTOMATION.md P1).
 *
 * A standalone Electron entry — NOT the editor's production main — that proves a
 * scene renders by driving the headless render host: it static-serves the built
 * dist/ over loopback http (an http origin is required; the engine resolves its
 * wasm glue from location.origin, which file:// roots wrong), opens a show:false
 * window on headless.html, then loadScene → step → captureViewport and asserts
 * the frame is actually rasterized (color variation, not a uniform clear).
 *
 * This is the repeatable, in-repo form of the capability — `pnpm verify:render`.
 * It runs by Electron (for a real WebGL2 context), so it imports only `electron`
 * and node built-ins. Parametrize via env to point it at other scenes:
 *   ESTELLA_VERIFY_SCENE     scene url   (default the dev sprite scene)
 *   ESTELLA_VERIFY_MANIFEST  texture manifest url
 *   ESTELLA_VERIFY_W / _H    capture size (default 640×480)
 *   ESTELLA_VERIFY_STEPS     fixed-dt frames to advance before capture (default 30)
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const SCENE = process.env.ESTELLA_VERIFY_SCENE ?? '/scenes/sprite-rendering.esscene';
const MANIFEST = process.env.ESTELLA_VERIFY_MANIFEST ?? '/scenes/sprite-rendering.textures.json';
const W = Number(process.env.ESTELLA_VERIFY_W) || 640;
const H = Number(process.env.ESTELLA_VERIFY_H) || 480;
const STEPS = Number(process.env.ESTELLA_VERIFY_STEPS) || 30;

// Headless / GPU-less (CI) WebGL2 falls back to SwiftShader; harmless with a GPU.
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
      if (!abs.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
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
  const ok = result.ok && result.capture?.rendered;
  console.log(`\n[verify:render] ${ok ? 'PASS' : 'FAIL'} — ${SCENE}`);
  console.log('DRIVE_RESULT ' + JSON.stringify(result));
  process.exitCode = ok ? 0 : 1;
  try {
    server?.close();
  } catch {
    /* ignore */
  }
  app.quit();
}

app.whenReady().then(async () => {
  let server;
  try {
    server = await serveDist();
    const url = `http://127.0.0.1:${server.address().port}/headless.html?w=${W}&h=${H}`;

    const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    win.webContents.on('console-message', (...args) => {
      const msg = args.map((a) => (a && typeof a === 'object' ? a.message ?? '' : String(a))).join(' ');
      if (/error|fail|unwind|exception|webgl/i.test(msg)) console.log('[renderer]', msg.slice(0, 240));
    });
    await win.loadURL(url);

    const exec = (code) => win.webContents.executeJavaScript(code, true);
    await exec('window.__estellaHeadless.ready');
    const entityCount = await exec(
      `window.__estellaHeadless.api.loadScene(${JSON.stringify(SCENE)}, ${JSON.stringify(MANIFEST)})`,
    );
    await exec(`window.__estellaHeadless.api.step(${STEPS}, 1 / 60)`);
    const capture = await exec(`(() => {
      const c = window.__estellaHeadless.api.captureViewport();
      const px = c.rgba; const min = [255, 255, 255], max = [0, 0, 0]; let nonZero = 0;
      for (let i = 0; i < px.length; i += 4) {
        for (let k = 0; k < 3; k++) { const v = px[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
        if (px[i] | px[i + 1] | px[i + 2]) nonZero++;
      }
      const spread = (max[0] - min[0]) + (max[1] - min[1]) + (max[2] - min[2]);
      return { w: c.width, h: c.height, totalPixels: px.length / 4, nonZeroPixels: nonZero, min, max, spread, rendered: spread > 16 };
    })()`);
    finish({ ok: true, entityCount, capture }, server);
  } catch (e) {
    finish({ ok: false, error: String((e && e.stack) || e) }, server);
  }
});

setTimeout(() => finish({ ok: false, error: 'timeout' }), 45000);
