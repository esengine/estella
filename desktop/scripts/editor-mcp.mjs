// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp.mjs — the editor MCP server (stdio front, plain node).
 *
 * An MCP client (an AI agent) spawns this with node; it stands up an Estella
 * host and serves the MCP tool registry (editor-mcp-tools.mjs) over stdio,
 * forwarding each call to the host's loopback /exec endpoint. Three host modes:
 *
 *   (default)          spawn the headless render host (fixtures; scene tools only;
 *                      dev repo only)
 *   --editor           spawn the REAL editor app with --mcp — the full game-making
 *                      surface: projects, assets, entity templates, play, export.
 *                      In the dev repo this is `electron .`; from the installed
 *                      editor (this file ships bundled under app.asar.unpacked)
 *                      the exe is auto-detected, or pass --editor-exe <path>.
 *   --attach [file]    connect to an already-running editor's endpoint via its
 *                      discovery file (<userData>/mcp-endpoint.json) — drive the
 *                      editor the user is looking at. The path is optional: the
 *                      standard userData locations are probed. Resolution is
 *                      LAZY and re-done per call, so this server starts before
 *                      the editor does and survives an editor restart.
 *
 * Split on purpose: an Electron main process never receives piped stdin on
 * Windows, so the MCP protocol must live in a plain-node process. The surface
 * stays the single source of truth; registry + this transport add no editor
 * truth of their own (EditorControlSurface.ts:7-9).
 *
 * stdout is the MCP JSON-RPC channel — ALL logging goes to stderr.
 * Mutating tools require ESTELLA_MCP_ALLOW_WRITES=1 (hidden + refused otherwise).
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, RESOURCES, listTools, runTool } from './editor-mcp-tools.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The desktop package root, for dev spawns (`electron .`). This file runs from
// scripts/ in the repo but from dist-electron/mcp/ as the shipped bundle, so
// walk up to the nearest package.json instead of assuming one level.
const DESKTOP = (() => {
  let dir = HERE;
  for (let i = 0; i < 4; i++) {
    dir = path.dirname(dir);
    if (existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return path.resolve(HERE, '..');
})();
const ALLOW_WRITES = process.env.ESTELLA_MCP_ALLOW_WRITES === '1';
const log = (...a) => process.stderr.write(`[editor-mcp] ${a.join(' ')}\n`);

const argv = process.argv.slice(2);
const MODE = argv.includes('--editor') || argv.includes('--editor-exe')
  ? 'editor'
  : argv.includes('--attach') ? 'attach' : 'headless';
// When this file ships inside the installed editor it lives under
// resources/app.asar.unpacked/dist-electron/mcp/ — four levels below the install
// root (three on macOS, where the exe sits in Contents/MacOS instead).
const PACKAGED = /app\.asar\.unpacked/.test(HERE);

const argValue = (flag) => {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
};

/** The installed editor executable, derived from this bundle's unpacked path. */
function installedEditorExe() {
  const resources = path.resolve(HERE, '..', '..', '..'); // …/resources
  if (process.platform === 'darwin') return path.resolve(resources, '..', 'MacOS', 'Estella Editor');
  return path.resolve(resources, '..', process.platform === 'win32' ? 'estella-editor.exe' : 'estella-editor');
}

/** Spawn an Estella host (headless fixtures, dev editor, or installed editor)
 *  and resolve its /exec endpoint from the MCP_HOST_READY stdout line. */
function spawnHost(mode, token) {
  const editorExe = argValue('--editor-exe') ?? (PACKAGED && mode === 'editor' ? installedEditorExe() : undefined);
  let command;
  let args;
  if (editorExe) {
    command = editorExe;
    args = ['--mcp'];
  } else if (PACKAGED) {
    log('FATAL: the headless host is dev-repo only — use --editor (or --attach) with the installed editor');
    process.exit(1);
  } else {
    // Under plain node the electron package's export IS the binary path — works on
    // every platform (the .bin/ shim is a sh script Windows cannot spawn).
    command = createRequire(import.meta.url)('electron');
    args = mode === 'editor' ? ['.', '--mcp'] : [path.join(HERE, 'editor-mcp-host.mjs')];
  }
  const host = spawn(command, args, {
    // An installed exe needs no cwd (and the repo layout may not exist there).
    cwd: editorExe ? undefined : DESKTOP,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ESTELLA_MCP_TOKEN: token,
      ESTELLA_MCP_PARENT_PID: String(process.pid),
    },
  });
  host.stderr.on('data', (d) => process.stderr.write(d));
  host.on('exit', (code) => {
    log(`host exited (${code}) — shutting down`);
    process.exit(code === 0 ? 0 : 1);
  });
  const killHost = () => { try { host.kill(); } catch { /* already gone */ } };
  process.on('exit', killHost);

  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('host did not become ready in 120s')), 120_000);
    host.stdout.on('data', (d) => {
      buf += d.toString();
      const m = /^MCP_HOST_READY (\{.*\})$/m.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(JSON.parse(m[1]).port);
      }
    });
  });
}

