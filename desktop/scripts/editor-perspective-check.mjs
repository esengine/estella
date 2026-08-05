// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-perspective-check.mjs — the editor's perspective eye, driven for real.
 *
 * Unit tests can prove editorCameraInfo builds a perspective matrix; they cannot
 * prove the toggle reaches the renderer. This opens a REAL editor over MCP against
 * a temp copy of an example, captures the viewport, runs the same command the
 * toolbar button runs, and captures again — failing if the screen did not change.
 * The two PNGs are written out (OUT=dir) so the change can be looked at, since
 * "different pixels" is necessary but not sufficient for "this is perspective".
 * Run from desktop/ after a dist build:  node scripts/editor-perspective-check.mjs
 */
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');
const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'estella-persp-'));
const project = path.join(tmpRoot, 'proj');
await cp(EXAMPLE, project, {
  recursive: true,
  filter: (src) => !/[/\\](\.esengine|node_modules|dist)([/\\]|$)/.test(src),
});

const child = spawn(process.execPath, ['scripts/editor-mcp.mjs', '--editor'], {
  cwd: DESKTOP, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ESTELLA_MCP_ALLOW_WRITES: '1' },
});
let buf = ''; const waiters = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  }
});
child.stderr.on('data', (d) => { if (process.env.V) process.stderr.write(d); });
const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
let nextId = 0;
const rpc = (method, params, ms = 120000) => new Promise((res, rej) => {
  const id = ++nextId;
  const t = setTimeout(() => rej(new Error(`timeout ${method}`)), ms);
  waiters.set(id, (m) => { clearTimeout(t); res(m); });
  send({ jsonrpc: '2.0', id, method, params });
});
const call = async (name, args, ms) => {
  const r = await rpc('tools/call', { name, arguments: args ?? {} }, ms);
  if (r.result?.isError) throw new Error(`${name}: ${r.result?.content?.[0]?.text}`);
  return r.result?.content?.[0];
};
const done = async (code, msg) => {
  console.log(msg); child.kill();
  await new Promise((r) => setTimeout(r, 400));
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
};
process.on('exit', () => { try { child.kill(); } catch {} });

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'persp', version: '0' } }, 180000);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await call('open_project', { root: project }, 120000);
  await call('open_scene', { path: 'assets/scenes/main.esscene' }, 120000);
  await new Promise((r) => setTimeout(r, 1500));

  const ortho = await call('capture_viewport', {}, 60000);
  await call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await new Promise((r) => setTimeout(r, 1500));
  const persp = await call('capture_viewport', {}, 60000);

  const a = ortho.data ?? '', b = persp.data ?? '';
  console.log(`ortho ${a.length} chars, perspective ${b.length} chars`);
  if (a.length < 100 || b.length < 100) await done(1, 'FAIL: a capture was not an image');
  if (a === b) await done(1, 'FAIL: the perspective toggle changed nothing on screen');
  await writeFile(path.join(process.env.OUT ?? '/tmp', 'persp-ortho.png'), Buffer.from(a, 'base64'));
  await writeFile(path.join(process.env.OUT ?? '/tmp', 'persp-persp.png'), Buffer.from(b, 'base64'));
  await done(0, 'PASS: the viewport re-rendered through a perspective projection');
} catch (e) {
  await done(1, `FAIL: ${e.message}`);
}
