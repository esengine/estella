// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The MCP exec endpoint's lifecycle. It has two ways in that must not fight:
//
//   FORCED (`--mcp` / ESTELLA_MCP=1) — the spawn flow launched this editor to
//     serve one client and is talking to the port it read off stdout. Stopping
//     that endpoint would hang up on the caller, so the setting cannot.
//   OPT-IN (the editor setting) — the ordinary double-clicked editor, which
//     otherwise advertises nothing and so can never be `--attach`ed to.
//
// Both go through the same start/stop, which therefore has to be idempotent: a
// setting is toggled by a human, twice, faster than a port binds.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let userData: string;
const closed = vi.fn();
const created = vi.fn();
let bindError: Error | null = null;
let nextPort = 51234;

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    on: () => {},
  },
}));

// The loopback seam itself is covered by its own host tests; here it stands in as
// "a listener that bound (or didn't)", which is all this file's logic turns on.
vi.mock('../scripts/mcp-exec-endpoint.mjs', () => ({
  createExecEndpoint: async (opts: { token: string }) => {
    created(opts.token);
    if (bindError) throw bindError;
    return { address: () => ({ port: nextPort }), close: closed };
  },
}));

vi.mock('../electron/surfaceDriver', () => ({
  createSurfaceDriver: () => Object.assign(() => undefined, { op: () => undefined, js: () => undefined }),
}));

async function load() {
  vi.resetModules();
  return import('../electron/mcpEndpoint');
}

const win = () => null;
const discovery = () => path.join(userData, 'mcp-endpoint.json');

beforeEach(() => {
  userData = mkdtempSync(path.join(tmpdir(), 'estella-mcp-userdata-'));
  closed.mockReset();
  created.mockReset();
  bindError = null;
  nextPort = 51234;
  process.env.ESTELLA_MCP_TOKEN = 'test-token';
  delete process.env.ESTELLA_MCP;
  process.argv = process.argv.filter((a) => a !== '--mcp');
});

afterEach(() => {
  delete process.env.ESTELLA_MCP_TOKEN;
  delete process.env.ESTELLA_MCP;
  rmSync(userData, { recursive: true, force: true });
});

describe('the MCP endpoint lifecycle', () => {
  it('is closed until something asks for it', async () => {
    const { mcpEndpointStatus } = await load();
    expect(mcpEndpointStatus()).toMatchObject({ running: false, port: null, discoveryFile: null });
    expect(existsSync(discovery())).toBe(false);
  });

  it('starting advertises the port + token in the discovery file --attach reads', async () => {
    const { startMcpEndpoint } = await load();
    const status = await startMcpEndpoint(win);

    expect(status).toMatchObject({ running: true, port: 51234, error: null });
    expect(status.discoveryFile).toBe(discovery());
    expect(JSON.parse(readFileSync(discovery(), 'utf8'))).toMatchObject({ port: 51234, token: 'test-token' });
  });

  it('starting twice keeps ONE listener — a toggle is clicked, not transacted', async () => {
    const { startMcpEndpoint } = await load();
    const [a, b] = await Promise.all([startMcpEndpoint(win), startMcpEndpoint(win)]);
    const c = await startMcpEndpoint(win);

    expect(created).toHaveBeenCalledTimes(1);
    expect([a.port, b.port, c.port]).toEqual([51234, 51234, 51234]);
  });

  it('stopping closes the listener AND retracts the discovery file', async () => {
    const { startMcpEndpoint, stopMcpEndpoint, mcpEndpointStatus } = await load();
    await startMcpEndpoint(win);
    expect(existsSync(discovery())).toBe(true);

    const status = stopMcpEndpoint();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({ running: false, port: null, discoveryFile: null });
    // Left behind, --attach would keep finding a port nobody is listening on and
    // every call would fail at the connection instead of saying "no editor".
    expect(existsSync(discovery())).toBe(false);
    expect(mcpEndpointStatus().running).toBe(false);
  });

  it('reopens after a stop', async () => {
    const { startMcpEndpoint, stopMcpEndpoint } = await load();
    await startMcpEndpoint(win);
    stopMcpEndpoint();
    nextPort = 51999;

    expect(await startMcpEndpoint(win)).toMatchObject({ running: true, port: 51999 });
    expect(JSON.parse(readFileSync(discovery(), 'utf8'))).toMatchObject({ port: 51999, token: 'test-token' });
  });

  it('reports a refused bind instead of throwing — the caller is a settings toggle', async () => {
    const { startMcpEndpoint } = await load();
    bindError = new Error('EADDRINUSE');

    const status = await startMcpEndpoint(win);

    expect(status).toMatchObject({ running: false, port: null });
    expect(status.error).toMatch(/EADDRINUSE/);
    // A failed start must not leave a discovery file pointing at nothing.
    expect(existsSync(discovery())).toBe(false);
  });

  it('clears a previous error once a start works', async () => {
    const { startMcpEndpoint } = await load();
    bindError = new Error('EADDRINUSE');
    await startMcpEndpoint(win);
    bindError = null;

    expect(await startMcpEndpoint(win)).toMatchObject({ running: true, error: null });
  });

  describe('when the editor was LAUNCHED to serve it (--mcp)', () => {
    beforeEach(() => { process.env.ESTELLA_MCP = '1'; });

    it('reports itself forced, so the UI can say who opened it', async () => {
      const { startMcpEndpoint } = await load();
      expect(await startMcpEndpoint(win)).toMatchObject({ running: true, forced: true });
    });

    it('refuses to stop — the spawning client is mid-conversation with this port', async () => {
      const { startMcpEndpoint, stopMcpEndpoint } = await load();
      await startMcpEndpoint(win);

      const status = stopMcpEndpoint();

      expect(closed).not.toHaveBeenCalled();
      expect(status).toMatchObject({ running: true, port: 51234, forced: true });
      expect(existsSync(discovery())).toBe(true);
    });
  });
});