/** Where a `--mcp` editor advertises its endpoint. Electron's userData is
 *  <appData>/<app name>: the dev app takes it from package.json (`@estella/editor`),
 *  the installed one from electron-builder's productName (`Estella Editor`). */
function attachCandidates() {
  const explicit = argValue('--attach') ?? process.env.ESTELLA_MCP_DISCOVERY;
  if (explicit) return [explicit];
  const appData = process.platform === 'win32'
    ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  return [path.join('@estella', 'editor'), 'Estella Editor']
    .map((dir) => path.join(appData, dir, 'mcp-endpoint.json'));
}

/** The live endpoint from the first discovery file whose editor is still running,
 *  or null. A crashed editor leaves its file behind, so the recorded pid is the
 *  liveness check — attaching to a dead port would hang every call instead. */
function readEndpoint() {
  for (const file of attachCandidates()) {
    if (!existsSync(file)) continue;
    try {
      const { port: p, token: t, pid } = JSON.parse(readFileSync(file, 'utf8'));
      if (!p || !t) continue;
      if (pid) {
        try { process.kill(pid, 0); } catch { continue; } // stale file, editor is gone
      }
      return { port: p, token: t, file };
    } catch { /* torn or unreadable write — try the next candidate */ }
  }
  return null;
}

let endpoint = null;
if (MODE === 'attach') {
  // Resolution is deliberately LAZY: this server is spawned by the MCP client at
  // session start, typically BEFORE the user's editor is up. Failing here would
  // make attach mode unusable, so resolve per call instead — which also means an
  // editor restart (new port + token) is picked up without restarting the client.
  endpoint = readEndpoint();
  log(endpoint
    ? `attached to editor on 127.0.0.1:${endpoint.port} (${endpoint.file})`
    : `no editor yet — will attach on first call (looking for ${attachCandidates().join(' | ')})`);
} else {
  const token = randomBytes(24).toString('hex');
  const port = await spawnHost(MODE, token).catch((e) => {
    log('FATAL', e.message);
    process.exit(1);
  });
  endpoint = { port, token };
}
process.stdin.on('close', () => process.exit(0));
log(`${MODE} host ready (writes ${ALLOW_WRITES ? 'ENABLED' : 'disabled'})`);

/** The endpoint to talk to, re-resolving in attach mode when we have none. */
function currentEndpoint() {
  if (!endpoint && MODE === 'attach') endpoint = readEndpoint();
  if (!endpoint) {
    throw new Error(
      'no running editor to attach to — start the Estella editor with --mcp '
      + `(looked for ${attachCandidates().join(' | ')})`,
    );
  }
  return endpoint;
}

async function post(body) {
  // A transport failure means the editor went away (restart/quit), not a tool
  // error: drop the cached endpoint and re-resolve once before giving up.
  for (let attempt = 0; ; attempt++) {
    const { port, token } = currentEndpoint();
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${port}/exec`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-estella-mcp-token': token },
        body: JSON.stringify(body),
      });
    } catch (e) {
      endpoint = MODE === 'attach' && attempt === 0 ? readEndpoint() : null;
      if (endpoint) continue; // editor restarted on a new port
      throw new Error(`editor endpoint unreachable on 127.0.0.1:${port} (${e.message})`);
    }
    const out = await res.json();
    if (!out.ok) throw new Error(out.error);
    return out.hasResult ? out.result : undefined;
  }
}

// The registry's driver: surface/editor method calls, renderer-code snippets,
// and main-process ops.
const driver = (method, args, root) => post({ method, args, root });
driver.js = (js) => post({ js });
driver.op = (op, input) => post({ op, ...input });

const mcp = new Server(
  { name: 'estella-editor', version: '0.2.0' },
  { capabilities: { tools: {}, resources: {} } },
);
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools(ALLOW_WRITES) }));
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true };
  return runTool(tool, driver, req.params.arguments, ALLOW_WRITES);
});
mcp.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: RESOURCES.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })),
}));
mcp.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const r = RESOURCES.find((x) => x.uri === req.params.uri);
  if (!r) throw new Error(`unknown resource: ${req.params.uri}`);
  const value = await driver(r.method, []);
  return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: JSON.stringify(value) }] };
});

await mcp.connect(new StdioServerTransport());
log('MCP server connected over stdio');
