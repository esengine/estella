/**
 * @file  Editor MCP server (docs/REARCH_EDITOR_AUTOMATION.md P2).
 *
 * Exposes the editor's EditorControlSurface as MCP tools + resources so an agent
 * can open a scene, mutate it, advance frames, and read back the scene tree and
 * the rendered viewport. It is a TRANSPORT ADAPTER over the surface, not a
 * parallel API: it hosts the proven headless render host (static-serves dist/,
 * opens a show:false window on headless.html) and maps each MCP call to
 * `window.__estellaHeadless.api.<method>` via executeJavaScript — the same path
 * the verify runner uses.
 *
 * Transport: stdio (an agent spawns this as a subprocess). stdout carries ONLY
 * JSON-RPC; every log goes to stderr so the protocol stream stays clean.
 *
 * Permission: reads + observation always allowed; mutations are gated behind
 * ESTELLA_MCP_ALLOW_WRITES so an agent can't silently rewrite a project.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const ALLOW_WRITES = process.env.ESTELLA_MCP_ALLOW_WRITES === '1';
const W = Number(process.env.ESTELLA_MCP_W) || 1280;
const H = Number(process.env.ESTELLA_MCP_H) || 720;

// stdout is the JSON-RPC channel — keep ALL diagnostics on stderr.
const log = (...a) => process.stderr.write('[mcp] ' + a.join(' ') + '\n');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.esscene': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
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

// Render the viewport to a top-down PNG (base64) for an MCP image content block.
// Runs in the renderer (has document): captureViewport returns bottom-up GL rows,
// so flip Y into a 2D canvas before toDataURL.
const CAPTURE_PNG = `(() => {
  const c = window.__estellaHeadless.api.captureViewport();
  const { rgba, width, height } = c;
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    img.data.set(rgba.subarray(src, src + width * 4), y * width * 4);
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png').split(',')[1];
})()`;

const text = (t) => ({ content: [{ type: 'text', text: String(t) }] });
const errorResult = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

// — Tool catalog. Each maps to a surface call run in the renderer. `write` tools
//   need ESTELLA_MCP_ALLOW_WRITES. Prescriptive descriptions state when to call. —
const TOOLS = [
  {
    name: 'editor_load_scene',
    description: 'Load a scene (.esscene) into the editor World, resolving asset refs via the texture manifest. Call this first to set up a known scene before stepping or capturing.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['scene'],
      properties: {
        scene: { type: 'string', description: 'Scene URL served by the editor, e.g. /scenes/sprite-rendering.esscene' },
        manifest: { type: 'string', description: 'Optional uuid→texture manifest URL' },
      },
    },
    run: (exec, a) =>
      exec(`window.__estellaHeadless.api.loadScene(${JSON.stringify(a.scene)}${a.manifest ? `, ${JSON.stringify(a.manifest)}` : ''})`)
        .then((n) => text(`loaded ${n} entities`)),
  },
  {
    name: 'editor_step',
    description: 'Advance the engine by N fixed-delta frames (no wall-clock) so a following capture is reproducible. Call after loading a scene and before capturing.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        frames: { type: 'integer', minimum: 1, description: 'Frames to advance (default 1)' },
        dt: { type: 'number', description: 'Seconds per frame (default 1/60)' },
      },
    },
    run: (exec, a) =>
      exec(`window.__estellaHeadless.api.step(${Number(a.frames) || 1}, ${Number(a.dt) || 1 / 60})`).then(() => text('ok')),
  },
  {
    name: 'editor_get_scene_tree',
    description: 'Read the scene outliner tree (entity ids, names, kinds, hierarchy) as JSON.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    run: (exec) => exec(`JSON.stringify(window.__estellaHeadless.api.getSceneTree())`).then(text),
  },
  {
    name: 'editor_get_inspector',
    description: 'Read the full editable inspector model (components + fields) for one entity, as JSON.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['entity'],
      properties: { entity: { type: 'integer', description: 'Entity id from the scene tree' } },
    },
    run: (exec, a) => exec(`JSON.stringify(window.__estellaHeadless.api.getInspector(${Number(a.entity)}))`).then(text),
  },
  {
    name: 'editor_get_stats',
    description: 'Read live engine stats (entity count) as JSON.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    run: (exec) => exec(`JSON.stringify(window.__estellaHeadless.api.getStats())`).then(text),
  },
  {
    name: 'editor_capture_viewport',
    description: 'Render the current viewport and return it as a PNG image, so you can SEE what the editor drew. Step the scene first for a settled frame.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    run: (exec) => exec(CAPTURE_PNG).then((b64) => ({ content: [{ type: 'image', data: b64, mimeType: 'image/png' }] })),
  },
  {
    name: 'editor_add_entity',
    description: 'Spawn a new empty entity (with a Transform). Returns its id. Undoable. Requires write permission.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    write: true,
    run: (exec) => exec(`window.__estellaHeadless.api.addEntity()`).then((id) => text(`entity ${id}`)),
  },
  {
    name: 'editor_set_field',
    description: 'Write one inspector field on a component (e.g. Transform.position). Undoable. Requires write permission.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['entity', 'component', 'key', 'type', 'value'],
      properties: {
        entity: { type: 'integer' },
        component: { type: 'string', description: 'Component name, e.g. Transform' },
        key: { type: 'string', description: 'Field key, e.g. position' },
        type: { type: 'string', enum: ['number', 'bool', 'string', 'vec2', 'vec3', 'angle', 'color'] },
        value: { description: 'Value matching the field type (vec2/vec3 = number array, color = hex string)' },
      },
    },
    write: true,
    run: (exec, a) =>
      exec(`window.__estellaHeadless.api.setField(${Number(a.entity)}, ${JSON.stringify(a.component)}, ${JSON.stringify(a.key)}, ${JSON.stringify(a.type)}, ${JSON.stringify(a.value)})`).then(() => text('ok')),
  },
];

const RESOURCES = [
  { uri: 'editor://scene/tree', name: 'Scene tree', mimeType: 'application/json', code: `JSON.stringify(window.__estellaHeadless.api.getSceneTree())` },
  { uri: 'editor://stats', name: 'Engine stats', mimeType: 'application/json', code: `JSON.stringify(window.__estellaHeadless.api.getStats())` },
];

function buildMcpServer(exec) {
  const server = new Server(
    { name: 'estella-editor', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.filter((t) => !t.write || ALLOW_WRITES).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) return errorResult(`unknown tool: ${req.params.name}`);
    if (tool.write && !ALLOW_WRITES) return errorResult(`tool ${tool.name} needs write permission (set ESTELLA_MCP_ALLOW_WRITES=1)`);
    try {
      return await tool.run(exec, req.params.arguments ?? {});
    } catch (e) {
      return errorResult(`${tool.name} failed: ${String((e && e.message) || e)}`);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const r = RESOURCES.find((x) => x.uri === req.params.uri);
    if (!r) throw new Error(`unknown resource: ${req.params.uri}`);
    const t = await exec(r.code);
    return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: String(t) }] };
  });

  return server;
}

app.whenReady().then(async () => {
  // Boot the headless host in the background; the MCP transport connects first so
  // the handshake / tools.list answer instantly, and tool calls await the host.
  let win = null;
  const hostReady = (async () => {
    const httpServer = await serveDist();
    const url = `http://127.0.0.1:${httpServer.address().port}/headless.html?w=${W}&h=${H}`;
    win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    win.webContents.on('console-message', (...args) => {
      const msg = args.map((x) => (x && typeof x === 'object' ? x.message ?? '' : String(x))).join(' ');
      if (/error|fail|unwind|exception/i.test(msg)) log('[renderer]', msg.slice(0, 200));
    });
    await win.loadURL(url);
    await win.webContents.executeJavaScript('window.__estellaHeadless.ready', true);
    log(`headless host ready (writes ${ALLOW_WRITES ? 'ENABLED' : 'disabled'})`);
    return win;
  })();
  hostReady.catch((e) => log('host boot failed:', String((e && e.stack) || e)));

  const exec = async (code) => {
    const w = await hostReady;
    return w.webContents.executeJavaScript(code, true);
  };

  try {
    await buildMcpServer(exec).connect(new StdioServerTransport());
    log('mcp server connected on stdio');
  } catch (e) {
    log('fatal:', String((e && e.stack) || e));
    app.quit();
  }
});

// Keep the process alive for the stdio session; exit when stdin closes (client gone).
process.stdin.on('close', () => app.quit());
app.on('window-all-closed', () => {
  /* keep running for stdio */
});
