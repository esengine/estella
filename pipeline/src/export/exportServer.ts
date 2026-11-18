// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  exportServer.ts — `estella export --platform server`: a game's server, ready to run on a machine of its own.
 *
 * The server entry the project names (`server` in project.esproject, see serverConfig.ts) is bundled into one ESM
 * file Node 20 runs with nothing installed beside it: `esengine` is the SDK's headless build (`index.node.js`, the one
 * `esengine/node` names too, so a server has one copy of the engine whichever it imports), its subpaths are the SDK
 * build's, and the server's own packages (`ws`) come from the node_modules beside the entry or the project. A server
 * that runs the engine (a dedicated server for replicated play) needs its wasm: then `wasm/` goes beside it, and
 * `{wasm}` in `server.args` says where. Next to it go the files
 * that put it on the internet, one address for the page and the server so the client finds it by
 * `serverAddress({ path })` with no address in its build:
 *
 *   server.mjs, package.json      the server
 *   wasm/                         the engine, when the server runs it
 *   web/                          the game's web export (written by the CLI, unless --no-web)
 *   Dockerfile, compose.yaml      the server in a container, and Caddy in front of it with a certificate of its own
 *   deploy/Caddyfile              the proxy: the page from web/, `server.path` to the server
 *   deploy/<name>.service         or the server under systemd, with the same Caddyfile on the machine
 *   README.md                     how to start either, written for this game
 *
 * Nothing here starts, uploads or signs anything: what to run, and where, stays the person's.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Esbuild } from '../bundle/esbuildRuntime';
import { esengineAlias } from '../bundle/esengineResolve';
import { serverArgs, type ProjectServer } from '../project/serverConfig';

export interface ServerExportOptions {
  projectDir: string;
  /** The project's name, as the manifest gives it. */
  name: string;
  server: ProjectServer;
  outDir: string;
  /** `sdk/dist`: where `esengine` and its subpaths resolve. */
  sdkDistDir: string;
  /** The engine's web runtime (esengine.js + esengine.wasm), shipped when the server imports the engine itself. */
  wasmDir?: string;
  /** Further folders whose node_modules the server's packages may come from (the engine's own). */
  nodePaths?: string[];
  minify?: boolean;
  /** Whether the CLI writes the web export into `web/`; only the README's wording depends on it. */
  web: boolean;
}

export interface ServerExportResult {
  outDir: string;
  bundle: string;
  bytes: number;
  /** Whether the server runs the engine, and so carries `wasm/`. */
  engine: boolean;
  files: string[];
  warnings: string[];
}

/** A name a service, a folder and a container can all carry. */
export function serverSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `game-${slug || 'server'}`;
}

/** One argument as systemd's ExecStart reads it. */
const systemdArg = (a: string): string => (/^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : `"${a.replace(/(["\\])/g, '\\$1')}"`);

