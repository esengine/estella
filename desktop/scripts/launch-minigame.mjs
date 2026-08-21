// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  launch-minigame.mjs — a packaged mini-game starts, and draws.
 *
 * The WeChat/Douyin counterpart of launch-export: same two questions (did it
 * reach a frame, is that frame more than one flat colour), asked of a package
 * no browser can open on its own. minigameHost supplies the CommonJS loader and
 * the `wx` global; this serves the export and judges the result.
 *
 * It stands in for the vendor, it does not impersonate it — see minigameHost.
 *
 *   electron desktop/scripts/launch-minigame.mjs --dir <exportDir> [options]
 *     --out <file.png>   write the captured frame
 *     --w / --h          surface size (default 640x360)
 *     --settle <n>       frames to let run before capturing (default 30)
 *     --timeout <ms>     how long to wait for the first frame (default 30000)
 *     --input <json>     drive it, same spec as launch-export
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRendererConsole } from '../../tools/lib/rendererConsole.mjs';
import { HOST_PAGE } from './minigameHost.mjs';
import { inputScript } from './inputScript.mjs';

// Headless / GPU-less (CI) WebGL2 falls back to SwiftShader; harmless with a GPU.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// Both of the above pin a machine's answer to the code's; so does this. A capture
// is in DEVICE pixels, so a scaled display returns a frame the editor's own
// capture cannot be compared against. Its twin launcher pins it for the same reason.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const DIR = path.resolve(flag('dir', ''));
const OUT = flag('out', '');
const W = Number(flag('w', '640'));
const H = Number(flag('h', '360'));
const SETTLE = Number(flag('settle', '30'));
const TIMEOUT = Number(flag('timeout', '30000'));
const INPUT = flag('input', '');

const MIME = {
  '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.atlas': 'text/plain', '.skel': 'application/octet-stream', '.txt': 'text/plain',
};

function serve(root, page) {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      if (rel === '' || rel === 'index.html') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(page);
        return;
      }
      const abs = path.join(root, rel);
      if (!abs.startsWith(root)) { res.writeHead(403).end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' })
        .end(await readFile(abs));
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function frameIsLive(image) {
  const { width, height } = image.getSize();
  const buf = image.toBitmap();
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
  const manifest = path.join(DIR, 'game.json');
  if (!existsSync(manifest)) {
    console.error(`✗ no game.json under ${DIR || '(--dir not given)'} — not a mini-game package`);
    app.exit(2);
    return;
  }
  // The vendor reads the entry from game.json's convention (game.js); assert it
  // is there rather than letting the loader 404 into a confusing stack.
  const entry = 'game.js';
  if (!existsSync(path.join(DIR, entry))) {
    console.error(`✗ ${entry} is missing — the package has a manifest and no entry`);
    app.exit(1);
    return;
  }
  JSON.parse(readFileSync(manifest, 'utf8')); // a manifest the vendor cannot parse is a dead package

  const server = await serve(DIR, HOST_PAGE(entry));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false,
    webPreferences: { backgroundThrottling: false },
  });

  const errors = [];
  const stop = onRendererConsole(win.webContents, (msg) => {
    if (/\[minigame\] boot failed|uncaught|is not a function|no such file/i.test(msg)) errors.push(msg.slice(0, 400));
    if (msg.startsWith('[minigame]') || msg.startsWith('[engine]')) console.log(`  ${msg}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`render process gone: ${d.reason}`));

  await win.loadURL(base);
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

  if (painted && INPUT) {
    const spec = JSON.parse(INPUT);
    const ran = await win.webContents.executeJavaScript(inputScript(spec))
      .catch((e) => { errors.push(`input: ${e}`); return -1; });
    console.log(`  input: ${ran} source(s) over ${Number(spec.frames ?? 40)} frames`);
  }

  const image = await win.webContents.capturePage();
  if (OUT) await writeFile(OUT, image.toPNG());
  stop();
  server.close();

  const live = frameIsLive(image);
  const ok = painted && live && errors.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${path.basename(DIR)} (mini-game) — painted=${painted} live=${live} errors=${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
  if (painted && !live) console.log('    one flat colour — it started and drew nothing');
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => {
  console.error('✗ launch-minigame failed:', e);
  app.exit(2);
});
