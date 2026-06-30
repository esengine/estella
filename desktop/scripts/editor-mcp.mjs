// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp.mjs — the editor MCP server (headless host).
 *
 * An Electron entry that boots the SAME headless render host the render-verify runner
 * uses (serves dist/, opens headless.html, which publishes EditorControlSurface on
 * `window.__estellaHeadless`), then runs an MCP server over stdio whose tools are the
 * surface methods (see editor-mcp-tools.mjs). So an MCP client (an AI agent) can drive
 * the real editor surface headlessly — load/inspect/edit scenes, step, read stats —
 * with no live Electron UI. The surface stays the single source of truth; this is a
 * transport over it (EditorControlSurface.ts:7-9). Requires a built dist/ (vite build).
 *
 * stdout is the MCP JSON-RPC channel — ALL logging goes to stderr.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, listTools, runTool } from './editor-mcp-tools.mjs';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const W = Number(process.env.ESTELLA_MCP_W) || 1280;
const H = Number(process.env.ESTELLA_MCP_H) || 720;

app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // GPU-less WebGL2 fallback
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const log = (...a) => process.stderr.write(`[editor-mcp] ${a.join(' ')}\n`);

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
      if (!abs.startsWith(DIST)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(abs);
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' });
      res.end(bytes);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Keep the process alive on the hidden window (this is a long-running server).
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    const server = await serveDist();
    const url = `http://127.0.0.1:${server.address().port}/headless.html?w=${W}&h=${H}`;
    const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    win.webContents.on('console-message', (...args) => {
      const msg = args.map((a) => (a && typeof a === 'object' ? a.message ?? '' : String(a))).join(' ');
      if (/error|fail|unwind|exception|webgl/i.test(msg)) log('[renderer]', msg.slice(0, 240));
    });
    await win.loadURL(url);
    await win.webContents.executeJavaScript('window.__estellaHeadless.ready', true);
    log('headless engine ready');

    // Marshal a surface call into the headless renderer. `undefined` args become the JS
    // `undefined` literal so the surface's default parameters apply.
    const driver = (method, args) =>
      win.webContents.executeJavaScript(
        `window.__estellaHeadless.api.${method}(${(args ?? [])
          .map((a) => (a === undefined ? 'undefined' : JSON.stringify(a)))
          .join(',')})`,
        true,
      );

    const mcp = new Server({ name: 'estella-editor', version: '0.1.0' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));
    mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
      const tool = TOOLS.find((t) => t.name === req.params.name);
      if (!tool) return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true };
      return runTool(tool, driver, req.params.arguments);
    });
    await mcp.connect(new StdioServerTransport());
    log('MCP server connected over stdio');
  } catch (e) {
    log('FATAL', String((e && e.stack) || e));
    app.exit(1);
  }
});
