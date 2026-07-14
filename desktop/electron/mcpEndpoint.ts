// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  mcpEndpoint.ts — the live editor's MCP exec endpoint (`--mcp` mode).
 *
 * Starts the shared loopback /exec seam against the REAL editor window, so the
 * MCP front (scripts/editor-mcp.mjs --editor / --attach) can drive the full app:
 * scene calls resolve on `window.__estellaEditor.surface` (the same
 * EditorControlSurface the UI uses), editor-level calls (project open, scenes,
 * play, entity templates) on `window.__estellaEditor`, renderer-code snippets run
 * verbatim, and `op: screenshot` captures the composited window main-side — the
 * only way to see into the play realm's OOPIF.
 *
 * The token comes from the spawning front (ESTELLA_MCP_TOKEN) or is generated for
 * a user-launched editor; either way the endpoint is advertised in a discovery
 * file under userData (mcp-endpoint.json) that `--attach` reads, and a
 * `MCP_HOST_READY {"port":N}` line on stdout for the spawn flow.
 */
import { app, BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
// Plain .mjs, shared with the headless host (scripts/editor-mcp-host.mjs) —
// esbuild bundles it into the main bundle.
// @ts-expect-error untyped shared module
import { createExecEndpoint } from '../scripts/mcp-exec-endpoint.mjs';

const log = (...a: unknown[]) => process.stderr.write(`[editor-mcp-endpoint] ${a.join(' ')}\n`);

/** True when this editor process should expose the MCP exec endpoint. */
export function mcpMode(): boolean {
  return process.argv.includes('--mcp') || process.env.ESTELLA_MCP === '1';
}

/**
 * Start the endpoint against the editor window. `getWin` re-resolves per call so
 * a recreated window keeps working. Idempotent-ish: call once after the first
 * window exists.
 */
export async function startMcpEndpoint(getWin: () => BrowserWindow | null): Promise<void> {
  const token = process.env.ESTELLA_MCP_TOKEN || randomBytes(24).toString('hex');

  const exec = async (code: string) => {
    const win = getWin();
    if (!win) throw new Error('no editor window');
    // A call can arrive before the renderer finished booting (the endpoint comes
    // up with the window) — wait out the initial load instead of failing it.
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    }
    return win.webContents.executeJavaScript(code, true);
  };

  const server = await createExecEndpoint({
    token,
    run: async ({ method, args, root, js, op }: {
      method?: string; args?: unknown[]; root?: string; js?: string; op?: string;
    }) => {
      if (op === 'screenshot') {
        const win = getWin();
        if (!win) throw new Error('no editor window');
        const image = await win.webContents.capturePage();
        return image.toPNG().toString('base64');
      }
      if (js) return exec(js);
      const target = root === 'editor' ? 'window.__estellaEditor' : 'window.__estellaEditor.surface';
      return exec(`${target}.${method}(${(args ?? [])
        .map((a) => (a === undefined ? 'undefined' : JSON.stringify(a)))
        .join(',')})`);
    },
  });

  const port = (server.address() as { port: number }).port;

  // Advertise for --attach; the token in the file is what authorizes a local
  // client, so the file lives in userData (per-user, not world-readable temp).
  const discovery = path.join(app.getPath('userData'), 'mcp-endpoint.json');
  try {
    writeFileSync(discovery, JSON.stringify({ port, token, pid: process.pid }) + '\n');
    app.on('will-quit', () => { try { rmSync(discovery); } catch { /* already gone */ } });
  } catch (e) {
    log('could not write discovery file:', String(e));
  }

  // The spawn flow (editor-mcp.mjs --editor) reads this exact line.
  process.stdout.write(`MCP_HOST_READY ${JSON.stringify({ port })}\n`);
  log(`exec endpoint on 127.0.0.1:${port} (discovery: ${discovery})`);
}
