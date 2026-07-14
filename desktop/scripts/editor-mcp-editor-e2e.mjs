// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp-editor-e2e.mjs — end-to-end smoke for the EDITOR-host MCP mode.
 *
 * Spawns editor-mcp.mjs --editor (the real editor app with --mcp) against a TEMP
 * COPY of the platformer example and drives the full game-making loop over MCP:
 * open project → open scene → entity-template catalog → create entity → edit a
 * field → verify it reached the live World → screenshot → save → play → stop.
 * Run from desktop/ after a dist build:  node scripts/editor-mcp-editor-e2e.mjs
 * (ESTELLA_E2E_EXPORT=1 additionally runs a web export to the temp dir.)
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'platformer');

// Stage the example as a disposable project (transients filtered like the
// packaged templates are).
const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'estella-mcp-e2e-'));
const project = path.join(tmpRoot, 'platformer');
await cp(EXAMPLE, project, {
  recursive: true,
  filter: (src) => !/[/\\](\.esengine|node_modules|dist)([/\\]|$)/.test(src),
});

// An ORPHAN texture (no `.meta`) staged before open — "I dropped my art into
// the project folder and opened it" — the open scan must adopt it into the
// registry, and a cold assignment to it must light up live (guards below).
const ORPHAN_REL = 'assets/textures/orphan-e2e.png';
const ORPHAN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
await mkdir(path.join(project, 'assets', 'textures'), { recursive: true });
await writeFile(path.join(project, ORPHAN_REL), ORPHAN_PNG);

// ESTELLA_E2E_FRONT points at an alternate front (e.g. the shipped bundle,
// dist-electron/mcp/editor-mcp.mjs) to prove distribution artifacts end to end.
const front = process.env.ESTELLA_E2E_FRONT ?? 'scripts/editor-mcp.mjs';
const child = spawn(process.execPath, [front, '--editor'], {
  cwd: DESKTOP,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ESTELLA_MCP_ALLOW_WRITES: '1' },
});

let buf = '';
const waiters = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; } // skip stray non-JSON stdout
    if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  }
});
child.stderr.on('data', (d) => process.stderr.write(d));