/** The deployment files, by path relative to the output folder. Pure, so a test reads exactly what is written. */
export function serverDeployFiles(info: { name: string; server: ProjectServer; web: boolean; engine?: boolean }): Record<string, string> {
  const { name, server } = info;
  const engine = info.engine === true;
  // A server with an address of its own answers there; its page may be served from anywhere else.
  const site = server.url ? new URL(server.url.replace(/^ws/, 'http')).host : 'localhost';
  const slug = serverSlug(name);
  const port = server.port;
  const home = `/srv/${slug}`;
  const hostArgs = serverArgs(server, { host: '127.0.0.1', data: `/var/lib/${slug}`, wasm: `${home}/wasm` });
  const boxArgs = serverArgs(server, { host: '0.0.0.0', data: '/data', wasm: '/app/wasm' });
  const health = server.health
    ? `HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:${port}${server.health}').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]\n`
    : '';

  const caddyfile = `# ${name}: the game's page and its server at one address.
# SITE_ADDRESS is the domain players open (Caddy gets its certificate itself); UPSTREAM is where the
# server listens; WEB_ROOT is the web export. Each has the value for a server run under systemd.
{$SITE_ADDRESS:${site}} {
\tencode zstd gzip
\t# Only the WebSocket upgrade goes to the server, so a server at / still leaves the page to file_server.
\t@server {
\t\tpath ${server.path}
\t\theader Upgrade websocket
\t}
\treverse_proxy @server {$UPSTREAM:127.0.0.1:${port}}
\troot * {$WEB_ROOT:${home}/web}
\tfile_server
}
`;

  const service = `[Unit]
Description=${name} game server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=${slug}
WorkingDirectory=${home}
ExecStart=/usr/bin/env node ${home}/server.mjs${hostArgs.map((a) => ` ${systemdArg(a)}`).join('')}
Restart=on-failure
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
`;

  const dockerfile = `FROM node:22-slim
WORKDIR /app
COPY package.json server.mjs server.mjs.map ./
${engine ? 'COPY wasm ./wasm\n' : ''}RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
ENV NODE_ENV=production
EXPOSE ${port}
${health}CMD ${JSON.stringify(['node', 'server.mjs', ...boxArgs])}
`;

  const compose = `# docker compose up -d --build   (SITE_ADDRESS=play.example.com for a real domain)
services:
  server:
    build: .
    restart: unless-stopped
    volumes:
      - data:/data
  web:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    environment:
      SITE_ADDRESS: \${SITE_ADDRESS:-${site}}
      UPSTREAM: server:${port}
      WEB_ROOT: /srv/web
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./web:/srv/web:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - server
volumes:
  data:
  caddy_data:
  caddy_config:
`;

  const readme = `# ${name}: server

\`server.mjs\` is the game's server (\`${server.entry}\`) in one file: Node 20 or later runs it with nothing installed.
${info.web ? '`web/` is the game\'s web export.' : '`web/` is where the game\'s web export goes: `estella export <project> --platform web --out web`.'}
${server.url
    ? `The page dials \`${server.url}\` (the project's \`server.url\`, written into it), so \`web/\` can be served from anywhere,
GitHub Pages included; this machine answers at ${site}. It also serves \`web/\` itself, for players who come here.`
    : `Players open one address; the page is served from \`web/\` and the game dials \`${server.path}\` on the same host
(\`serverAddress({ path: '${server.path}' })\` in \`esengine/session\`), over \`wss:\` because the page is \`https:\`.`}

## With Docker

On a machine with Docker and a domain pointing at it, ports 80 and 443 open:

    SITE_ADDRESS=play.example.com docker compose up -d --build

Caddy fetches the certificate. The server's files are kept in the \`data\` volume, mounted at \`/data\`.
Without \`SITE_ADDRESS\` it answers on https://localhost.

## Without Docker

Copy this folder to \`${home}\`, then:

    sudo cp deploy/${slug}.service /etc/systemd/system/
    sudo systemctl enable --now ${slug}

and serve it with Caddy: \`deploy/Caddyfile\`, with \`SITE_ADDRESS=play.example.com\` in Caddy's environment.
The server keeps its files in \`/var/lib/${slug}\`.

## The server is started as

    node server.mjs ${boxArgs.join(' ')}

(with \`/data\` replaced by \`/var/lib/${slug}\` and \`0.0.0.0\` by \`127.0.0.1\` under systemd). These are \`server.args\`
in project.esproject. If the server needs something once, before its first start (a world to be made, a list of
players), do that in the data folder first: \`docker compose run --rm server node server.mjs ...\`, or by hand under systemd.

## Who can play

Who may sign in is the server's to decide. For a test with people you know, \`TokenBook\` in \`esengine/session\` reads a
list of players and their tokens from a file in the data folder; make each token with \`newToken()\`
(or \`node -e "console.log(crypto.randomBytes(24).toString('base64url'))"\`) and give each player their own.
Never use a token that is in the game's repository.
`;

  return {
    'deploy/Caddyfile': caddyfile,
    [`deploy/${slug}.service`]: service,
    Dockerfile: dockerfile,
    '.dockerignore': 'web\ndeploy\nREADME.md\ncompose.yaml\n',
    'compose.yaml': compose,
    'README.md': readme,
    'package.json': `${JSON.stringify({ name: `${slug}-server`, private: true, type: 'module', engines: { node: '>=20' }, scripts: { start: 'node server.mjs' } }, null, 2)}\n`,
  };
}

