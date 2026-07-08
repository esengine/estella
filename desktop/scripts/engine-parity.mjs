// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Engine-level backend parity runner (REARCH_WGSL Phase 2).
 *
 * Loads tests' webgpu_engine_bringup.wasm twice — once per backend
 * (?backend=webgpu / ?backend=gl) — in a real browser context. The wasm boots
 * the FULL engine (EstellaContext) on the selected backend and renders the
 * same ECS scene through the production RenderFrame path. This runner asserts
 * the SAME pixel expectations on both runs AND diffs the two captures against
 * each other: the backends are each other's gold.
 *
 * Run: node desktop/scripts/engine-parity.mjs  (electron resolved from desktop/)
 * Prereq: cmake --build build/wasm/web-tests --target webgpu_engine_bringup
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch { /* not fatal */ }

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'build', 'wasm', 'web-tests', 'bin');

const PAGE = `<!doctype html>
<html><body style="margin:0">
<canvas id="canvas" width="256" height="256"></canvas>
<script>
(async () => {
  try {
    const useGL = location.search.indexOf('backend=gl') >= 0;
    window.Module = {};
    if (!useGL) {
      if (!navigator.gpu) { console.error('PARITY_FAIL no navigator.gpu'); return; }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) { console.error('PARITY_FAIL no adapter'); return; }
      const device = await adapter.requestDevice();
      device.addEventListener('uncapturederror', (e) => {
        console.error('PARITY_VALIDATION ' + e.error.message);
      });
      window.Module.preinitializedWebGPUDevice = device;
    }
    const s = document.createElement('script');
    s.src = '/webgpu_engine_bringup.js';
    document.body.appendChild(s);
  } catch (e) {
    console.error('PARITY_FAIL ' + e.message);
  }
})();
</script></body></html>`;

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      if (rel === '' || rel === 'index.html') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
        return;
      }
      const abs = path.join(BIN, rel);
      if (!abs.startsWith(BIN)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(abs);
      const mime = rel.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
      res.writeHead(200, { 'content-type': mime }).end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Navigates the shared window to one backend, waits for completion, and
 *  captures the 256x256 page pixels. One window navigated twice — a second
 *  BrowserWindow after a GPU-heavy first run fails navigation on some
 *  platforms. */
async function runBackend(win, baseUrl, backend) {
  let framesOk = false;
  const errors = [];
  const onMessage = (...args) => {
    const msg = args.map((a) => (a && typeof a === 'object' ? a.message ?? '' : String(a))).join(' ');
    if (/PARITY|error|warn/i.test(msg)) console.log(`[${backend}]`, msg.slice(0, 220));
    if (msg.includes('PARITY_FRAMES_OK')) framesOk = true;
    if (msg.includes('PARITY_FAIL') || msg.includes('PARITY_VALIDATION')) errors.push(msg);
  };
  win.webContents.on('console-message', onMessage);
  try {
    await win.loadURL(`${baseUrl}?backend=${backend}`);

    const deadline = Date.now() + 20000;
    while (!framesOk && errors.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 500));

    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
    const bitmap = image.toBitmap();  // BGRA rows
    const width = image.getSize().width;
    return { framesOk, errors, bitmap, width };
  } catch (e) {
    errors.push(`run failed: ${e.message}`);
    return { framesOk, errors, bitmap: Buffer.alloc(256 * 256 * 4), width: 256 };
  } finally {
    win.webContents.removeListener('console-message', onMessage);
  }
}

app.whenReady().then(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;

  // Sequential on purpose: two GPU-heavy runs at once is the kind of load
  // this machine must not take.
  const win = new BrowserWindow({ show: false, width: 256, height: 256, useContentSize: true });
  const webgpu = await runBackend(win, url, 'webgpu');
  const gl = await runBackend(win, url, 'gl');
  win.destroy();

  const px = (run, x, y) => {
    const i = (y * run.width + x) * 4;
    return { b: run.bitmap[i], g: run.bitmap[i + 1], r: run.bitmap[i + 2] };
  };
  const near = (v, want, tol = 40) => Math.abs(v - want) <= tol;

  // Shared expectations (screen space, y down). World y up: screen_y = 256 - world_y.
  // - checker sprite: world center (64,176) size 64 → screen x 32..96, y 48..112
  //   texel-center probes: quarter centers of the quad
  // - green sprite:   world center (192,176) size 48 → screen (192, 80)
  // - magenta circle: world center (128,80) r 32     → screen (128, 176)
  // - clear color corner (8, 8)
  // - lit sprite: white sprite lit by a red point light centered on it plus a
  //   0.2 white ambient → white * (0.2 + red) ≈ (255, 51, 51) at (64, 176)
  const POINTS = {
    checkerA: { x: 48, y: 96 },   // lower-left quarter center
    checkerB: { x: 48, y: 64 },   // upper-left quarter center (opposite texel)
    green: { x: 192, y: 80 },
    circle: { x: 128, y: 176 },
    lit: { x: 64, y: 176 },
    corner: { x: 8, y: 8 },
  };

  const report = {};
  let ok = true;
  for (const run of [{ name: 'webgpu', data: webgpu }, { name: 'gl', data: gl }]) {
    const p = Object.fromEntries(
      Object.entries(POINTS).map(([k, v]) => [k, px(run.data, v.x, v.y)]));
    report[run.name] = p;
    // One checker probe must be pure red and the vertically opposite one pure
    // blue — same orientation on both backends (which one is which is pinned
    // by the cross-backend diff below plus the red/blue split here).
    const checkerOk =
      (near(p.checkerA.r, 255) && near(p.checkerA.b, 0) && near(p.checkerB.r, 0) && near(p.checkerB.b, 255)) ||
      (near(p.checkerA.r, 0) && near(p.checkerA.b, 255) && near(p.checkerB.r, 255) && near(p.checkerB.b, 0));
    const greenOk = near(p.green.r, 0) && near(p.green.g, 255) && near(p.green.b, 0);
    const circleOk = near(p.circle.r, 255) && near(p.circle.g, 0) && near(p.circle.b, 255);
    const litOk = near(p.lit.r, 255) && near(p.lit.g, 51) && near(p.lit.b, 51);
    const cornerOk = near(p.corner.r, 13) && near(p.corner.g, 13) && near(p.corner.b, 77, 60);
    const runOk = run.data.framesOk && run.data.errors.length === 0 &&
      checkerOk && greenOk && circleOk && litOk && cornerOk;
    console.log(`[${run.name}] frames=${run.data.framesOk} errors=${run.data.errors.length} ` +
      `checker=${checkerOk} green=${greenOk} circle=${circleOk} lit=${litOk} corner=${cornerOk}`);
    ok = ok && runOk;
  }

  // Cross-backend diff at the probe points: the two runs must agree closely —
  // this is the parity gold, independent of the absolute expectations.
  let maxDiff = 0;
  for (const [k, v] of Object.entries(POINTS)) {
    const a = px(webgpu, v.x, v.y);
    const b = px(gl, v.x, v.y);
    const d = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
    maxDiff = Math.max(maxDiff, d);
    if (d > 8) {
      console.log(`[parity] MISMATCH at ${k}: webgpu=${JSON.stringify(a)} gl=${JSON.stringify(b)}`);
      ok = false;
    }
  }

  console.log(`RESULT ${JSON.stringify(report)}`);
  console.log(`[parity] max cross-backend diff at probes: ${maxDiff}`);
  console.log(`\n[engine-parity] ${ok ? 'PASS' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
  try { server.close(); } catch { /* ignore */ }
  app.quit();
});
