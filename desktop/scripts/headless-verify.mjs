// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *   ESTELLA_VERIFY_GRID      editor-grid on/off pixel-diff assertion (value = spacing)
 *   ESTELLA_VERIFY_DEPTH_LAYERS  bitmask of layers resolved by depth (2.5D)
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import os from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRendererConsole } from './rendererConsole.mjs';

// SwiftShader rasterizes on the CPU; run the whole electron tree below normal
// priority (child processes inherit the class) so a verify never starves the
// machine. Must happen before the renderer process spawns.
try {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch { /* not fatal — some sandboxes forbid it */ }

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const SCENE = process.env.ESTELLA_VERIFY_SCENE ?? '/scenes/sprite-rendering.esscene';
const MANIFEST = process.env.ESTELLA_VERIFY_MANIFEST ?? '/scenes/sprite-rendering.textures.json';
const W = Number(process.env.ESTELLA_VERIFY_W) || 640;
const H = Number(process.env.ESTELLA_VERIFY_H) || 480;
const STEPS = Number(process.env.ESTELLA_VERIFY_STEPS) || 30;
// ESTELLA_VERIFY_BACKEND=webgpu runs the same scene + assertions on the WebGPU
// backend (needs a real adapter — local runs; CI runners have none).
const BACKEND = process.env.ESTELLA_VERIFY_BACKEND === 'webgpu' ? 'webgpu' : 'webgl2';
// ESTELLA_VERIFY_COLORSPACE=linear boots the linear-light pipeline (sRGB decode
// + linear blending + final OETF) — point expectations must be linear-derived.
const COLORSPACE = process.env.ESTELLA_VERIFY_COLORSPACE === 'linear' ? 'linear' : '';
// ESTELLA_VERIFY_DEPTH_LAYERS=<mask> turns layers into depth-resolved ones (2.5D).
const DEPTH_LAYERS = process.env.ESTELLA_VERIFY_DEPTH_LAYERS ?? '';

// Headless / GPU-less (CI) WebGL2 falls back to SwiftShader; harmless with a GPU.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// capturePage returns DISPLAY-referred pixels: Chromium converts the sRGB canvas
// through the OS display profile before compositing, so on a wide-gamut machine
// every WebGPU point assertion reads P3-ish values (pure green → ~[116,249,75])
// while the GL path's raw readPixels stays clean — the "R/B channel bleed" was
// this, not a render bug. Pin the profile so captures are device-independent.
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// WebGPU: the unsafe flag covers non-default platforms (Linux CI); the optional
// software adapter (ESTELLA_VERIFY_WEBGPU_ADAPTER=swiftshader) gives GPU-less
// runners a real Dawn adapter through the bundled SwiftShader Vulkan — the
// WebGPU analog of the WebGL fallback above.
if (BACKEND === 'webgpu') {
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  if (process.env.ESTELLA_VERIFY_WEBGPU_ADAPTER) {
    app.commandLine.appendSwitch('use-webgpu-adapter', process.env.ESTELLA_VERIFY_WEBGPU_ADAPTER);
  }
}
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.esscene': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
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
  // A loss run asserts the whole cycle: the loss is seen and reported, the
  // browser gives the context back, and the engine rebuilds to Recovering.
  const dl = result.deviceLoss;
  const deviceLossOk = !dl || (dl.supported && dl.statusAfterLoss === 1 &&
    (dl.reportAfterLoss?.length ?? 0) > 0 && dl.glLostAfterRestore === false &&
    dl.recovered === true && dl.statusAfterRecover === 2);
  // After a recovery the textures are placeholders until the asset layer
  // re-uploads, so "did it draw content" is not the question a loss run asks —
  // the cycle assertions above are. Restore this once re-upload lands.
  const renderedOk = dl ? true : (result.capture?.rendered ?? false);
  const ok = result.ok && renderedOk && (result.expect?.ok ?? true) &&
    (result.resize?.ok ?? true) && (result.preview?.ok ?? true) && (result.grid?.ok ?? true) &&
    deviceLossOk;
  console.log(`\n[verify:render] ${ok ? 'PASS' : 'FAIL'} — ${SCENE} (${BACKEND})`);
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
    const url = `http://127.0.0.1:${server.address().port}/headless.html?w=${W}&h=${H}&backend=${BACKEND}${COLORSPACE ? `&colorSpace=${COLORSPACE}` : ''}${DEPTH_LAYERS ? `&depthLayers=${DEPTH_LAYERS}` : ''}`;

    // useContentSize: the capture rectangle must be the page area, not the
    // outer frame (the same trap the parity runner documents).
    const win = new BrowserWindow({
      show: false, width: W, height: H, useContentSize: true,
      webPreferences: { offscreen: false },
    });
    onRendererConsole(win.webContents, (msg) => {
      if (/error|fail|unwind|exception|webgl/i.test(msg)) console.log('[renderer]', msg.slice(0, 240));
    });
    await win.loadURL(url);

    const exec = (code) => win.webContents.executeJavaScript(code, true);
    let deviceLoss = null;
    await exec('window.__estellaHeadless.ready');
    const entityCount = await exec(
      `window.__estellaHeadless.api.loadScene(${JSON.stringify(SCENE)}, ${JSON.stringify(MANIFEST)})`,
    );
    // Opt-in play mode (ESTELLA_VERIFY_PLAY=1): runs the SDK plugin updates — particle
    // emission/simulation, animation — so time-driven content actually renders.
    if (process.env.ESTELLA_VERIFY_PLAY === '1') {
      await exec('window.__estellaHeadless.api.setRunMode(true)');
    }
    // Project render config stand-in: ESTELLA_VERIFY_YSORT = layer bitmask
    // (Project Settings → Rendering → Y-sorted layers in a real project).
    if (process.env.ESTELLA_VERIFY_YSORT) {
      await exec(`window.__estellaHeadless.api.setYSortLayers(${Number(process.env.ESTELLA_VERIFY_YSORT)})`);
    }
    // ESTELLA_VERIFY_TRAIL = {"from":[x,y],"to":[x,y],"steps":N}: move the entity
    // carrying a TrailRenderer along a world-space path, one frame per sample, so
    // the trail system records points — motion a static scene can't express.
    // Requires play mode (ESTELLA_VERIFY_PLAY=1) for the trail update to run.
    // ESTELLA_VERIFY_MOVE = {"component":"TilemapLayer","to":[x,y],"steps":N}:
    // after the scene settles, teleport the first entity carrying the named
    // component to a world position and step N frames — proves render paths
    // that cache geometry still track a moving entity (e.g. tilemap origin).
    if (process.env.ESTELLA_VERIFY_MOVE) {
      const move = JSON.parse(process.env.ESTELLA_VERIFY_MOVE);
      await exec(`(async () => {
        const cfg = ${JSON.stringify(move)};
        const api = window.__estellaHeadless.api;
        const flat = [];
        const walk = (nodes) => { for (const n of nodes) { flat.push(n.id); if (n.children) walk(n.children); } };
        walk(api.getSceneTree());
        const want = cfg.component.replace(/\\s+/g, '');
        let target = null;
        for (const id of flat) {
          const e = api.getEntity(id);
          if (e && e.components && e.components.some((c) => c.replace(/\\s+/g, '') === want)) { target = id; break; }
        }
        if (target == null) throw new Error('no ' + cfg.component + ' entity in scene');
        await api.step(2, 1 / 60);
        api.setEntityXY(target, cfg.to[0], cfg.to[1]);
        await api.step(cfg.steps ?? 2, 1 / 60);
      })()`);
    }
    if (process.env.ESTELLA_VERIFY_TRAIL) {
      const trail = JSON.parse(process.env.ESTELLA_VERIFY_TRAIL);
      await exec(`(async () => {
        const cfg = ${JSON.stringify(trail)};
        const api = window.__estellaHeadless.api;
        const flat = [];
        const walk = (nodes) => { for (const n of nodes) { flat.push(n.id); if (n.children) walk(n.children); } };
        walk(api.getSceneTree());
        // getEntity().components returns humanized display names ("Trail Renderer"),
        // so compare with whitespace stripped.
        let target = null;
        for (const id of flat) {
          const e = api.getEntity(id);
          if (e && e.components && e.components.some((c) => c.replace(/\\s+/g, '') === 'TrailRenderer')) { target = id; break; }
        }
        if (target == null) throw new Error('no TrailRenderer entity in scene');
        const [fx, fy] = cfg.from, [tx, ty] = cfg.to, N = cfg.steps;
        for (let i = 0; i <= N; i++) {
          const t = N === 0 ? 1 : i / N;
          api.setEntityXY(target, fx + (tx - fx) * t, fy + (ty - fy) * t);
          await api.step(1, 1 / 60);
        }
      })()`);
    } else if (process.env.ESTELLA_VERIFY_SETTLE_MS) {
      // Real-time settle: some content decodes on the wall clock, not engine dt
      // — video (HTMLVideoElement) decodes frames in real time and its system
      // uploads the newest frame each tick. Interleave engine steps with real
      // delays so frames actually arrive before the capture. Requires play mode.
      const ms = Number(process.env.ESTELLA_VERIFY_SETTLE_MS) || 1500;
      await exec(`(async () => {
        const api = window.__estellaHeadless.api;
        const end = performance.now() + ${ms};
        while (performance.now() < end) {
          await api.step(1, 1 / 60);
          await new Promise((r) => setTimeout(r, 16));
        }
      })()`);
    } else {
      await exec(`window.__estellaHeadless.api.step(${STEPS}, 1 / 60)`);
    }

    // ESTELLA_VERIFY_DEVICE_LOSS=1 takes the GPU away for real (WEBGL_lose_context)
    // and drives the whole cycle, because everything downstream of a loss is
    // reachable only by actually losing one.
    if (process.env.ESTELLA_VERIFY_DEVICE_LOSS === '1') {
      deviceLoss = await exec(`(async () => {
        const d = window.__estellaHeadless.device;
        const api = window.__estellaHeadless.api;
        const out = { supported: d.lose() };
        if (!out.supported) return out;

        // The browser reports the loss asynchronously and the engine polls on its
        // own frame, so both are waited for rather than assumed.
        for (let i = 0; i < 30 && d.status() === 0; i++) {
          api.step(1, 1 / 60);
          await new Promise((r) => setTimeout(r, 50));
        }
        out.statusAfterLoss = d.status();
        out.reportAfterLoss = d.report();

        out.guard = d.guard();
        out.glLostBeforeRestore = d.contextLost();
        out.restoreCalled = d.restore();
        await new Promise((r) => setTimeout(r, 500));
        out.glLostAfterRestore = d.contextLost();

        // A context comes back when the browser is ready, not when asked.
        out.recovered = false;
        for (let i = 0; i < 20 && !out.recovered; i++) {
          out.recovered = d.recover();
          if (!out.recovered) await new Promise((r) => setTimeout(r, 100));
        }
        out.statusAfterRecover = d.status();
        api.step(${STEPS}, 1 / 60);
        out.drawCallsAfterRecover = api.getStats ? api.getStats().drawCalls : -1;
        return out;
      })()`);
    }

    // WebGPU: the engine has no synchronous readback (buffer maps are async)
    // and a hidden window never presents, so drawImage-style page readback is
    // blank — capture the PAGE instead (capturePage forces a composite; the
    // same technique the engine-parity runner uses). The canvas sits at the
    // page origin at its backing size, so the page pixels ARE the frame.
    // Converted to the RGBA bottom-up order of ViewportCapture so both
    // backends share the assertion math below.
    const grabWebGPU = async () => {
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
      const bmp = image.toBitmap(); // BGRA, top-down
      const { width, height } = image.getSize();
      const rgba = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) {
        const srcRow = y * width * 4;
        const dstRow = (height - 1 - y) * width * 4;
        for (let x = 0; x < width; x++) {
          const s = srcRow + x * 4;
          const d = dstRow + x * 4;
          rgba[d] = bmp[s + 2];
          rgba[d + 1] = bmp[s + 1];
          rgba[d + 2] = bmp[s];
          rgba[d + 3] = bmp[s + 3];
        }
      }
      return { rgba, width, height };
    };
    const webgpuFrame = BACKEND === 'webgpu' ? await grabWebGPU() : null;

    const captureStats = (rgba, width, height) => {
      const min = [255, 255, 255], max = [0, 0, 0];
      let nonZero = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        for (let k = 0; k < 3; k++) { const v = rgba[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
        if (rgba[i] | rgba[i + 1] | rgba[i + 2]) nonZero++;
      }
      const spread = (max[0] - min[0]) + (max[1] - min[1]) + (max[2] - min[2]);
      return { w: width, h: height, totalPixels: rgba.length / 4, nonZeroPixels: nonZero, min, max, spread, rendered: spread > 16 };
    };

    const capture = webgpuFrame
      ? captureStats(webgpuFrame.rgba, webgpuFrame.width, webgpuFrame.height)
      : await exec(`(() => {
      const c = window.__estellaHeadless.api.captureViewport();
      const px = c.rgba; const min = [255, 255, 255], max = [0, 0, 0]; let nonZero = 0;
      for (let i = 0; i < px.length; i += 4) {
        for (let k = 0; k < 3; k++) { const v = px[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
        if (px[i] | px[i + 1] | px[i + 2]) nonZero++;
      }
      const spread = (max[0] - min[0]) + (max[1] - min[1]) + (max[2] - min[2]);
      return { w: c.width, h: c.height, totalPixels: px.length / 4, nonZeroPixels: nonZero, min, max, spread, rendered: spread > 16 };
    })()`);
    const drawCalls = await exec('window.__estellaHeadless.api.getStats().drawCalls');
    // Optional color/orientation assertion: ESTELLA_VERIFY_EXPECT is a JSON array of
    // { x, y, rgb:[r,g,b], tol? } where x,y are normalized [0,1] from the TOP-LEFT.
    // This is the guard the all-textures-upside-down upload bug would have tripped
    // (TextureLoader imageOrientation) — `rendered` (color variation) alone misses it.
    let expect = null;
    if (process.env.ESTELLA_VERIFY_EXPECT) {
      const points = JSON.parse(process.env.ESTELLA_VERIFY_EXPECT);
      const evaluate = (rgba, w, h) => {
        const out = points.map((p) => {
          const px = Math.round(p.x * (w - 1));
          const glRow = (h - 1) - Math.round(p.y * (h - 1)); // capture rows are bottom-up
          const i = (glRow * w + px) * 4;
          const got = [rgba[i], rgba[i + 1], rgba[i + 2]];
          const tol = p.tol ?? 24;
          const ok = got.every((g, k) => Math.abs(g - p.rgb[k]) <= tol);
          return { x: p.x, y: p.y, want: p.rgb, got, ok };
        });
        return { points: out, ok: out.every((o) => o.ok) };
      };
      expect = webgpuFrame
        ? evaluate(webgpuFrame.rgba, webgpuFrame.width, webgpuFrame.height)
        : await exec(`(() => {
        const pts = ${JSON.stringify(points)};
        const c = window.__estellaHeadless.api.captureViewport();
        const { width: w, height: h, rgba } = c;
        const out = pts.map((p) => {
          const px = Math.round(p.x * (w - 1));
          const glRow = (h - 1) - Math.round(p.y * (h - 1)); // GL readback is bottom-up
          const i = (glRow * w + px) * 4;
          const got = [rgba[i], rgba[i + 1], rgba[i + 2]];
          const tol = p.tol ?? 24;
          const ok = got.every((g, k) => Math.abs(g - p.rgb[k]) <= tol);
          return { x: p.x, y: p.y, want: p.rgb, got, ok };
        });
        return { points: out, ok: out.every((o) => o.ok) };
      })()`);
    }
    // Optional PNG dump (ESTELLA_VERIFY_OUT) of the engine framebuffer (not the
    // page) so the rendered frame can be eyeballed. GL readback is bottom-up → flip.
    if (process.env.ESTELLA_VERIFY_OUT && BACKEND === 'webgpu') {
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
      await writeFile(process.env.ESTELLA_VERIFY_OUT, image.toPNG());
    } else if (process.env.ESTELLA_VERIFY_OUT) {
      const dataUrl = await exec(`(() => {
        const c = window.__estellaHeadless.api.captureViewport();
        const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
        const ctx = cv.getContext('2d'); const img = ctx.createImageData(c.width, c.height);
        const w = c.width, h = c.height, src = c.rgba;
        for (let y = 0; y < h; y++) { const sy = (h - 1 - y) * w * 4; img.data.set(src.subarray(sy, sy + w * 4), y * w * 4); }
        ctx.putImageData(img, 0, 0);
        return cv.toDataURL('image/png');
      })()`);
      await writeFile(process.env.ESTELLA_VERIFY_OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
    // Optional resize assertion (ESTELLA_VERIFY_RESIZE = "WxH"): shrink the
    // canvas mid-run, step, and re-capture — the backbuffer must follow the
    // viewport (the WebGPU swapchain reconfigure; a no-op contract on GL).
    let resize = null;
    if (process.env.ESTELLA_VERIFY_RESIZE) {
      const [rw, rh] = process.env.ESTELLA_VERIFY_RESIZE.split('x').map(Number);
      await exec(`window.__estellaHeadless.api.resizeViewport(${rw}, ${rh})`);
      await exec('window.__estellaHeadless.api.step(2, 1 / 60)');
      if (BACKEND === 'webgpu') {
        const image = await win.webContents.capturePage({ x: 0, y: 0, width: rw, height: rh });
        const bmp = image.toBitmap();
        let nonZero = 0;
        for (let i = 0; i < bmp.length; i += 4) if (bmp[i] | bmp[i + 1] | bmp[i + 2]) nonZero++;
        resize = { w: rw, h: rh, nonZeroPixels: nonZero, ok: nonZero > 0 };
      } else {
        resize = await exec(`(() => {
          const c = window.__estellaHeadless.api.captureViewport();
          let nonZero = 0;
          for (let i = 0; i < c.rgba.length; i += 4) if (c.rgba[i] | c.rgba[i + 1] | c.rgba[i + 2]) nonZero++;
          return { w: c.width, h: c.height, nonZeroPixels: nonZero, ok: c.width === ${rw} && c.height === ${rh} && nonZero > 0 };
        })()`);
      }
    }
    // Optional offscreen material-preview assertion (ESTELLA_VERIFY_PREVIEW =
    // {w,h,rgb:[r,g,b],tol?}): renders a scene material to an offscreen target and checks the
    // center pixel — proves the render-to-texture preview primitive, not just the viewport.
    // The readback rides the engine's async seam, so the same awaited call
    // verifies BOTH backends (GL resolves immediately; WebGPU when the map lands).
    let preview = null;
    if (process.env.ESTELLA_VERIFY_PREVIEW) {
      const cfg = JSON.parse(process.env.ESTELLA_VERIFY_PREVIEW);
      preview = await exec(`(async () => {
        const cfg = ${JSON.stringify(cfg)};
        const cap = await window.__estellaHeadless.api.renderSceneMaterialPreview(cfg.w, cfg.h);
        if (!cap) return { ok: false, reason: 'no scene material' };
        const { width: w, height: h, rgba } = cap;
        const i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
        const got = [rgba[i], rgba[i + 1], rgba[i + 2]];
        const tol = cfg.tol ?? 40;
        return { ok: got.every((g, k) => Math.abs(g - cfg.rgb[k]) <= tol), want: cfg.rgb, got, w, h };
      })()`);
    }
    // Optional editor-grid assertion (ESTELLA_VERIFY_GRID = minor spacing, world
    // units): flip the grid on (this activates the editor view it draws through),
    // capture, flip it off, and assert the frames differ — proving the custom-draw
    // drawMeshWithMaterial path rasterizes on this backend. Run standalone:
    // activating the editor view reframes the camera for any later capture.
    let grid = null;
    if (process.env.ESTELLA_VERIFY_GRID) {
      const spacing = Number(process.env.ESTELLA_VERIFY_GRID) || 64;
      await exec(`window.__estellaHeadless.api.setGrid(true, ${spacing})`);
      await exec('window.__estellaHeadless.api.step(2, 1 / 60)');
      // Optional PNG of the grid-on frame (ESTELLA_VERIFY_GRID_OUT) for eyeballing.
      // Same per-backend readback split as ESTELLA_VERIFY_OUT (GL page capture of a
      // hidden window never composites — read the framebuffer in-page instead).
      if (process.env.ESTELLA_VERIFY_GRID_OUT && BACKEND === 'webgpu') {
        const image = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
        await writeFile(process.env.ESTELLA_VERIFY_GRID_OUT, image.toPNG());
      } else if (process.env.ESTELLA_VERIFY_GRID_OUT) {
        const dataUrl = await exec(`(() => {
          const c = window.__estellaHeadless.api.captureViewport();
          const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
          const ctx = cv.getContext('2d'); const img = ctx.createImageData(c.width, c.height);
          const w = c.width, h = c.height, src = c.rgba;
          for (let y = 0; y < h; y++) { const sy = (h - 1 - y) * w * 4; img.data.set(src.subarray(sy, sy + w * 4), y * w * 4); }
          ctx.putImageData(img, 0, 0);
          return cv.toDataURL('image/png');
        })()`);
        await writeFile(process.env.ESTELLA_VERIFY_GRID_OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
      }
      if (BACKEND === 'webgpu') {
        const on = (await grabWebGPU()).rgba;
        await exec('window.__estellaHeadless.api.setGrid(false)');
        await exec('window.__estellaHeadless.api.step(2, 1 / 60)');
        const off = (await grabWebGPU()).rgba;
        let differing = 0;
        for (let i = 0; i < on.length; i += 4) {
          const d = Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]);
          if (d > 12) differing++;
        }
        grid = { differingPixels: differing, ok: differing > 300 };
      } else {
        await exec('window.__estellaGridOn = window.__estellaHeadless.api.captureViewport().rgba.slice()');
        await exec('window.__estellaHeadless.api.setGrid(false)');
        await exec('window.__estellaHeadless.api.step(2, 1 / 60)');
        grid = await exec(`(() => {
          const off = window.__estellaHeadless.api.captureViewport().rgba;
          const on = window.__estellaGridOn;
          let differing = 0;
          for (let i = 0; i < on.length; i += 4) {
            const d = Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]);
            if (d > 12) differing++;
          }
          return { differingPixels: differing, ok: differing > 300 };
        })()`);
      }
    }
    finish({ ok: true, entityCount, drawCalls, capture, expect, resize, preview, grid, deviceLoss }, server);
  } catch (e) {
    finish({ ok: false, error: String((e && e.stack) || e) }, server);
  }
});

setTimeout(() => finish({ ok: false, error: 'timeout' }), 45000);
