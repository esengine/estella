// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp-e2e.mjs — end-to-end smoke for the editor MCP server.
 *        Spawns editor-mcp.mjs and drives the MCP stdio handshake (initialize →
 *        tools/list → tools/call), exercising the full path: stdio transport → SDK
 *        Server → executeJavaScript driver → EditorControlSurface → engine. Run from
 *        desktop/ after a dist build:  pnpm editor:mcp:e2e
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The server front is plain node (the Electron half is spawned by the front itself).
const child = spawn(process.execPath, ['scripts/editor-mcp.mjs'], {
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
const rpc = (id, method, params) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30000);
  waiters.set(id, (m) => { clearTimeout(t); resolve(m); });
  send({ jsonrpc: '2.0', id, method, params });
});
const fail = (m) => { console.log('E2E FAIL:', m); child.kill(); process.exit(1); };

try {
  const init = await rpc(1, 'initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' },
  });
  if (!init.result?.serverInfo) fail('no serverInfo in initialize');
  console.log('initialize OK — server:', init.result.serverInfo.name);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const list = await rpc(2, 'tools/list', {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  if (!names.includes('load_scene') || !names.includes('get_scene_tree')) fail(`tools/list missing tools: ${names}`);
  console.log(`tools/list OK — ${names.length} tools`);

  const load = await rpc(3, 'tools/call', {
    name: 'load_scene',
    arguments: { sceneUrl: '/scenes/sprite-rendering.esscene', manifestUrl: '/scenes/sprite-rendering.textures.json' },
  });
  if (load.result?.isError) fail(`load_scene error: ${load.result?.content?.[0]?.text}`);
  console.log('load_scene OK — entityCount:', load.result?.content?.[0]?.text);

  const tree = await rpc(4, 'tools/call', { name: 'get_scene_tree', arguments: {} });
  if (tree.result?.isError) fail(`get_scene_tree error: ${tree.result?.content?.[0]?.text}`);
  const parsed = JSON.parse(tree.result?.content?.[0]?.text ?? 'null');
  if (!Array.isArray(parsed) || parsed.length === 0) fail('get_scene_tree returned no nodes');
  console.log(`get_scene_tree OK — ${parsed.length} root nodes`);

  // Write path (server spawned with ESTELLA_MCP_ALLOW_WRITES=1): spawn + mutate.
  const add = await rpc(5, 'tools/call', { name: 'add_entity', arguments: {} });
  const newId = Number(add.result?.content?.[0]?.text);
  if (add.result?.isError || !Number.isFinite(newId)) fail(`add_entity error: ${add.result?.content?.[0]?.text}`);
  console.log('add_entity OK — id', newId);
  const set = await rpc(6, 'tools/call', {
    name: 'set_field',
    arguments: { entity: newId, component: 'Transform', key: 'position', type: 'vec3', value: [64, 32, 0] },
  });
  if (set.result?.isError) fail(`set_field error: ${set.result?.content?.[0]?.text}`);
  console.log('set_field OK');

  // Observation: a stepped frame captures as a real PNG image content block.
  await rpc(7, 'tools/call', { name: 'step', arguments: { frames: 2 } });
  const cap = await rpc(8, 'tools/call', { name: 'capture_viewport', arguments: {} });
  const img = cap.result?.content?.[0];
  if (cap.result?.isError || img?.type !== 'image' || img?.mimeType !== 'image/png' || (img?.data?.length ?? 0) < 100)
    fail(`capture_viewport did not return a PNG image block (${JSON.stringify(img)?.slice(0, 120)})`);
  console.log(`capture_viewport OK — ${img.data.length} base64 chars`);

  // Resources: list + read the scene tree as an MCP resource.
  const resList = await rpc(9, 'resources/list', {});
  const uris = (resList.result?.resources ?? []).map((r) => r.uri);
  if (!uris.includes('editor://scene/tree')) fail(`resources/list missing scene tree: ${uris}`);
  const resRead = await rpc(10, 'resources/read', { uri: 'editor://scene/tree' });
  if ((resRead.result?.contents?.[0]?.text?.length ?? 0) < 3) fail('resources/read returned no JSON');
  console.log('resources OK — list + read scene tree');

  console.log('\nE2E PASS — MCP server drives EditorControlSurface end-to-end');
  child.kill();
  process.exit(0);
} catch (e) {
  fail(String(e?.message ?? e));
}
