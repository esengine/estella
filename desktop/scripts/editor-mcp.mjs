// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp.mjs — the editor MCP server (stdio front, plain node).
 *
 * An MCP client (an AI agent) spawns this with node; it spawns the Electron half
 * (editor-mcp-host.mjs — the proven headless render host publishing
 * EditorControlSurface) and serves the MCP tool registry (editor-mcp-tools.mjs)
 * over stdio, forwarding each call to the host's loopback /exec endpoint.
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
const ALLOW_WRITES = process.env.ESTELLA_MCP_ALLOW_WRITES === '1';
const log = (...a) => process.stderr.write(`[editor-mcp] ${a.join(' ')}\n`);

// Under plain node the electron package's export IS the binary path — works on
// every platform (the .bin/ shim is a sh script Windows cannot spawn).
const electron = createRequire(import.meta.url)('electron');
const token = randomBytes(24).toString('hex');

const host = spawn(electron, [path.join(HERE, 'editor-mcp-host.mjs')], {
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
process.stdin.on('close', () => { killHost(); process.exit(0); });

// Wait for the host's readiness line to learn the /exec port.
const port = await new Promise((resolve, reject) => {
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
}).catch((e) => {
  log('FATAL', e.message);
  killHost();
  process.exit(1);
});
log(`host ready on 127.0.0.1:${port} (writes ${ALLOW_WRITES ? 'ENABLED' : 'disabled'})`);

async function post(body) {
  const res = await fetch(`http://127.0.0.1:${port}/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-estella-mcp-token': token },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error);
  return out.hasResult ? out.result : undefined;
}

// The registry's driver: surface method calls + renderer-code snippets.
const driver = (method, args) => post({ method, args });
driver.js = (js) => post({ js });

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
