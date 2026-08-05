// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  mcpEndpoint.ts — the live editor's MCP exec endpoint.
 *
 * Starts the shared loopback /exec seam against the REAL editor window, so the
 * MCP front (scripts/editor-mcp.mjs --editor / --attach) can drive the full app.
 * The calls themselves land through createSurfaceDriver (surfaceDriver.ts), which
 * every consumer shares; this file owns only the transport around it — token,
 * discovery file, and the ready line.
 *
 * The token comes from the spawning front (ESTELLA_MCP_TOKEN) or is generated for
 * a user-launched editor; either way the endpoint is advertised in a discovery
 * file under userData (mcp-endpoint.json) that `--attach` reads, and a
 * `MCP_HOST_READY {"port":N}` line on stdout for the spawn flow.
 *
 * TWO ways in, and the difference is who may close it:
 *
 *   FORCED   `--mcp` / ESTELLA_MCP=1 — the spawn flow (`editor-mcp.mjs --editor`)
 *            launches the editor this way and then talks to the port it reads off
 *            stdout. That conversation is the reason this process exists, so a
 *            forced endpoint stays up for the session; {@link stopMcpEndpoint} is
 *            a no-op against it rather than a way to hang up on your own caller.
 *   OPT-IN   the editor setting (agents.mcpEnabled), for the ordinary case: an
 *            editor started by double-clicking it. `--attach` needs a discovery
 *            file, and a user who never passes command-line flags had no way to
 *            produce one — the endpoint existed but only for people who launched
 *            the app from a terminal.
 *
 * Start/stop are therefore idempotent and re-entrant: a setting toggled twice, or
 * toggled in an editor already forced open, must not double-listen or double-write
 * the discovery file.
 */
import { app, BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
// Plain .mjs, shared with the headless host (scripts/editor-mcp-host.mjs) —
// esbuild bundles it into the main bundle.
// @ts-expect-error untyped shared module
import { createExecEndpoint } from '../shared/execEndpoint.mjs';
import { createSurfaceDriver } from './surfaceDriver';

const log = (...a: unknown[]) => process.stderr.write(`[editor-mcp-endpoint] ${a.join(' ')}\n`);

/** What the endpoint is doing right now — the whole of what the UI renders. */
export interface McpEndpointStatus {
  running: boolean;
  /** Loopback port, once listening. */
  port: number | null;
  /** The discovery file `--attach` reads, once advertised. */
  discoveryFile: string | null;
  /** Opened by `--mcp`/ESTELLA_MCP: on for the session, not the setting's to close. */
  forced: boolean;
  /** Why the last start failed, if it did (cleared by a start that works). */
  error: string | null;
}

/** True when this editor process was LAUNCHED to expose the endpoint. */
export function mcpMode(): boolean {
  return process.argv.includes('--mcp') || process.env.ESTELLA_MCP === '1';
}

// One token per process, not per start: the spawning front passes it in the
// environment and holds it for the session, so regenerating it on a restart
// would lock out the very client that launched us.
const TOKEN = process.env.ESTELLA_MCP_TOKEN || randomBytes(24).toString('hex');

let server: Server | null = null;
let starting: Promise<McpEndpointStatus> | null = null;
let port: number | null = null;
let discoveryFile: string | null = null;
let lastError: string | null = null;
let cleanupHooked = false;

/** The discovery file's path — same for every start, so a stale one is overwritten. */
function discoveryPath(): string {
  return path.join(app.getPath('userData'), 'mcp-endpoint.json');
}

export function mcpEndpointStatus(): McpEndpointStatus {
  return { running: server !== null, port, discoveryFile, forced: mcpMode(), error: lastError };
}

/**
 * Start the endpoint against the editor window and advertise it. `getWin`
 * re-resolves per call so a recreated window keeps working.
 *
 * Idempotent: already listening (or mid-start) hands back the same endpoint
 * rather than a second listener. Never throws — a failure to bind is reported
 * through {@link McpEndpointStatus.error}, because the caller is a settings
 * toggle and an unhandled rejection there would take the toggle with it.
 */
export async function startMcpEndpoint(
  getWin: () => BrowserWindow | null,
): Promise<McpEndpointStatus> {
  if (server) return mcpEndpointStatus();
  if (starting) return starting;

  starting = (async (): Promise<McpEndpointStatus> => {
    const driver = createSurfaceDriver(getWin);
    try {
      server = await createExecEndpoint({
        token: TOKEN,
        // An op's payload is forwarded WHOLE. Naming its fields here (it used to
        // pass `{ code, frame }`, the two play_probe wanted) means every field a
        // later op adds is dropped in transit — the tool validates it, the
        // catalog documents it, and the op sees undefined. That is the same
        // silent-argument-loss that made `offset` on read_project_file a lie.
        run: async (payload: {
          method?: string; args?: unknown[]; root?: string; js?: string; op?: string;
        } & Record<string, unknown>) => {
          const { method, args, root, js, op, ...rest } = payload;
          if (op) return driver.op(op, rest);
          if (js) return driver.js(js);
          return driver(method as string, args ?? [], root);
        },
      });
      port = (server!.address() as { port: number }).port;
      lastError = null;
    } catch (e) {
      server = null;
      port = null;
      lastError = String((e as Error)?.message ?? e);
      log('could not start the exec endpoint:', lastError);
      return mcpEndpointStatus();
    }

    // Advertise for --attach; the token in the file is what authorizes a local
    // client, so the file lives in userData (per-user, not world-readable temp).
    const file = discoveryPath();
    try {
      writeFileSync(file, JSON.stringify({ port, token: TOKEN, pid: process.pid }) + '\n');
      discoveryFile = file;
      // Once per process: a toggled setting can start/stop many times, and one
      // will-quit listener per start would leak them onto the app.
      if (!cleanupHooked) {
        cleanupHooked = true;
        app.on('will-quit', removeDiscoveryFile);
      }
    } catch (e) {
      // A live endpoint nobody can discover still serves --editor (which reads the
      // port off stdout), so this degrades rather than fails.
      log('could not write discovery file:', String(e));
      discoveryFile = null;
    }

    // The spawn flow (editor-mcp.mjs --editor) reads this exact line.
    process.stdout.write(`MCP_HOST_READY ${JSON.stringify({ port })}\n`);
    log(`exec endpoint on 127.0.0.1:${port} (discovery: ${discoveryFile ?? 'unavailable'})`);
    return mcpEndpointStatus();
  })().finally(() => { starting = null; });

  return starting;
}

function removeDiscoveryFile(): void {
  try {
    rmSync(discoveryPath());
  } catch { /* already gone */ }
  discoveryFile = null;
}

/**
 * Close the endpoint and retract its discovery file, so `--attach` stops finding
 * a port nobody is listening on. A FORCED endpoint is left alone — see the file
 * header: the process was launched to serve it.
 */
export function stopMcpEndpoint(): McpEndpointStatus {
  if (mcpMode() || !server) return mcpEndpointStatus();
  server.close();
  server = null;
  port = null;
  removeDiscoveryFile();
  log('exec endpoint closed');
  return mcpEndpointStatus();
}
