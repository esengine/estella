// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp-e2e.mjs — end-to-end smoke for the editor MCP server.
 *        Spawns editor-mcp.mjs and drives the MCP stdio handshake (initialize →
 *        tools/list → tools/call), exercising the full path: stdio transport → SDK
 *        Server → executeJavaScript driver → EditorControlSurface → engine. Run from
 *        desktop/ after a dist build:  pnpm editor:mcp:e2e
 *
 *        The walk is everything a client needs before it can do anything useful —
 *        a scene load, a read, the write path, a stepped capture that has to come
 *        back as a real PNG block, the resources side — so a break in any of it is
 *        a break in all of it. The plumbing lives in lib/editorDriver.mjs; this
 *        file is the walk.
 */
import { withEditor, checker } from './lib/editorDriver.mjs';

const failures = await withEditor(async (ed) => {
  const check = checker();

  const list = await ed.rpc('tools/list', {}, 30000);
  const names = (list.result?.tools ?? []).map((t) => t.name);
  check(names.includes('load_scene') && names.includes('get_scene_tree'), `tools/list missing tools: ${names}`);
  console.log(`tools/list OK — ${names.length} tools`);

  const loaded = await ed.call('load_scene', {
    sceneUrl: '/scenes/sprite-rendering.esscene',
    manifestUrl: '/scenes/sprite-rendering.textures.json',
  }, 60000);
  console.log('load_scene OK — entityCount:', loaded?.text);

  const tree = await ed.json('get_scene_tree', {}, 30000);
  check(Array.isArray(tree) && tree.length > 0, 'get_scene_tree returned no nodes');
  console.log(`get_scene_tree OK — ${tree.length} root nodes`);

  // Write path (the server is spawned with ESTELLA_MCP_ALLOW_WRITES=1).
  const newId = Number((await ed.call('add_entity', {}, 30000))?.text);
  check(Number.isFinite(newId), 'add_entity did not return an id');
  console.log('add_entity OK — id', newId);
  await ed.call('set_field', {
    entity: newId, component: 'Transform', key: 'position', type: 'vec3', value: [64, 32, 0],
  }, 30000);
  console.log('set_field OK');

  // Observation: a stepped frame captures as a real PNG image content block.
  await ed.call('step', { frames: 2 }, 30000);
  const img = await ed.call('capture_viewport', {}, 60000);
  check(
    img?.type === 'image' && img?.mimeType === 'image/png' && (img?.data?.length ?? 0) >= 100,
    `capture_viewport did not return a PNG image block (${JSON.stringify(img)?.slice(0, 120)})`,
  );
  console.log(`capture_viewport OK — ${img?.data?.length} base64 chars`);

  // Resources: list + read the scene tree as an MCP resource.
  const resList = await ed.rpc('resources/list', {}, 30000);
  const uris = (resList.result?.resources ?? []).map((r) => r.uri);
  check(uris.includes('editor://scene/tree'), `resources/list missing scene tree: ${uris}`);
  const resRead = await ed.rpc('resources/read', { uri: 'editor://scene/tree' }, 30000);
  check((resRead.result?.contents?.[0]?.text?.length ?? 0) >= 3, 'resources/read returned no JSON');
  console.log('resources OK — list + read scene tree');

  return check.failures;
}, { mode: 'headless', client: 'e2e' });

if (failures.length) {
  console.error('\nE2E FAIL:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nE2E PASS — MCP server drives EditorControlSurface end-to-end');
process.exit(0);
