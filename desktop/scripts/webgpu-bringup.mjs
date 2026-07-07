// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WebGPU bring-up runner (REARCH_WGSL Phase 2 slice 2).
 *
 * Drives tests' webgpu_bringup.wasm in a real browser context: the page acquires
 * a GPUDevice (navigator.gpu), hands it to the wasm via
 * Module.preinitializedWebGPUDevice, and the program renders a red SDF circle on
 * a dark blue clear through the real WebGPUDevice. This runner asserts the
 * pixels and surfaces device validation errors — the first true frame the
 * WebGPU backend ever produces.
 *
 * Run: node desktop/scripts/webgpu-bringup.mjs  (electron resolved from desktop/)
 * Prereq: cmake --build build/wasm/web-tests --target webgpu_bringup
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
    if (!navigator.gpu) { console.error('BRINGUP_FAIL no navigator.gpu'); return; }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { console.error('BRINGUP_FAIL no adapter'); return; }
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (e) => {
      console.error('BRINGUP_VALIDATION ' + e.error.message);
    });
    window.Module = { preinitializedWebGPUDevice: device };
    const s = document.createElement('script');
    s.src = '/webgpu_bringup.js';
    document.body.appendChild(s);
  } catch (e) {
    console.error('BRINGUP_FAIL ' + e.message);
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

app.whenReady().then(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;

  const win = new BrowserWindow({ show: false, width: 256, height: 256 });
  let framesOk = false;
  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const msg = args.map((a) => (a && typeof a === 'object' ? a.message ?? '' : String(a))).join(' ');
    if (/BRINGUP|error|warn/i.test(msg)) console.log('[page]', msg.slice(0, 200));
    if (msg.includes('BRINGUP_FRAMES_OK')) framesOk = true;
    if (msg.includes('BRINGUP_FAIL') || msg.includes('BRINGUP_VALIDATION')) errors.push(msg);
  });
  await win.loadURL(url);

  // Give adapter/device acquisition + 3 rendered frames a generous window.
  const deadline = Date.now() + 15000;
  while (!framesOk && errors.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  // One extra beat so the last frame reaches the compositor before capture.
  await new Promise((r) => setTimeout(r, 500));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const png = image.toBitmap();  // BGRA rows
  const px = (x, y) => {
    const i = (y * image.getSize().width + x) * 4;
    return { b: png[i], g: png[i + 1], r: png[i + 2] };
  };
  const center = px(128, 128);   // inside the circle → red
  const corner = px(8, 8);       // outside → dark blue clear
  const near = (v, want, tol = 40) => Math.abs(v - want) <= tol;

  const centerOk = near(center.r, 255) && near(center.g, 0) && near(center.b, 0);
  const cornerOk = near(corner.r, 13) && near(corner.g, 13) && near(corner.b, 77, 60);
  const ok = framesOk && errors.length === 0 && centerOk && cornerOk;

  console.log(`RESULT center=${JSON.stringify(center)} corner=${JSON.stringify(corner)} framesOk=${framesOk} errors=${errors.length}`);
  console.log(`\n[webgpu-bringup] ${ok ? 'PASS' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
  try { server.close(); } catch { /* ignore */ }
  app.quit();
});
