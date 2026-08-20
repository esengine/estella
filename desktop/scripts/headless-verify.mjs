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
 *   ESTELLA_VERIFY_GRID_EXPECT  what that diff must be: "frame" (default) or "nothing"
 *   ESTELLA_VERIFY_DEPTH_LAYERS  bitmask of layers resolved by depth (2.5D)
 *   ESTELLA_VERIFY_PREFAB    .esprefab instantiated into the scene after load
 *   ESTELLA_VERIFY_SET_FIELD one inspector field written after load (JSON)
 *   ESTELLA_VERIFY_PICK      hit-test a viewport point, asserting the entity (JSON)
 *   ESTELLA_VERIFY_ORBIT     turn the editor eye before capture ("yaw,pitch" degrees)
 *   ESTELLA_VERIFY_TIMEOUT_MS  how long this run may take before it reports one
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
const ROUNDS = Number(process.env.ESTELLA_VERIFY_LOSS_ROUNDS) || 1;
// ESTELLA_VERIFY_BACKEND=webgpu runs the same scene + assertions on the WebGPU
// backend (needs a real adapter — local runs; CI runners have none).
const BACKEND = process.env.ESTELLA_VERIFY_BACKEND === 'webgpu' ? 'webgpu' : 'webgl2';
// ESTELLA_VERIFY_COLORSPACE=linear boots the linear-light pipeline (sRGB decode
// + linear blending + final OETF) — point expectations must be linear-derived.
const COLORSPACE = process.env.ESTELLA_VERIFY_COLORSPACE === 'linear' ? 'linear' : '';
// A scene whose emitters roll dice has no constant to assert until the run is
// seeded; the engine seeds itself from the clock when nobody says otherwise.
const SEED = process.env.ESTELLA_VERIFY_SEED ?? '';
// ESTELLA_VERIFY_DEPTH_LAYERS=<mask> turns layers into depth-resolved ones (2.5D).
const DEPTH_LAYERS = process.env.ESTELLA_VERIFY_DEPTH_LAYERS ?? '';

