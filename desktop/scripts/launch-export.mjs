// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  launch-export.mjs — a packaged web build actually starts, and draws.
 *
 * Exporting is checked (export-project reports errors, warnings and size) and
 * the ENGINE is checked (verify:render). Between them sits the thing nobody ran
 * in CI: the package itself, opened the way a player opens it. That gap is
 * where a wrong export default, a missing runtime config or a path that only
 * resolves in the editor survives every green check and ships.
 *
 * Serves the export over http (a build fetches its manifest and assets; file://
 * refuses those) and asks the same two questions verify-native-boot asks of a
 * native package: did it reach ready, and is the frame more than one flat
 * colour — because a build that boots to black passes every other check.
 *
 *   electron desktop/scripts/launch-export.mjs --dir <exportDir> [options]
 *     --out <file.png>   write the captured frame
 *     --w / --h          surface size (default 640x360)
 *     --settle <n>       frames to let run before capturing (default 30)
 *     --timeout <ms>     how long to wait for the first frame (default 30000)
 *     --allow-flat       accept a single-colour frame (a deliberately blank scene)
 *     --input <json>     drive it: {"keys":["ArrowRight"]} or {"pointer":{"x":.5,"y":.5}}
 *     --touch            present as a touch device (maxTouchPoints > 0), so a
 *                        build that puts its on-screen controls up for one can
 *                        be driven the way a phone would drive it
 *     --safe-area t,r,b,l  a screen with insets (a notch, a home bar), via the
 *                        CSS variables the web platform reads
 *     --probe a,b,c      after settling, print where those named entities are
 *                        (opens the package with ?headless)
 *     --log <regex>      also print console lines matching this (the engine's own
 *                        warnings say why a subsystem sat out; only `[engine]`
 *                        lines are forwarded otherwise, which means diagnosing
 *                        one costs a probe planted in the game)
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRendererConsole } from './rendererConsole.mjs';
import { inputScript } from './inputScript.mjs';

// Headless / GPU-less (CI) WebGL2 falls back to SwiftShader; harmless with a GPU.
// Without it Chromium refuses the context outright and the package boots to
// "WebGL2 is not available" — which is a runner without a GPU, not a broken game.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// capturePage pixels go through the OS display profile; pin sRGB so a colour
// judgement reads the same on a wide-gamut machine as on a CI runner.
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// A desktop Chromium reports no touch hardware, so a game that only shows its
// on-screen controls to a touch device shows them to nobody here. This is the
// emulation a phone would make true.
if (process.argv.includes('--touch')) {
  app.commandLine.appendSwitch('touch-events', 'enabled');
  app.commandLine.appendSwitch('enable-features', 'TouchpadAndWheelScrollLatching');
}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const DIR = path.resolve(flag('dir', ''));
const OUT = flag('out', '');
const W = Number(flag('w', '640'));
const H = Number(flag('h', '360'));
const SETTLE = Number(flag('settle', '30'));
const INPUT = flag('input', '');
const TIMEOUT = Number(flag('timeout', '30000'));
const LOG = flag('log', '');
const logRe = LOG ? new RegExp(LOG, 'i') : null;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.esv': 'video/mp4', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.atlas': 'text/plain', '.skel': 'application/octet-stream', '.txt': 'text/plain',
};

/** Serve the export directory. Range requests are not implemented: a build that
 *  needs them (video seek) would read as a broken asset here, not a broken server. */