const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
let nextId = 0;
const rpc = (method, params, timeoutMs = 60_000) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
  waiters.set(id, (m) => { clearTimeout(t); resolve(m); });
  send({ jsonrpc: '2.0', id, method, params });
});
const call = async (name, args, timeoutMs) => {
  const res = await rpc('tools/call', { name, arguments: args ?? {} }, timeoutMs);
  if (res.result?.isError) throw new Error(`${name}: ${res.result?.content?.[0]?.text}`);
  return res.result?.content?.[0];
};
const cleanup = async () => {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
};
const fail = async (m) => { console.log('EDITOR-E2E FAIL:', m); await cleanup(); process.exit(1); };

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'editor-e2e', version: '0' },
  }, 180_000);
  if (!init.result?.serverInfo) await fail('no serverInfo in initialize');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  console.log('initialize OK');

  const list = await rpc('tools/list', {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  for (const need of ['open_project', 'open_scene', 'list_entity_templates', 'create_entity', 'save_scene', 'screenshot', 'export_game'])
    if (!names.includes(need)) await fail(`tools/list missing ${need}`);
  console.log(`tools/list OK — ${names.length} tools`);

  await call('open_project', { root: project }, 120_000);
  console.log('open_project OK');

  // Opening a project stages the SDK types mirror — the project tsconfig's
  // `esengine` path must resolve for the IDE from the very first open (a
  // silently skipped mirror shipped "cannot find module 'esengine'" in 0.22).
  const sdkTypes = await stat(path.join(project, '.esengine', 'sdk', 'index.d.ts')).catch(() => null);
  if (!sdkTypes) await fail('.esengine/sdk/index.d.ts missing after open_project — SDK types staging broken');
  console.log('sdk types staged OK — .esengine/sdk/index.d.ts present');

  // No polling: open_scene's contract is "resolved = adopted", so the very next
  // tree read must already be populated (this line is the contract's regression
  // guard — do not add a retry loop here).
  await call('open_scene', { path: 'assets/scenes/main.esscene' }, 60_000);
  const tree = JSON.parse((await call('get_scene_tree')).text);
  if (!Array.isArray(tree) || tree.length === 0) await fail('scene tree empty after open_scene');
  console.log(`open_scene OK — ${tree.length} roots`);

  const templates = JSON.parse((await call('list_entity_templates')).text);
  if (!templates.some((t) => t.id === 'anchor:Sprite')) await fail('anchor:Sprite missing from entity templates');
  console.log(`list_entity_templates OK — ${templates.length} templates`);

  const before = JSON.parse((await call('get_stats')).text).entities;
  const created = Number((await call('create_entity', { template: 'anchor:Sprite', x: 64, y: 96 })).text);
  const after = JSON.parse((await call('get_stats')).text).entities;
  if (!Number.isFinite(created) || after <= before) await fail(`create_entity did not spawn (${before} -> ${after})`);
  console.log(`create_entity OK — id ${created} (${before} -> ${after} entities)`);

  // The fresh Sprite has no texture — the diagnostics sweep must flag it (the
  // same truth as the Details red asterisk, queryable instead of pixel-only).
  const diags = JSON.parse((await call('get_diagnostics')).text);
  if (!diags.some((d) => d.entity === created && d.problem === 'required-empty' && d.field === 'texture'))
    await fail(`get_diagnostics missed the fresh Sprite's empty texture (${JSON.stringify(diags).slice(0, 200)})`);
  console.log(`get_diagnostics OK — flagged Sprite.texture on the new entity`);

  // — Hot-asset chain guards (the white-box family) —
  // The orphan staged before open had no `.meta`: the open scan must have
  // adopted it, and a COLD texture assignment must light up the live World with
  // NO project reopen (set_field → touch → async load → re-project). Polling is
  // the contract here: the load is async, but it must CONVERGE.
  await call('set_field', { entity: created, component: 'Sprite', key: 'texture', type: 'asset', value: ORPHAN_REL });
  let handle = 0;
  for (let i = 0; i < 50 && handle === 0; i++) {
    const sprite = JSON.parse((await call('world_component', { id: created, component: 'Sprite' })).text);
    handle = sprite?.texture ?? 0;
    if (handle === 0) await new Promise((r) => setTimeout(r, 100));
  }
  if (handle === 0) await fail('cold Sprite.texture never resolved to a live handle — hot-load chain broken');
  console.log(`hot texture OK — orphan adopted at open + cold set_field lit up (handle ${handle})`);

  // A ref to a file that does NOT exist must surface as a queryable diagnostic:
  // the model value looks healthy — only the registry knows the ref is dead.
  await call('set_field', { entity: created, component: 'Sprite', key: 'texture', type: 'asset', value: 'assets/textures/does-not-exist.png' });
  const deadDiags = JSON.parse((await call('get_diagnostics')).text);
  if (!deadDiags.some((d) => d.entity === created && d.problem === 'asset-unresolved'))
    await fail(`get_diagnostics missed the dead texture ref (${JSON.stringify(deadDiags).slice(0, 200)})`);
  await call('set_field', { entity: created, component: 'Sprite', key: 'texture', type: 'asset', value: ORPHAN_REL });
  console.log('asset-unresolved diagnostic OK — a dead ref is queryable, not just a white box');

  await call('set_field', { entity: created, component: 'Transform', key: 'position', type: 'vec3', value: [64, 96, 0] });
  const live = JSON.parse((await call('world_component', { id: created, component: 'Transform' })).text);
  if (!live) await fail('world_component returned null — edit did not reach the World');
  console.log('set_field + world_component OK — edit reached the live World');

  const shot = await call('screenshot');
  if (shot.type !== 'image' || (shot.data?.length ?? 0) < 100) await fail('screenshot not a PNG image block');
  console.log(`screenshot OK — ${shot.data.length} base64 chars`);

  const scenePath = path.join(project, 'assets', 'scenes', 'main.esscene');
  const mtimeBefore = (await stat(scenePath)).mtimeMs;
  await call('save_scene', {}, 60_000);
  const mtimeAfter = (await stat(scenePath)).mtimeMs;
  if (mtimeAfter <= mtimeBefore) await fail('save_scene did not rewrite the scene file');
  console.log('save_scene OK — scene file rewritten');

  await call('toggle_play', {}, 60_000);
  let play = null;
  for (let i = 0; i < 60; i++) {
    play = JSON.parse((await call('get_play_state')).text);
    if (play.ready || play.error) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!play?.ready) await fail(`play realm never became ready (${JSON.stringify(play)})`);
  const playShot = await call('screenshot');
  if (playShot.type !== 'image') await fail('screenshot during play failed');
  // The gameplay-state probe reaches the estella:// OOPIF and sees __estellaPlay.
  const probe = JSON.parse((await call('play_probe', { code: 'typeof window.__estellaPlay' })).text);
  if (probe !== 'object') await fail(`play_probe: __estellaPlay not present (${probe})`);
  await call('toggle_play', {}, 60_000);
  console.log('play OK — realm ready, screenshot + probe captured, stopped');

  if (process.env.ESTELLA_E2E_EXPORT === '1') {
    const outDir = path.join(tmpRoot, 'export-web');
    const result = JSON.parse((await call('export_game', { platform: 'web', outDir }, 300_000)).text);
    const index = await stat(path.join(outDir, 'index.html')).catch(() => null);
    if (!index) await fail(`export_game produced no index.html (${JSON.stringify(result).slice(0, 200)})`);
    console.log('export_game OK — web export written');
  }

  console.log('\nEDITOR-E2E PASS — MCP drives the real editor end-to-end (project → scene → entity → save → play)');
  await cleanup();
  process.exit(0);
} catch (e) {
  await fail(String(e?.message ?? e));
}
