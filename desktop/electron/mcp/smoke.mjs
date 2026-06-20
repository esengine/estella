/**
 * @file  MCP smoke test (docs/REARCH_EDITOR_AUTOMATION.md P2). Run by node: spawns
 *        the Electron-hosted editor MCP server over stdio (the way a real MCP
 *        client would), then lists tools/resources and drives a load → step →
 *        read tree → capture → mutate round-trip, asserting each. Proves the MCP
 *        transport correctly exposes the editor surface end-to-end.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const electronBin = path.resolve(here, '..', '..', 'node_modules', '.bin', 'electron');
const serverPath = path.resolve(here, 'server.mjs');

const checks = [];
const check = (name, cond, detail = '') => {
  checks.push({ name, ok: !!cond });
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? '  → ' + detail : ''}`);
};

const transport = new StdioClientTransport({
  command: electronBin,
  args: [serverPath],
  env: { ...process.env, ESTELLA_MCP_ALLOW_WRITES: '1' },
  stderr: 'inherit',
});
const client = new Client({ name: 'estella-smoke', version: '0.0.0' }, { capabilities: {} });

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  check(
    'listTools includes core tools',
    ['editor_load_scene', 'editor_step', 'editor_capture_viewport', 'editor_get_scene_tree'].every((n) => names.includes(n)),
    names.join(','),
  );
  check('write tool exposed under ALLOW_WRITES', names.includes('editor_add_entity'));

  const load = await client.callTool({
    name: 'editor_load_scene',
    arguments: { scene: '/scenes/sprite-rendering.esscene', manifest: '/scenes/sprite-rendering.textures.json' },
  });
  check('load_scene returns an entity count', /loaded \d+ entities/.test(load.content?.[0]?.text ?? ''), load.content?.[0]?.text);

  await client.callTool({ name: 'editor_step', arguments: { frames: 30 } });

  const tree = await client.callTool({ name: 'editor_get_scene_tree' });
  let treeLen = 0;
  try {
    treeLen = JSON.parse(tree.content[0].text).length;
  } catch {
    /* leave 0 */
  }
  check('get_scene_tree returns nodes', treeLen > 0, `${treeLen} roots`);

  const cap = await client.callTool({ name: 'editor_capture_viewport' });
  const img = cap.content?.[0];
  check(
    'capture_viewport returns a PNG image block',
    img?.type === 'image' && img?.mimeType === 'image/png' && (img?.data?.length ?? 0) > 100,
    `${img?.data?.length ?? 0} base64 chars`,
  );

  const add = await client.callTool({ name: 'editor_add_entity' });
  check('add_entity (write) spawns an entity', /entity \d+/.test(add.content?.[0]?.text ?? ''), add.content?.[0]?.text);

  const { resources } = await client.listResources();
  check('listResources includes scene tree', resources.some((r) => r.uri === 'editor://scene/tree'));
  const res = await client.readResource({ uri: 'editor://scene/tree' });
  check('readResource(scene/tree) returns json', (res.contents?.[0]?.text?.length ?? 0) > 2);
} catch (e) {
  check('connect + drive the server', false, String((e && e.stack) || e));
} finally {
  await client.close().catch(() => {});
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n[mcp:smoke] ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${checks.length - failed.length}/${checks.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