function serve(root, safeArea) {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      if (rel === '') rel = 'index.html';
      const abs = path.join(root, rel);
      if (!abs.startsWith(root)) { res.writeHead(403).end(); return; }
      let bytes = await readFile(abs);
      // Insets have to exist before the first script runs: the engine reads
      // them once when its UI plugins build, and a variable set from the
      // outside after that is a variable nobody ever asks about again.
      if (safeArea && rel === 'index.html') {
        const [t = 0, r = 0, b = 0, l = 0] = safeArea.split(',').map(Number);
        const html = String(bytes);
        const injected = html.replace(
          '<head>',
          `<head><style>:root{--sat:${t}px;--sar:${r}px;--sab:${b}px;--sal:${l}px}</style>`,
        );
        if (injected === html) console.log('  safe-area: no <head> to inject into');
        bytes = Buffer.from(injected);
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' })
        .end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Is more than one colour on screen? The question a boot-to-black build fails. */
function frameIsLive(image) {
  const { width, height } = image.getSize();
  const buf = image.toBitmap(); // BGRA
  const first = [buf[0], buf[1], buf[2]];
  const step = Math.max(1, Math.floor((width * height) / 4000));
  for (let p = 0; p < width * height; p += step) {
    const i = p * 4;
    if (Math.abs(buf[i] - first[0]) > 8 || Math.abs(buf[i + 1] - first[1]) > 8 || Math.abs(buf[i + 2] - first[2]) > 8) {
      return true;
    }
  }
  return false;
}

async function main() {
  if (!DIR || !existsSync(path.join(DIR, 'index.html'))) {
    console.error(`✗ no index.html under ${DIR || '(--dir not given)'}`);
    app.exit(2);
    return;
  }
  const PROBE = flag('probe', '');
  const server = await serve(DIR, flag('safe-area', ''));
  const base = `http://127.0.0.1:${server.address().port}/${PROBE ? '?headless' : ''}`;

  const win = new BrowserWindow({
    // Content size, not window size: with the frame counted in, the surface came
    // out shorter than asked for, and a capture compared against another surface
    // is only meaningful when the size requested is the size rendered.
    width: W, height: H, useContentSize: true, show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await win.webContents.session.clearCache();

  const errors = [];
  const stop = onRendererConsole(win.webContents, (msg) => {
    if (/error|uncaught|failed/i.test(msg)) errors.push(msg.slice(0, 300));
    if (msg.startsWith('[engine]') || logRe?.test(msg)) console.log(`  ${msg}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`render process gone: ${d.reason}`));

  await win.loadURL(base);

  // Wait for a real frame rather than a wall-clock guess: the engine paints when
  // its wasm and assets are in, which is exactly the part a package can get wrong.
  const painted = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const deadline = Date.now() + ${TIMEOUT};
      let frames = 0;
      const tick = () => {
        const c = document.querySelector('canvas');
        if (c && c.width > 0 && c.height > 0) frames++;
        if (frames >= ${SETTLE}) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })
  `).catch((e) => { errors.push(String(e)); return false; });

  // Drive the game, then let it run on.
  if (painted && INPUT) {
    const spec = JSON.parse(INPUT);
    const ran = await win.webContents.executeJavaScript(inputScript(spec))
      .catch((e) => { errors.push(`input: ${e}`); return -1; });
    console.log(`  input: ${ran} source(s) over ${Number(spec.frames ?? 40)} frames`);
  }

  if (PROBE) {
    const names = PROBE.split(',').map((n) => n.trim()).filter(Boolean);
    const seen = await win.webContents.executeJavaScript(
      `window.__estellaCooked?.probe(${JSON.stringify(names)}) ?? null`,
    ).catch((e) => ({ error: String(e) }));
    console.log(`  probe: ${JSON.stringify(seen)}`);
  }

  const image = await win.webContents.capturePage();
  if (OUT) await writeFile(OUT, image.toPNG());
  stop();
  server.close();

  const live = frameIsLive(image);
  const ok = painted && live && errors.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${path.basename(DIR)} — painted=${painted} live=${live} errors=${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
  if (!painted) console.log('    no canvas ever sized — the package did not start');
  if (painted && !live && !has('allow-flat')) console.log('    one flat colour — it started and drew nothing');
  app.exit(ok || (live === false && has('allow-flat') && painted && !errors.length) ? 0 : 1);
}

app.whenReady().then(main).catch((e) => {
  console.error('✗ launch-export failed:', e);
  app.exit(2);
});
