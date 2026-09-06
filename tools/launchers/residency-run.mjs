// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  residency-run.mjs — drive a packaged streamed world and read what exists.
 *
 * A camera cannot answer this. "The far place is not drawn" and "the far place
 * does not exist" produce the same pixels, and a body an unload forgot is
 * invisible until someone walks into it. So this drives the real package with
 * real input and reads `__estellaCooked.streaming()` — counts, per cell, of
 * things that ARE.
 *
 * Which key walks which way is CALIBRATED rather than assumed: movement is
 * relative to the camera, so a fixture that reorients its camera would silently
 * turn every leg of a route into someone walking backwards.
 *
 *   electron tools/launchers/residency-run.mjs --dir <exportDir> --script <file.json>
 *     --w / --h          surface size (default 640x360)
 *     --budget <n>       give up on a leg after this many frames (default 900)
 *     --log <regex>      also print console lines matching this
 *
 * A script is a list of steps: {do:"read",as},  {do:"walkTo",x,z},
 * {do:"tap",key}, {do:"step",frames}. Each read prints one JSON line.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { onRendererConsole } from '../lib/rendererConsole.mjs';

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const DIR = path.resolve(flag('dir', ''));
const SCRIPT = flag('script', '');
const W = Number(flag('w', '640'));
const H = Number(flag('h', '360'));
const BUDGET = Number(flag('budget', '900'));
const LOG = flag('log', '');
const logRe = LOG ? new RegExp(LOG, 'i') : null;

/** Everything a read asks the game about, in one round trip. */
const NAMES = ['Player', 'Enemy', 'RockA', 'Wall', 'Arch', 'ArchTop', 'Beacon', 'Canary', 'Scout', 'Bobber'];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css',
};

