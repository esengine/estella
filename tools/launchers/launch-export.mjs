// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  launch-export.mjs — a packaged web build actually starts, and draws.
 *
 * Exporting is checked (the pipeline reports errors, warnings and size) and
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
 *     --scene <name>     boot this named scene instead of the package's entry
 *     --allow-flat       accept a single-colour frame (a deliberately blank scene)
 *     --input <json>     drive it: {"keys":["ArrowRight"]} or {"pointer":{"x":.5,"y":.5}}
 *     --touch            present as a touch device (maxTouchPoints > 0), so a
 *                        build that puts its on-screen controls up for one can
 *                        be driven the way a phone would drive it
 *     --safe-area t,r,b,l  a screen with insets (a notch, a home bar), via the
 *                        CSS variables the web platform reads
 *     --probe a,b,c      after settling, print where those named entities are
 *                        (opens the package with ?headless)
 *     --particles a[,b]  after settling, print how many particles named emitters
 *                        are running — the far end of an effect chain
 *     --combat p:a[,b]   after settling, print the live swing and what each
 *                        named target has left
 *     --ai <enemy>       after settling, print what an autonomous character is
 *                        doing, and what the world let it do
 *     --render           after settling, print the renderer counters of the last
 *                        frame — draws, culls and LOD levels, which no pixel shows
 *     --facts            after settling, print what the GAME says about its run
 *     --gameplay p[,c]   after settling, print what the third-person character
 *                        IS: where it stands, what the physics step gave it, and
 *                        what its animator was told
 *     --frame-ms <n>     every rendered frame advances the game's clock by exactly n ms
 *                        (default one 60 Hz frame; 0 = the wall clock), so what N
 *                        frames of a package did does not depend on how fast this
 *                        machine draws
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
import { onRendererConsole } from '../lib/rendererConsole.mjs';
import { inputScript } from './inputScript.mjs';
import { networkProfile } from './networkProfiles.mjs';

// Headless / GPU-less (CI) WebGL2 falls back to SwiftShader; harmless with a GPU.
// Without it Chromium refuses the context outright and the package boots to
// "WebGL2 is not available" — which is a runner without a GPU, not a broken game.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// The GPU process keeps a sandbox of its own, which ELECTRON_DISABLE_SANDBOX
// does not reach: on a runner with no device it dies before the first frame.
app.commandLine.appendSwitch('disable-gpu-sandbox');
// ...and on Linux there is no GPU process at all — one launch per check races
// the service that answers for WebGL2, and in-process SwiftShader draws the same.
if (process.platform === 'linux') app.commandLine.appendSwitch('in-process-gpu');
// capturePage pixels go through the OS display profile; pin sRGB so a colour
// judgement reads the same on a wide-gamut machine as on a CI runner.
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// And pin the scale, for the same reason the editor's own driver does: a capture
// is in DEVICE pixels, so a scaled display returns a bigger frame than the editor
// it is compared against and parity refuses the pair for differing in size.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
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
/** Emulate a link before loading, so the start screen is asked a real question. */
const THROTTLE = flag('throttle', '');
/** Report when the first screen appeared and how its progress moved. */
const BOOT = has('boot');
const logRe = LOG ? new RegExp(LOG, 'i') : null;

/**
 * Installed ahead of the page's own scripts, in the page's world: the start
 * screen announces its boot on `window`, and a listener attached after the load
 * has already missed the stages that made the wait worth showing.
 */
const BOOT_RECORDER = `(() => {
  const marks = [];
  let firstFrame = null;
  addEventListener('esengine:bootprogress', (e) => marks.push({
    ms: Math.round(performance.now()),
    stage: e.detail && e.detail.stage,
    progress: e.detail && e.detail.progress,
    partial: !!(e.detail && e.detail.partial),
  }));
  addEventListener('esengine:firstframe', () => { firstFrame = Math.round(performance.now()); });
  window.__estellaBoot = () => {
    const paint = performance.getEntriesByType('paint')
      .find((p) => p.name === 'first-contentful-paint');
    return {
      firstScreenMs: paint ? Math.round(paint.startTime) : null,
      firstFrameMs: firstFrame,
      marks,
    };
  };
})();`;

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
/** Advances the page's clock once per rendered frame, by `ms`: the loop reads its
 *  delta off the rAF timestamp, and a slow runner's frame would otherwise hand a
 *  game a quarter of a second at a time. */
