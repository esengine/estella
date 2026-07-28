// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp-host.mjs — the Electron half of the editor MCP server.
 *
 * Boots the SAME headless render host the render-verify runner uses (serves dist/,
 * opens headless.html, which publishes EditorControlSurface on `window.__estellaHeadless`)
 * and exposes ONE internal HTTP endpoint on 127.0.0.1 — POST /exec — that marshals a
 * surface call (or a renderer-code snippet) into the renderer via executeJavaScript.
 *
 * The MCP protocol itself lives in the plain-node front (editor-mcp.mjs). It cannot
 * live here: an Electron main process never receives piped stdin on Windows (it ends
 * immediately), so an Electron-hosted StdioServerTransport is structurally dead on
 * one of our three platforms. The front owns stdio; this host only executes.
 *
 * Auth: every request must carry the token the front passed via ESTELLA_MCP_TOKEN
 * (the socket binds to loopback, the token keeps other local processes out).
 * Readiness: prints `MCP_HOST_READY {"port":N}` on stdout once the engine is up.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExecEndpoint } from './mcp-exec-endpoint.mjs';
import { onRendererConsole } from './rendererConsole.mjs';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TOKEN = process.env.ESTELLA_MCP_TOKEN;
const PARENT_PID = Number(process.env.ESTELLA_MCP_PARENT_PID) || 0;
const W = Number(process.env.ESTELLA_MCP_W) || 1280;
const H = Number(process.env.ESTELLA_MCP_H) || 720;

app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // GPU-less WebGL2 fallback
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const log = (...a) => process.stderr.write(`[editor-mcp-host] ${a.join(' ')}\n`);

if (!TOKEN) {
  log('FATAL: ESTELLA_MCP_TOKEN is required (spawn this host through editor-mcp.mjs)');
  app.exit(1);
}

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

// Keep the process alive on the hidden window (this is a long-running host).
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    const assets = await serveDist();
    const url = `http://127.0.0.1:${assets.address().port}/headless.html?w=${W}&h=${H}`;
    const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: false } });
    onRendererConsole(win.webContents, (msg) => {
      if (/error|fail|unwind|exception|webgl/i.test(msg)) log('[renderer]', msg.slice(0, 240));
    });
    await win.loadURL(url);
    await win.webContents.executeJavaScript('window.__estellaHeadless.ready', true);
    log('headless engine ready');

    // The exec endpoint: marshal a surface call ({method, args}) or a renderer-code
    // snippet ({js}) into the headless renderer. `undefined` args become the JS
    // `undefined` literal so the surface's default parameters apply. Editor-only
    // tools (root: 'editor' — project/asset/play operations) have no meaning in a
    // fixtures host; fail them with the pointer to the right host.
    const exec = await createExecEndpoint({
      token: TOKEN,
      run: async ({ method, args, root, js, op }) => {
        if (op === 'screenshot') {
          const image = await win.webContents.capturePage();
          return image.toPNG().toString('base64');
        }
        if (root === 'editor') {
          throw new Error(`${method} needs the live editor host — connect through editor-mcp.mjs --editor (or --attach)`);
        }
        const code = js ?? `window.__estellaHeadless.api.${method}(${(args ?? [])
          .map((a) => (a === undefined ? 'undefined' : JSON.stringify(a)))
          .join(',')})`;
        return win.webContents.executeJavaScript(code, true);
      },
    });

    // The front reads this line to learn the port; everything else goes to stderr.
    process.stdout.write(`MCP_HOST_READY ${JSON.stringify({ port: exec.address().port })}\n`);

    // Insurance against an orphaned host: if the front dies without killing us
    // (SIGKILL), notice the parent pid vanishing and exit.
    if (PARENT_PID) {
      setInterval(() => {
        try { process.kill(PARENT_PID, 0); } catch { app.exit(0); }
      }, 10_000).unref();
    }
  } catch (e) {
    log('FATAL', String((e && e.stack) || e));
    app.exit(1);
  }
});