function serve(root) {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      if (rel === '') rel = 'index.html';
      const abs = path.join(root, rel);
      if (!abs.startsWith(root)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(abs);
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' })
        .end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Hold keys for `frames` engine frames of fixed dt, then release. */
const holdScript = (keys, frames) => `
(() => {
  const target = document.querySelector('canvas') ?? window;
  const send = (type, code) => {
    const e = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    if (target !== window) window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  };
  const held = ${JSON.stringify(keys)};
  for (const k of held) send('keydown', k);
  return (async () => {
    await window.__estellaCooked.step(${frames}, 1 / 60);
    for (const k of held) send('keyup', k);
    return true;
  })();
})()
`;

/** Press and release a key inside one frame, then let `frames` more run. */
const tapScript = (key, frames) => `
(() => {
  const target = document.querySelector('canvas') ?? window;
  const send = (type, code) => {
    const e = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    if (target !== window) window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  };
  send('keydown', ${JSON.stringify(key)});
  return (async () => {
    await window.__estellaCooked.step(1, 1 / 60);
    send('keyup', ${JSON.stringify(key)});
    await window.__estellaCooked.step(${frames}, 1 / 60);
    return true;
  })();
})()
`;

function fail(message, code = 1) {
  console.log(`✗ ${message}`);
  app.exit(code);
}

async function main() {
  if (!DIR || !existsSync(path.join(DIR, 'index.html'))) return fail(`no index.html under ${DIR || '(--dir)'}`, 2);
  if (!SCRIPT || !existsSync(SCRIPT)) return fail(`no script at ${SCRIPT || '(--script)'}`, 2);
  const steps = JSON.parse(await readFile(SCRIPT, 'utf8'));
  const server = await serve(DIR);
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await win.webContents.session.clearCache();
  const errors = [];
  const stop = onRendererConsole(win.webContents, (msg) => {
    if (/error|uncaught|failed/i.test(msg)) errors.push(msg.slice(0, 300));
    if (logRe?.test(msg)) console.log(`  ${msg}`);
  });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?headless`);
  const exec = (js) => win.webContents.executeJavaScript(js);

  // Readiness is "a scene is up", not "a named entity is there": the handle
  // appears before the first scene has spawned anything, and a name belongs to
  // whichever world is being driven.
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    ready = await exec(`(() => {
      const c = window.__estellaCooked;
      if (!c || !c.streaming) return false;
      return !!c.probe([]).scene;
    })()`).catch(() => false);
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) { stop(); server.close(); return fail('the package never exposed a streaming report', 2); }
  if (!(await exec('(() => { window.__estellaCooked.setPaused(true); return true; })()').catch(() => false))) {
    stop(); server.close(); return fail('this package cannot hand over its clock', 2);
  }

  const where = async () => (await exec(`window.__estellaCooked.probe(${JSON.stringify(['Player'])})`)).at.Player;

  /**
   * Let residency finish what the last gesture asked for.
   *
   * A cell arrives over the network, so the frames a driver asks for are not the
   * thing it is waiting on: reading straight after a step reports a place that is
   * still `loading`, which is neither "here" nor "not asked for".
   */
  const settle = async (tries = 150) => {
    for (let i = 0; i < tries; i++) {
      const s = await exec('window.__estellaCooked.streaming()');
      if (!s.streamed) return true;
      if (s.loadingCells.length === 0 && s.unloadingCells.length === 0) return true;
      await exec(holdScript([], 2));
      // Tight at first: how long an arrival takes is a number worth measuring,
      // and a poll that sleeps 20 ms can only ever report multiples of 20 ms.
      if (i > 40) await new Promise((r) => setTimeout(r, 20));
    }
    console.log('  ! residency never settled');
    return false;
  };

  const read = async () => ({
    streaming: await exec('window.__estellaCooked.streaming()'),
    at: (await exec(`window.__estellaCooked.probe(${JSON.stringify(NAMES)})`)).at,
    combat: await exec(`window.__estellaCooked.combat("Player", ${JSON.stringify(['Enemy', 'Canary', 'Player', 'Wall', 'RockA', 'Arch', 'ArchTop', 'Beacon'])})`),
    ai: await exec('window.__estellaCooked.ai("Enemy")'),
  });

  // Which key walks which way, measured — movement is camera-relative. LAZILY,
  // because walking to find out moves the character, and a script that opens by
  // reading what boot produced would read a world calibration already changed.
  let basis = null;
  const calibrate = async () => {
    if (basis !== null) return true;
    basis = {};
    for (const key of ['KeyW', 'KeyD']) {
      const before = await where();
      await exec(holdScript([key], 20));
      const after = await where();
      basis[key] = { x: after.x - before.x, z: after.z - before.z };
      await exec(holdScript([key === 'KeyW' ? 'KeyS' : 'KeyA'], 20));
    }
    if (Math.hypot(basis.KeyW.x, basis.KeyW.z) < 1) return false;
    console.log(`  calibrated: KeyW → (${basis.KeyW.x.toFixed(0)}, ${basis.KeyW.z.toFixed(0)}), `
      + `KeyD → (${basis.KeyD.x.toFixed(0)}, ${basis.KeyD.z.toFixed(0)})`);
    return true;
  };

  /** The keys that move toward (x, z), from the measured basis. */
  const keysToward = (from, to, deadband) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const keys = [];
    for (const [key, opposite] of [['KeyW', 'KeyS'], ['KeyD', 'KeyA']]) {
      const v = basis[key];
      const along = (dx * v.x + dz * v.z) / (Math.hypot(v.x, v.z) || 1);
      if (Math.abs(along) > deadband) keys.push(along > 0 ? key : opposite);
    }
    return keys;
  };

  for (const step of steps) {
    if (step.do === 'read') {
      await settle();
      console.log(`reading ${step.as}: ${JSON.stringify(await read())}`);
      continue;
    }
    if (step.do === 'step') { await exec(holdScript([], step.frames ?? 30)); continue; }
    if (step.do === 'watch') {
      // Sample while it runs, so a claim about a source CROSSING a threshold can
      // say it crossed. One reading at the end cannot: a source that never moved
      // and one that came to rest where it started look the same.
      const every = step.every ?? 20;
      const swept = { min: Infinity, max: -Infinity };
      let counts = null;
      for (let done = 0; done < (step.frames ?? 200); done += every) {
        await exec(holdScript([], every));
        const at = (await exec(`window.__estellaCooked.probe(${JSON.stringify([step.name])})`)).at[step.name];
        if (at) { swept.min = Math.min(swept.min, at[step.axis ?? 'z']); swept.max = Math.max(swept.max, at[step.axis ?? 'z']); }
        counts = await exec('window.__estellaCooked.streaming()');
      }
      console.log(`watching ${step.as}: ${JSON.stringify({ swept, streaming: counts })}`);
      continue;
    }
    if (step.do === 'tap') { await exec(tapScript(step.key, step.frames ?? 10)); continue; }
    if (step.do === 'frames') {
      // One frame at a time, timed INSIDE the page: a spike is a property of a
      // frame, and measuring from outside adds a round trip to every sample.
      // The key is tapped on the first one, so the profile starts at the gesture.
      const profile = await exec(`(async () => {
        const target = document.querySelector('canvas') ?? window;
        const send = (type, code) => {
          const e = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true });
          target.dispatchEvent(e);
          if (target !== window) window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
        };
        ${step.key ? `send('keydown', ${JSON.stringify(step.key)});` : ''}
        const out = [];
        for (let i = 0; i < ${step.count ?? 120}; i++) {
          const began = performance.now();
          await window.__estellaCooked.step(1, 1 / 60);
          const ms = Math.round((performance.now() - began) * 1000) / 1000;
          ${step.key ? `if (i === 0) send('keyup', ${JSON.stringify(step.key)});` : ''}
          const s = window.__estellaCooked.streaming();
          out.push({ ms, resident: s.residentCells.length, loading: s.loadingCells.length,
                     entities: s.entities, bodies: s.physicsBodies, physicsUp: s.physicsUp });
          // A macrotask turn between frames. Awaiting a step only drains
          // MICROtasks, and a cell arrives over the network — so a loop without
          // this starves the fetch and profiles a load that never lands.
          await new Promise((settle) => setTimeout(settle, 0));
        }
        return out;
      })()`);
      console.log(`profile ${step.as}: ${JSON.stringify(profile)}`);
      continue;
    }
    if (step.do === 'time') {
      // Wall time for a batch of engine frames, with the clock already handed
      // over: what a held world costs per frame, rather than what the runner had
      // spare. Settled first, so an arrival is not charged to the steady state.
      await settle();
      const began = performance.now();
      await exec(holdScript([], step.frames ?? 300));
      const ms = performance.now() - began;
      const streaming = await exec('window.__estellaCooked.streaming()');
      console.log(`timing ${step.as}: ${JSON.stringify({
        frames: step.frames ?? 300, ms, msPerFrame: ms / (step.frames ?? 300), streaming,
      })}`);
      continue;
    }
    if (step.do === 'arrive') {
      // How long a gesture's worth of residency takes to finish — the load or the
      // unload it asked for, IO included, which is what a player waits through.
      const began = performance.now();
      if (step.key) await exec(tapScript(step.key, 1));
      const settled = await settle();
      const ms = performance.now() - began;
      const streaming = await exec('window.__estellaCooked.streaming()');
      console.log(`timing ${step.as}: ${JSON.stringify({ ms, settled, streaming })}`);
      continue;
    }
    if (step.do === 'hold') { await exec(holdScript(step.keys ?? [], step.frames ?? 30)); continue; }
    if (step.do === 'walkTo') {
      if (!(await calibrate())) { stop(); server.close(); return fail('holding a key moved the character nowhere', 1); }
      const goal = { x: step.x, z: step.z };
      const deadband = step.deadband ?? 30;
      let spent = 0;
      let last = await where();
      let stuck = 0;
      while (spent < (step.budget ?? BUDGET)) {
        const keys = keysToward(last, goal, deadband);
        if (keys.length === 0) break;
        await exec(holdScript(keys, 10));
        spent += 10;
        const now = await where();
        // A leg that stops moving has arrived at something else — a wall, or a
        // floor that is no longer there. Reporting it is the point of some legs.
        if (Math.hypot(now.x - last.x, now.z - last.z) < 1) stuck += 1; else stuck = 0;
        last = now;
        if (stuck >= (step.patience ?? 3)) break;
      }
      console.log(`  walked to (${last.x.toFixed(0)}, ${last.z.toFixed(0)}) in ${spent} frames`
        + (stuck >= (step.patience ?? 3) ? ' — stopped early' : ''));
      continue;
    }
    stop(); server.close();
    return fail(`unknown step "${step.do}"`, 2);
  }

  if (errors.length > 0) console.log(`  ${errors.length} console error(s): ${errors[0]}`);
  console.log('ok');
  stop();
  server.close();
  app.exit(0);
}

app.whenReady().then(main).catch((err) => fail(String(err), 2));