export async function exportServer(opts: ServerExportOptions, esbuild: Esbuild): Promise<ServerExportResult> {
  const entry = path.join(opts.projectDir, ...opts.server.entry.split('/'));
  if (!existsSync(entry)) throw new Error(`server.entry: ${opts.server.entry} is not in ${opts.projectDir}`);
  const session = path.join(opts.sdkDistDir, 'net', 'session', 'index.js');
  if (!existsSync(session)) throw new Error(`the SDK is not built (${session} is missing): build it first (pnpm --dir sdk run build)`);

  // The folder is the server's: what an earlier export left (a stale bundle, a removed file) does not ride along.
  for (const name of ['server.mjs', 'server.mjs.map', 'deploy']) rmSync(path.join(opts.outDir, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  mkdirSync(path.join(opts.outDir, 'deploy'), { recursive: true });

  const bundle = path.join(opts.outDir, 'server.mjs');
  const nodePaths = [path.join(path.dirname(entry), 'node_modules'), path.join(opts.projectDir, 'node_modules'), ...(opts.nodePaths ?? [])]
    .filter((p, i, all) => existsSync(p) && all.indexOf(p) === i);
  const nodeSdk = path.join(opts.sdkDistDir, 'index.node.js');
  if (!existsSync(nodeSdk)) throw new Error(`the SDK has no headless build (${nodeSdk} is missing): build it first (pnpm --dir sdk run build)`);
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    minify: opts.minify === true,
    logLevel: 'silent',
    metafile: true,
    alias: { ...esengineAlias(opts.sdkDistDir, 'index.node.js'), 'esengine/node': nodeSdk },
    nodePaths,
    // Packages written as CommonJS (`ws`) call require(); an ESM file has none of its own.
    banner: { js: "import { createRequire as __estellaRequire } from 'node:module';\nconst require = __estellaRequire(import.meta.url);" },
  });
  const warnings = result.warnings.map((w) => `${w.location ? `${w.location.file}:${w.location.line}: ` : ''}${w.text}`);

  const files = ['server.mjs', 'server.mjs.map'];
  // The engine runs in the server when its headless build is in the bundle; a server of sessions alone carries no wasm.
  const engine = Object.keys(result.metafile?.inputs ?? {}).some((input) => path.resolve(input) === path.resolve(nodeSdk));
  rmSync(path.join(opts.outDir, 'wasm'), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  if (engine) {
    if (!opts.wasmDir || !existsSync(path.join(opts.wasmDir, 'esengine.wasm'))) {
      throw new Error(`the server runs the engine, and there is no engine build at ${opts.wasmDir ?? '(none given)'}: build it, or pass --wasm <dir>`);
    }
    cpSync(opts.wasmDir, path.join(opts.outDir, 'wasm'), { recursive: true });
    files.push('wasm/');
    if (!opts.server.args.some((a) => a.includes('{wasm}'))) warnings.push('the server runs the engine but server.args has no {wasm}: the engine is shipped in wasm/ beside server.mjs, and the server has to find it there itself');
  }
  for (const [rel, text] of Object.entries(serverDeployFiles({ name: opts.name, server: opts.server, web: opts.web, engine }))) {
    const file = path.join(opts.outDir, ...rel.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    files.push(rel);
  }
  return { outDir: opts.outDir, bundle, bytes: statSync(bundle).size, engine, files, warnings };
}