// Headless / GPU-less (CI) WebGL2 falls back to SwiftShader; harmless with a GPU.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// The GPU process runs its own sandbox, which ELECTRON_DISABLE_SANDBOX does not
// reach: on a runner with no device it died before any scene drew, on every
// retry. Harmless with a GPU — this is a headless verifier, not a shipped app.
app.commandLine.appendSwitch('disable-gpu-sandbox');
// Pins the profile for anything that goes through the compositor (a screenshot
// for a human). The pixel assertions do not: a composited read is colour
// managed, turning rgb(0,255,0) into rgb(58,254,32) switch or no switch.
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// ...and the same reason for the SIZE of a device pixel. The headless canvas is
// never attached to a document, so its bounding rect is all zeros and a client
// coordinate reaches the hit test as `client * devicePixelRatio` — the developer's
// own monitor scaling. At Windows' 150% every ESTELLA_VERIFY_PICK landed 1.5x away
// from the point it named and answered null, so two gates were red on one machine
// and green on another, about nothing.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
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
  // Both modes assert the loss was seen and reported and the device ended Live
  // with nothing left on the placeholder. Only the driven mode asserts the steps
  // between: the auto mode has none, which is the point of it.
  const dl = result.deviceLoss;
  const lossSeen = !dl || (dl.supported && dl.statusAfterLoss === 1
    && (dl.reportAfterLoss?.length ?? 0) > 0);
  // Every round, not just the last: a recovery can work once and never again,
  // which is what a single round reports as a pass.
  const cameBack = !dl || ((dl.statusAfterFull === 0 && (dl.awaitingAfterFull?.length ?? 0) === 0)
    && (dl.rounds ?? []).every((r) => r.status === 0 && (r.awaiting?.length ?? 0) === 0));
  const drivenSteps = !dl || dl.mode === 'auto' || (dl.glLostAfterRestore === false
    && dl.recovered === true && dl.statusAfterRecover === 2 && dl.fullRecovered === true);
  // Objects the dead context minted that nobody released — visible only across
  // rounds. From the SECOND, so the first recovery's one-off costs are not read
  // as a slope. What the ENGINE owns comes back to the same size, full stop: a
  // program it re-creates on every rebuild without releasing the last is a leak
  // the round count makes obvious and a single round never can.
  const rounds = dl?.rounds ?? [];
  const growthOk = rounds.length < 3 || ((first, last, spans) => {
    const owned = ['programs', 'textures', 'vaos', 'framebuffers']
      .every((k) => last.tables[k] <= first.tables[k]);
    // Buffers get one allowance per rebuild: the host mints an internal buffer
    // for each WebGL context it creates, and no engine call names it.
    return owned && (last.tables.buffers - first.tables.buffers) <= spans;
  })(rounds[1], rounds[rounds.length - 1], rounds.length - 2);
  const deviceLossOk = lossSeen && cameBack && drivenSteps && growthOk;
  // Freezing nothing would pass every pixel assertion by not having changed the
  // scene — the shape of a check that cannot fail.
  const meshOk = (!result.meshResident || result.meshResident.frozen > 0)
    && (!result.meshAsset || result.meshAsset.pointed > 0)
    && (!result.meshMaterial || result.meshMaterial.applied > 0)
    && (!result.meshPrefab || result.meshPrefab.spawned > 0);
  // A hit test answering the wrong entity (or nothing) is the box being wrong,
  // which no pixel in the frame can show.
  const pickOk = !result.pick || result.pick.hit === result.pick.want;
  const renderedOk = result.capture?.rendered ?? false;
  const ok = result.ok && renderedOk && (result.expect?.ok ?? true) &&
    (result.resize?.ok ?? true) && (result.preview?.ok ?? true) &&
    (result.meshPreview?.ok ?? true) && (result.grid?.ok ?? true) &&
    (result.draws?.ok ?? true) && deviceLossOk && meshOk && pickOk;
  console.log(`\n[verify:render] ${ok ? 'PASS' : 'FAIL'} — ${SCENE} (${BACKEND})`);
  console.log('DRIVE_RESULT ' + JSON.stringify(result));
  try {
    server?.close();
  } catch {
    /* ignore */
  }
  // app.exit, not process.exitCode + app.quit: Electron leaves the process with
  // status 0 on quit whatever exitCode says, so the FAIL above was printed and
  // then reported as a pass to everything that ran this.
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(async () => {
  let server;
  try {
    server = await serveDist();
    const url = `http://127.0.0.1:${server.address().port}/headless.html?w=${W}&h=${H}&backend=${BACKEND}${COLORSPACE ? `&colorSpace=${COLORSPACE}` : ''}${DEPTH_LAYERS ? `&depthLayers=${DEPTH_LAYERS}` : ''}${SEED ? `&seed=${SEED}` : ''}`;

    // useContentSize: the capture rectangle must be the page area, not the
    // outer frame (the same trap the parity runner documents).
    const win = new BrowserWindow({
      show: false, width: W, height: H, useContentSize: true,
      webPreferences: { offscreen: false },
    });
    onRendererConsole(win.webContents, (msg) => {
      // `webgpu` spelled out: "webgl" does not match it, so the second backend's
      // boot — including which adapter served it — was the one thing never shown.
      if (/error|fail|unwind|exception|webgl|webgpu|adapter|recovery|placeholder/i.test(msg)) console.log('[renderer]', msg.slice(0, 240));
    });
    await win.loadURL(url);

    const exec = (code) => win.webContents.executeJavaScript(code, true);
    let deviceLoss = null;
    let meshResident = null;
    let meshAsset = null;
    let meshMaterial = null;
    let meshPrefab = null;
    let setField = null;
    let pick = null;
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

    // Loads an .esmesh through the asset layer and points the scene's meshes at
    // it, replacing their inline geometry. The fixture holds the SAME vertices,
    // so the assertions stand: a file drawing what the scene draws is the claim.
    if (process.env.ESTELLA_VERIFY_MESH_ASSET) {
      meshAsset = await exec(`(async () => {
        const pointed = await window.__estellaHeadless.loadMeshAsset(
          ${JSON.stringify(process.env.ESTELLA_VERIFY_MESH_ASSET)});
        await window.__estellaHeadless.api.step(2, 1 / 60);
        return { pointed };
      })()`);
    }

    // ESTELLA_VERIFY_SET_FIELD={"entity","component","key","value"} writes one
    // inspector field the way the editor's own door does, then waits: an asset
    // assigned after load is COLD, and reaching the World is an async load away.
    if (process.env.ESTELLA_VERIFY_SET_FIELD) {
      const spec = JSON.parse(process.env.ESTELLA_VERIFY_SET_FIELD);
      setField = await exec(`(async () => {
        const api = window.__estellaHeadless.api;
        api.setField(${JSON.stringify(spec.entity)}, ${JSON.stringify(spec.component)},
                     ${JSON.stringify(spec.key)}, "asset", ${JSON.stringify(spec.value)});
        for (let i = 0; i < 40; i++) {
          await api.step(1, 1 / 60);
          await new Promise((r) => setTimeout(r, 16));
        }
        return { wrote: ${JSON.stringify(spec.key)} };
      })()`);
    }

    // ESTELLA_VERIFY_PERSPECTIVE=1 looks at the scene as a 3D one and
    // ESTELLA_VERIFY_ORBIT="<yaw>,<pitch>" turns the eye. Perspective first: it
    // parks the eye at an angle of its own, which the orbit then overrides.
    if (process.env.ESTELLA_VERIFY_PERSPECTIVE || process.env.ESTELLA_VERIFY_ORBIT) {
      const [yaw, pitch] = (process.env.ESTELLA_VERIFY_ORBIT ?? '0,0').split(',').map(Number);
      await exec(`(async () => {
        const api = window.__estellaHeadless.api;
        // The eye belongs to the editor, so the frame has to be drawn through it
        // rather than through the scene's own camera.
        api.useEditorView(true);
        ${process.env.ESTELLA_VERIFY_PERSPECTIVE ? 'api.setViewPerspective(true);' : ''}
        api.setViewOrbit(${yaw || 0}, ${pitch || 0});
        await api.step(2, 1 / 60);
      })()`);
    }

    // ESTELLA_VERIFY_PICK={"x","y","entity"} clicks a point (viewport fractions)
    // and asserts which entity answers — the editor's own hit test, whose box for
    // a mesh is its geometry rather than the icon square a shapeless entity gets.
    if (process.env.ESTELLA_VERIFY_PICK) {
      const spec = JSON.parse(process.env.ESTELLA_VERIFY_PICK);
      pick = await exec(`(() => ({
        hit: window.__estellaHeadless.api.pick(${spec.x * W}, ${spec.y * H}),
        want: ${JSON.stringify(spec.entity)},
      }))()`);
    }

    // ESTELLA_VERIFY_PREFAB=<path> instantiates a prefab into the scene. For an
    // import's products this is the whole chain: the prefab names the geometry,
    // the image and the tint, and nothing here repeats what it should say.
    if (process.env.ESTELLA_VERIFY_PREFAB) {
      meshPrefab = await exec(`(async () => {
        const spawned = await window.__estellaHeadless.loadPrefabAsset(
          ${JSON.stringify(process.env.ESTELLA_VERIFY_PREFAB)});
        await window.__estellaHeadless.api.step(2, 1 / 60);
        return { spawned };
      })()`);
    }

    // ESTELLA_VERIFY_MESH_MATERIAL=<path> puts a material on the scene's meshes,
    // through the asset layer, after the geometry is in place.
    if (process.env.ESTELLA_VERIFY_MESH_MATERIAL) {
      meshMaterial = await exec(`(async () => {
        const applied = await window.__estellaHeadless.loadMaterialAsset(
          ${JSON.stringify(process.env.ESTELLA_VERIFY_MESH_MATERIAL)});
        await window.__estellaHeadless.api.step(2, 1 / 60);
        return { applied };
      })()`);
    }

    // Freezes the scene's inline geometry onto the GPU, keeping every other
    // assertion: nothing about the geometry changes, so the frame after must
    // equal the frame before. That equality IS the claim.
    if (process.env.ESTELLA_VERIFY_MESH_RESIDENT === '1') {
      meshResident = await exec(`(async () => {
        const frozen = window.__estellaHeadless.makeMeshesResident();
        await window.__estellaHeadless.api.step(2, 1 / 60);
        return { frozen };
      })()`);
    }

    // ESTELLA_VERIFY_DEVICE_LOSS=auto is the player's case: the GPU goes away,
    // the browser hands a context back, and NOTHING here asks for a recovery.
    // Only frames pass. What comes back has to come back on the engine's own.
    if (process.env.ESTELLA_VERIFY_DEVICE_LOSS === 'auto') {
      deviceLoss = await exec(`(async () => {
        const d = window.__estellaHeadless.device;
        const api = window.__estellaHeadless.api;
        // Rounds, because losing a context is not a one-off: backgrounding a
        // tab does it again and again, and what a single round cannot show is
        // whether the engine hands the last one's objects back.
        const out = { mode: 'auto', supported: true, rounds: [], tablesBefore: d.glTables() };
        for (let r = 0; r < ${ROUNDS}; r++) {
          if (!d.lose()) return { ...out, supported: false };

          for (let i = 0; i < 30 && d.status() === 0; i++) {
            await api.step(1, 1 / 60);
            await new Promise((r2) => setTimeout(r2, 50));
          }
          out.statusAfterLoss = d.status();
          out.reportAfterLoss = d.report();

          // Standing in for the browser, not for the engine: a page gets its
          // context back on its own, and there is no such event to wait for.
          out.restoreCalled = d.restore();
          await new Promise((r2) => setTimeout(r2, 200));

          for (let i = 0; i < 200 && d.status() !== 0; i++) {
            await api.step(1, 1 / 60);
            await new Promise((r2) => setTimeout(r2, 16));
          }
          out.rounds.push({ status: d.status(), tables: d.glTables(), awaiting: d.awaiting() });
        }
        out.statusAfterFull = d.status();
        out.awaitingAfterFull = d.awaiting();
        out.recovered = out.statusAfterFull === 0;
        out.fullRecovered = out.recovered;
        out.tablesAfterFull = d.glTables();
        await api.step(${STEPS}, 1 / 60);
        out.drawCallsAfterRecover = api.getStats ? api.getStats().drawCalls : -1;
        return out;
      })()`);
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
        out.tablesAtLoss = d.glTables();
        out.awaitingAtLoss = d.awaiting();
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
        out.awaitingAfterRecover = d.awaiting();

        // The full cycle: rebuild, re-upload the textures, and declare it whole.
        out.fullRecovered = await d.recoverFull();
        out.statusAfterFull = d.status();
        out.tablesAfterFull = d.glTables();
        out.awaitingAfterFull = d.awaiting();
        await api.step(${STEPS}, 1 / 60);
        out.drawCallsAfterRecover = api.getStats ? api.getStats().drawCalls : -1;
        return out;
      })()`);
    }

    // Both backends are read the same way: the ENGINE's pixels, in the page.
    // Reading the composited page instead answers what a display would show —
    // rgb(0,255,0) comes back as rgb(58,254,32).
    const readFrame = (expr) => exec(`(async () => {
      const api = window.__estellaHeadless.api;
      const c = (api.captureViewportPixels ? await api.captureViewportPixels() : null)
        ?? api.captureViewport();
      const px = c.rgba, w = c.width, h = c.height;
      ${expr}
    })()`);


    const capture = await readFrame(`
      const min = [255, 255, 255], max = [0, 0, 0]; let nonZero = 0;
      for (let i = 0; i < px.length; i += 4) {
        for (let k = 0; k < 3; k++) { const v = px[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
        if (px[i] | px[i + 1] | px[i + 2]) nonZero++;
      }
      const spread = (max[0] - min[0]) + (max[1] - min[1]) + (max[2] - min[2]);
      return { w, h, totalPixels: px.length / 4, nonZeroPixels: nonZero, min, max, spread, rendered: spread > 16 };
    `);
    const drawCalls = await exec('window.__estellaHeadless.api.getStats().drawCalls');
    // What the frame COST, which no pixel shows: the same geometry drawn N times
    // is one instanced call, and the picture is identical either way. Asserted as
    // an exact number so a regression in EITHER direction is a failure.
    const wantDrawCalls = process.env.ESTELLA_VERIFY_DRAW_CALLS;
    const draws = wantDrawCalls === undefined ? null
      : { want: Number(wantDrawCalls), got: drawCalls, ok: drawCalls === Number(wantDrawCalls) };
    // Optional color/orientation assertion: ESTELLA_VERIFY_EXPECT is a JSON array of
    // { x, y, rgb:[r,g,b], tol? } where x,y are normalized [0,1] from the TOP-LEFT.
    // This is the guard the all-textures-upside-down upload bug would have tripped
    // (TextureLoader imageOrientation) — `rendered` (color variation) alone misses it.
    let expect = null;
    if (process.env.ESTELLA_VERIFY_EXPECT) {
      expect = await readFrame(`
        const pts = ${JSON.stringify(JSON.parse(process.env.ESTELLA_VERIFY_EXPECT))};
        const out = pts.map((p) => {
          const pxX = Math.round(p.x * (w - 1));
          const row = (h - 1) - Math.round(p.y * (h - 1)); // readback rows are bottom-up
          const i = (row * w + pxX) * 4;
          const got = [px[i], px[i + 1], px[i + 2]];
          const tol = p.tol ?? 24;
          const ok = got.every((g, k) => Math.abs(g - p.rgb[k]) <= tol);
          return { x: p.x, y: p.y, want: p.rgb, got, ok };
        });
        return { points: out, ok: out.every((o) => o.ok) };
      `);
    }
    // Optional PNG dump (ESTELLA_VERIFY_OUT) of the engine framebuffer (not the
    // page) so the rendered frame can be eyeballed. GL readback is bottom-up → flip.
    if (process.env.ESTELLA_VERIFY_OUT) {
      const dataUrl = await readFrame(`
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) { const sy = (h - 1 - y) * w * 4; img.data.set(px.subarray(sy, sy + w * 4), y * w * 4); }
        ctx.putImageData(img, 0, 0);
        return cv.toDataURL('image/png');
      `);
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
      resize = await readFrame(`
        let nonZero = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i] | px[i + 1] | px[i + 2]) nonZero++;
        return { w, h, nonZeroPixels: nonZero, ok: w === ${rw} && h === ${rh} && nonZero > 0 };
      `);
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
    // Optional offscreen MESH-preview assertion (ESTELLA_VERIFY_MESH_PREVIEW =
    // {w,h}). The claim is the FRAMING a mesh thumbnail adds over a material ball:
    // the geometry lands inside the frame and reaches it, at any authored scale.
    let meshPreview = null;
    if (process.env.ESTELLA_VERIFY_MESH_PREVIEW) {
      const cfg = JSON.parse(process.env.ESTELLA_VERIFY_MESH_PREVIEW);
      meshPreview = await exec(`(async () => {
        const cfg = ${JSON.stringify(cfg)};
        const cap = await window.__estellaHeadless.api.renderSceneMeshPreview(cfg.w, cfg.h);
        if (!cap) return { ok: false, reason: 'no scene mesh' };
        const { width: w, height: h, rgba } = cap;
        const lit = (x, y) => { const i = (y * w + x) * 4; return rgba[i] | rgba[i + 1] | rgba[i + 2]; };
        let border = 0;
        for (let x = 0; x < w; x++) { if (lit(x, 0)) border++; if (lit(x, h - 1)) border++; }
        for (let y = 0; y < h; y++) { if (lit(0, y)) border++; if (lit(w - 1, y)) border++; }
        // Reaching the outer eighth is what "fitted" means, and it holds for any
        // shape — a fill ratio would only hold for one that is roughly square.
        const pad = Math.floor(w / 8);
        let reach = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const outer = x < pad || y < pad || x >= w - pad || y >= h - pad;
            if (outer && lit(x, y)) reach++;
          }
        }
        return { ok: border === 0 && reach > 0, border, reach, w, h };
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
      // What the grid owes this view. A plane the eye lies IN is edge-on through
      // the eye's own point: it has no picture, and "none" is the answer rather
      // than a frame nobody can read.
      const wantGrid = process.env.ESTELLA_VERIFY_GRID_EXPECT ?? 'frame';
      if (wantGrid !== 'frame' && wantGrid !== 'nothing') {
        throw new Error(`ESTELLA_VERIFY_GRID_EXPECT is "frame" or "nothing", not "${wantGrid}"`);
      }
      await exec(`window.__estellaHeadless.api.setGrid(true, ${spacing})`);
      await exec('window.__estellaHeadless.api.step(2, 1 / 60)');
      // Optional PNG of the grid-on frame (ESTELLA_VERIFY_GRID_OUT) for eyeballing.
      // Same per-backend readback split as ESTELLA_VERIFY_OUT (GL page capture of a
      // hidden window never composites — read the framebuffer in-page instead).
      if (process.env.ESTELLA_VERIFY_GRID_OUT) {
        const dataUrl = await readFrame(`
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
          for (let y = 0; y < h; y++) { const sy = (h - 1 - y) * w * 4; img.data.set(px.subarray(sy, sy + w * 4), y * w * 4); }
          ctx.putImageData(img, 0, 0);
          return cv.toDataURL('image/png');
        `);
        await writeFile(process.env.ESTELLA_VERIFY_GRID_OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
      }
      await readFrame('window.__estellaGridOn = px.slice(); return true;');
      await exec('window.__estellaHeadless.api.setGrid(false)');
      await exec('window.__estellaHeadless.api.step(2, 1 / 60)');
      grid = await readFrame(`
        const on = window.__estellaGridOn;
        const quadrants = [0, 0, 0, 0];
        let differing = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const d = Math.abs(on[i] - px[i]) + Math.abs(on[i + 1] - px[i + 1]) + Math.abs(on[i + 2] - px[i + 2]);
            if (d <= 12) continue;
            differing++;
            quadrants[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)]++;
          }
        }
        // A grid is there everywhere you look, so every quarter of the frame has
        // some of it. A plane seen edge-on lights one band and passes a total.
        const covers = differing > 300 && quadrants.every((q) => q > 20);
        const want = ${JSON.stringify(wantGrid)};
        return {
          differingPixels: differing, quadrants, want,
          ok: want === 'nothing' ? differing === 0 : covers,
        };
      `);
    }
    finish({ ok: true, entityCount, drawCalls, draws, capture, expect, resize, preview, meshPreview, grid, deviceLoss, meshResident, meshAsset, meshMaterial, meshPrefab, setField, pick }, server);
  } catch (e) {
    finish({ ok: false, error: String((e && e.stack) || e) }, server);
  }
});

// A verdict of "it took too long" is one this process can report; the runner
// kills it a launch margin later, and that one names no scene.
const TIMEOUT_MS = Number(process.env.ESTELLA_VERIFY_TIMEOUT_MS) || 45000;
setTimeout(() => finish({ ok: false, error: `timeout after ${TIMEOUT_MS} ms` }), TIMEOUT_MS);