const clockScript = (ms) => `<script>(() => {
  let now = performance.now(); let frame = -1;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((real) => {
    if (real !== frame) { frame = real; now += ${ms}; }
    cb(now);
  });
})();</script>`;

function serve(root, safeArea, frameMs) {
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
      if ((safeArea || frameMs) && rel === 'index.html') {
        const [t = 0, r = 0, b = 0, l = 0] = safeArea.split(',').map(Number);
        const head = (frameMs ? clockScript(frameMs) : '')
          + (safeArea ? `<style>:root{--sat:${t}px;--sar:${r}px;--sab:${b}px;--sal:${l}px}</style>` : '');
        const html = String(bytes);
        const injected = html.replace('<head>', `<head>${head}`);
        if (injected === html) console.log('  no <head> to inject the safe area or clock into');
        bytes = Buffer.from(injected);
      }
      // Content-Length, which node omits unless told (it chunks instead): every
      // real server sends it, and a loader that reports download progress has
      // nothing to divide by without it.
      res.writeHead(200, {
        'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
        'content-length': bytes.length,
      }).end(bytes);
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
const FACTS = has('facts');
/** What residency did — which cells exist, and what the subsystems still hold. */
const STREAMING = has('streaming');
const GAMEPLAY = flag('gameplay', '');
const PARTICLES = flag('particles', '');
const COMBAT = flag('combat', '');
const AI = flag('ai', '');
const RENDER = has('render');
/** Boot a named scene from the package instead of its entry. */
const SCENE = flag('scene', '');
  const server = await serve(DIR, flag('safe-area', ''), Number(flag('frame-ms', String(1000 / 60))));
  const query = new URLSearchParams();
  if (PROBE || GAMEPLAY || PARTICLES || COMBAT || AI || RENDER || FACTS || STREAMING) query.set('headless', '');
  if (SCENE) query.set('scene', SCENE);
  const search = query.toString() ? `?${query.toString().replace(/=$/, '').replace(/=&/g, '&')}` : '';
  const base = `http://127.0.0.1:${server.address().port}/${search}`;

  const win = new BrowserWindow({
    // Content size, not window size: with the frame counted in, the surface came
    // out shorter than asked for, and a capture compared against another surface
    // is only meaningful when the size requested is the size rendered.
    width: W, height: H, useContentSize: true, show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await win.webContents.session.clearCache();

  const errors = [];
  // Every line, not just the angry ones: when a package never draws, what it got
  // through before stopping is the whole diagnosis, and none of it says "error".
  const recent = [];
  const stop = onRendererConsole(win.webContents, (msg) => {
    recent.push(msg.slice(0, 200));
    if (recent.length > 12) recent.shift();
    if (/error|uncaught|failed/i.test(msg)) errors.push(msg.slice(0, 300));
    if (msg.startsWith('[engine]') || logRe?.test(msg)) console.log(`  ${msg}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`render process gone: ${d.reason}`));

  // Before the load, and through Chrome's own emulation rather than a hand-rolled
  // server: the numbers are the vendor's, and a recorder installed here runs in
  // the page's own world ahead of every script the page carries.
  if (THROTTLE || BOOT) {
    // A window that has never navigated answers no CDP command — `Page.enable`
    // simply never resolves. One blank document is enough to make it a page.
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    if (THROTTLE) {
      const link = networkProfile(THROTTLE);
      await win.webContents.debugger.sendCommand('Network.enable');
      await win.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
        offline: false,
        latency: link.latency,
        downloadThroughput: link.downloadThroughput,
        uploadThroughput: link.uploadThroughput,
      });
      console.log(`  link: ${THROTTLE} — ${link.note}`);
    }
    if (BOOT) {
      await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: BOOT_RECORDER,
      });
    }
  }

  await win.loadURL(base);

  // A boot measurement waits for the boot, not for a canvas with a size: the
  // splash covers a canvas that exists from the first byte of HTML, so the frame
  // gate below is satisfied long before the game has anything to draw.
  if (BOOT) {
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const deadline = Date.now() + ${TIMEOUT};
        const tick = () => {
          if (window.__estellaBoot?.().firstFrameMs != null) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          setTimeout(tick, 100);
        };
        tick();
      })
    `).catch((e) => { errors.push(String(e)); return false; });
  }

  // Wait for a real frame rather than a wall-clock guess: the engine paints when
  // its wasm and assets are in, which is exactly the part a package can get wrong.
  const paint = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const deadline = Date.now() + ${TIMEOUT};
      let frames = 0;
      const tick = () => {
        const c = document.querySelector('canvas');
        if (c && c.width > 0 && c.height > 0) frames++;
        if (frames >= ${SETTLE}) return resolve({ ok: true, frames });
        if (Date.now() > deadline) return resolve({ ok: false, frames });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })
  `).catch((e) => { errors.push(String(e)); return { ok: false, frames: -1 }; });
  const painted = paint.ok;

  // Drive the game, then let it run on.
  if (painted && INPUT) {
    const spec = JSON.parse(INPUT);
    const ran = await win.webContents.executeJavaScript(inputScript(spec))
      .catch((e) => { errors.push(`input: ${e}`); return -1; });
    console.log(`  input: ${ran} source(s) over ${Number(spec.frames ?? 40)} frames`);
  }

  if (FACTS) {
    const seen = await win.webContents.executeJavaScript(
      'window.__estellaCooked?.facts() ?? null',
    ).catch((e) => ({ error: String(e) }));
    console.log(`  facts: ${JSON.stringify(seen)}`);
  }
  if (PROBE) {
    const names = PROBE.split(',').map((n) => n.trim()).filter(Boolean);
    const seen = await win.webContents.executeJavaScript(
      `window.__estellaCooked?.probe(${JSON.stringify(names)}) ?? null`,
    ).catch((e) => ({ error: String(e) }));
    console.log(`  probe: ${JSON.stringify(seen)}`);
  }

  if (BOOT) {
    const seen = await win.webContents.executeJavaScript('window.__estellaBoot?.() ?? null')
      .catch((e) => ({ error: String(e) }));
    // Monotonic is the claim, not "reached 100%": a bar that goes back is worse
    // than one that stops, and only the sequence can say which happened.
    const steps = (seen?.marks ?? []).map((m) => m.progress);
    const backwards = steps.findIndex((p, i) => i > 0 && p < steps[i - 1]);
    // The longest the bar stood still while the player was looking at it —
    // measured from the screen appearing to the frame arriving, so a stage that
    // reports nothing for its whole length is counted rather than averaged away.
    const at = [seen?.firstScreenMs, ...(seen?.marks ?? []).map((m) => m.ms), seen?.firstFrameMs]
      .filter((n) => typeof n === 'number');
    const stillMs = at.reduce((worst, n, i) => (i > 0 ? Math.max(worst, n - at[i - 1]) : worst), 0);
    console.log(`  boot: ${JSON.stringify({ ...seen, monotonic: backwards < 0, stillMs })}`);
    if (backwards >= 0) errors.push(`the boot bar went backwards at step ${backwards}`);
  }

  if (STREAMING) {
    const seen = await win.webContents.executeJavaScript(
      'window.__estellaCooked?.streaming() ?? null',
    ).catch((e) => ({ error: String(e) }));
    console.log(`  streaming: ${JSON.stringify(seen)}`);
  }

  if (GAMEPLAY) {
    const [player, camera] = GAMEPLAY.split(',').map((n) => n.trim());
    const seen = await win.webContents.executeJavaScript(
      `window.__estellaCooked?.gameplay(${JSON.stringify(player)}, `
      + `${JSON.stringify(camera ?? null)}) ?? null`,
    ).catch((e) => ({ error: String(e) }));
    console.log(`  gameplay: ${JSON.stringify(seen)}`);
  }

  if (PARTICLES) {
    const names = PARTICLES.split(',').map((n) => n.trim()).filter(Boolean);
    const seen = await win.webContents.executeJavaScript(
      `window.__estellaCooked?.particles(${JSON.stringify(names)}) ?? null`,
    ).catch((e) => ({ error: String(e) }));
    console.log(`  particles: ${JSON.stringify(seen)}`);
  }

  if (COMBAT) {
    const [attacker, targets = ''] = COMBAT.split(':');
    const names = targets.split(',').map((n) => n.trim()).filter(Boolean);
    const seen = await win.webContents.executeJavaScript(
      `window.__estellaCooked?.combat(${JSON.stringify(attacker.trim())}, `
      + `${JSON.stringify(names)}) ?? null`,
    ).catch((e) => ({ error: String(e) }));
    console.log(`  combat: ${JSON.stringify(seen)}`);
  }

  if (AI) {
    const seen = await win.webContents.executeJavaScript(
      `window.__estellaCooked?.ai(${JSON.stringify(AI.trim())}) ?? null`,
    ).catch((e) => ({ error: String(e) }));
    console.log(`  ai: ${JSON.stringify(seen)}`);
  }

  if (RENDER) {
    // Engaging the counters takes a frame to fill them, so ask twice and keep
    // the second: the first reading is of the frame that turned them on.
    await win.webContents.executeJavaScript('window.__estellaCooked?.render() ?? null')
      .catch(() => null);
    await new Promise((r) => setTimeout(r, 250));
    const seen = await win.webContents.executeJavaScript(
      'window.__estellaCooked?.render() ?? null',
    ).catch((e) => ({ error: String(e) }));
    console.log(`  render: ${JSON.stringify(seen)}`);
  }

  // A start screen that outlived its boot covers the game with something that
  // looks like a game still loading, and every other check here passes. The
  // deadline is the PAGE's (`data-min-ms`), not a fixed wait of ours.
  const splashLeft = await (async () => {
    const still = () => win.webContents.executeJavaScript(
      "(() => { const e = document.getElementById('es-splash');"
      + " return e && !e.classList.contains('es-splash-gone')"
      + " ? Number(e.getAttribute('data-min-ms') || 0) : -1; })()",
    ).catch(() => -1);
    const hold = await still();
    if (hold <= 0) return hold === 0;
    await new Promise((r) => setTimeout(r, hold + 200));
    return (await still()) >= 0;
  })();

  const image = await win.webContents.capturePage();
  if (OUT) await writeFile(OUT, image.toPNG());
  stop();
  server.close();

  const live = frameIsLive(image);
  const ok = painted && live && !splashLeft && errors.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${path.basename(DIR)} — painted=${painted} live=${live}`
    + `${splashLeft ? ' start-screen=STILL UP' : ''} errors=${errors.length}`);
  if (splashLeft) {
    console.log('    the start screen never faded — boot did not reach ready, or done() never ran');
  }
  for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
  if (!painted) {
    // How far it got, rather than "it did not start": a package drawing one slow
    // frame a second on a software rasteriser reaches neither, and only one of
    // those two sentences sends you looking in the right place.
    console.log(`    ${paint.frames} of ${SETTLE} settled frames within ${TIMEOUT}ms`);
    const diag = await win.webContents.executeJavaScript(`(() => {
      const c = document.querySelector('canvas');
      return JSON.stringify({ ready: document.readyState, canvas: !!c, w: c ? c.width : 0, h: c ? c.height : 0 });
    })()`).catch((e) => `unreadable: ${e}`);
    console.log(`    ${diag}`);
    for (const l of recent) console.log(`    · ${l}`);
  }
  if (painted && !live && !has('allow-flat')) console.log('    one flat colour — it started and drew nothing');
  app.exit(ok || (live === false && has('allow-flat') && painted && !errors.length) ? 0 : 1);
}

app.whenReady().then(main).catch((e) => {
  console.error('✗ launch-export failed:', e);
  app.exit(2);
});
