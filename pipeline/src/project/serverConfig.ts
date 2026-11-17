// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  serverConfig.ts — what a project says about its game server.
 *
 * A game with a server names it in `project.esproject`:
 *
 *   "server": {
 *     "entry": "server/main.ts",
 *     "path": "/sector",
 *     "port": 8090,
 *     "args": ["--port", "{port}", "--host", "{host}", "--data", "{data}/sector.json"],
 *     "health": "/healthz"
 *   }
 *
 * `estella export --platform server` bundles the entry into one file Node runs, and writes the files that
 * run it on a machine of its own: the page and the server behind one address, the server reached at
 * `path`. `args` is how the deployed server is started; `{port}`, `{host}`, `{data}` and `{wasm}` are filled in
 * by whatever starts it (the listening port, the address it listens on, the folder its saves go in, and the
 * engine build, for a server that runs the engine).
 * Node-free, like the rest of the format: the editor's renderer reads it.
 */

export interface ProjectServer {
  /** The server's source entry, project-relative. */
  entry: string;
  /** The WebSocket path the server answers on; the client dials the page's host at this path. */
  path: string;
  /** The port the server listens on behind the proxy. Default 8080. */
  port: number;
  /** Arguments the deployed server is started with, `{port}`, `{host}`, `{data}` and `{wasm}` filled in. */
  args: string[];
  /** An HTTP path that answers 200 while the server is well, for a container's health check. */
  health?: string;
}

export const SERVER_DEFAULT_PORT = 8080;
const URL_PATH = /^\/[A-Za-z0-9._~\-/]*$/;

const relative = (p: string): string | null => {
  const rel = p.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return rel !== '' && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel) && !rel.split('/').includes('..') ? rel : null;
};

/** The block as written, keeping what is valid; a block with no usable entry or path is not a server. */
export function parseProjectServer(raw: unknown): ProjectServer | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const entry = typeof o.entry === 'string' ? relative(o.entry) : null;
  const path = typeof o.path === 'string' && URL_PATH.test(o.path) ? o.path : null;
  if (!entry || !path) return undefined;
  const port = typeof o.port === 'number' && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 ? o.port : SERVER_DEFAULT_PORT;
  const args = Array.isArray(o.args) ? o.args.filter((a): a is string => typeof a === 'string') : [];
  const out: ProjectServer = { entry, path, port, args };
  if (typeof o.health === 'string' && URL_PATH.test(o.health)) out.health = o.health;
  return out;
}

/** What the project file must say for there to be a server to export, when {@link parseProjectServer} found none. */
export function projectServerProblem(raw: unknown): string {
  if (raw === undefined) return 'the project names no server: add a "server" block to project.esproject with its "entry" (such as "server/main.ts") and the WebSocket "path" it answers on (such as "/play")';
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof o.entry !== 'string' || !relative(o.entry)) return 'server.entry must be the server\'s source file, relative to the project and inside it';
  return 'server.path must be a URL path starting with "/", such as "/play"';
}

/** `args` with the placeholders filled in. */
export function serverArgs(server: Pick<ProjectServer, 'args' | 'port'>, at: { host: string; data: string; wasm: string }): string[] {
  return server.args.map((a) => a.replace(/\{port\}/g, String(server.port)).replace(/\{host\}/g, at.host).replace(/\{data\}/g, at.data).replace(/\{wasm\}/g, at.wasm));
}
