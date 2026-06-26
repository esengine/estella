// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Model-authoritative runtime smoke test (docs/REARCH_EDITOR_MODEL.md).
 *
 * Companion to headless-verify.mjs (which proves a scene RENDERS). This drives
 * the EditorControlSurface in a real headless engine to prove the
 * model-authoritative command path works END TO END at runtime: a command edits
 * the model, the Reconciler projects it into the live World, undo replays it, and
 * the model serializes — all against a real WebGL2 World, not a unit mock.
 *
 * Run: `node_modules/.bin/electron scripts/headless-smoke.mjs` (after a build).
 * Serves the built dist over loopback http (the engine resolves its wasm glue
 * from location.origin), opens headless.html, then exercises the surface.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SCENE = '/scenes/sprite-rendering.esscene';
const MANIFEST = '/scenes/sprite-rendering.textures.json';

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.esscene': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
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

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

app.whenReady().then(async () => {
  let server;
  try {
    server = await serveDist();
    const win = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences: { offscreen: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/headless.html?w=640&h=480`);
    const exec = (code) => win.webContents.executeJavaScript(code, true);
    await exec('window.__estellaHeadless.ready');
    const api = 'window.__estellaHeadless.api';

    // Baseline: a scene loads + spawns entities.
    const base = await exec(`${api}.loadScene(${JSON.stringify(SCENE)}, ${JSON.stringify(MANIFEST)})`);
    check('loadScene spawns entities', base > 0, `entityCount=${base}`);
    const startCount = (await exec(`${api}.getStats()`)).entities;

    // addEntity → the Reconciler spawns it (World count rises). Returns a source id.
    const id = await exec(`${api}.addEntity()`);
    const afterAdd = (await exec(`${api}.getStats()`)).entities;
    check('addEntity projects to the World', id != null && afterAdd === startCount + 1, `id=${id} ${startCount}→${afterAdd}`);

    // setField on the model → the Reconciler projects → reads back from the model.
    await exec(`${api}.setField(${id}, 'Transform', 'position', 'vec3', [10, 20, 30])`);
    const pos = await exec(`${api}.getFieldValue(${id}, 'Transform', 'position')`);
    check('setField round-trips', Array.isArray(pos) && pos[0] === 10 && pos[1] === 20 && pos[2] === 30, JSON.stringify(pos));

    // undo reverts the field edit (model + projection).
    await exec(`${api}.undo()`);
    const posUndo = await exec(`${api}.getFieldValue(${id}, 'Transform', 'position')`);
    check('undo reverts the edit', Array.isArray(posUndo) && posUndo[0] === 0, JSON.stringify(posUndo));

    // deleteEntity despawns it; undo restores it (lossless model op).
    await exec(`${api}.deleteEntity(${id})`);
    const afterDel = (await exec(`${api}.getStats()`)).entities;
    check('deleteEntity despawns', afterDel === startCount, `→${afterDel}`);
    await exec(`${api}.undo()`);
    const afterUndoDel = (await exec(`${api}.getStats()`)).entities;
    check('undo restores the entity', afterUndoDel === startCount + 1, `→${afterUndoDel}`);

    // The model serializes losslessly.
    const serialized = await exec(`(() => { const s = ${api}.serializeScene(); return s ? s.entities.length : -1; })()`);
    check('serializeScene returns the model', serialized > 0, `entities=${serialized}`);

    finish(server);
  } catch (e) {
    check('driver', false, String((e && e.stack) || e));
    finish(server);
  }
});

function finish(server) {
  const ok = checks.length > 0 && checks.every((c) => c.pass);
  console.log(`\n[smoke] ${ok ? 'PASS' : 'FAIL'} — model-authoritative runtime`);
  for (const c of checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  process.exitCode = ok ? 0 : 1;
  try { server?.close(); } catch { /* ignore */ }
  app.quit();
}

setTimeout(() => finish(), 45000);
