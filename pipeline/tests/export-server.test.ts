// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { parseProjectServer, projectServerProblem, serverArgs } from '../src/project/serverConfig';
import { serverDeployFiles, serverSlug } from '../src/export/exportServer';

describe('the project\'s server block', () => {
  it('keeps what is valid and fills the port', () => {
    expect(parseProjectServer({ entry: './server/main.ts', path: '/sector', args: ['--port', '{port}', 3] })).toEqual({
      entry: 'server/main.ts', path: '/sector', port: 8080, args: ['--port', '{port}'],
    });
    expect(parseProjectServer({ entry: 'server/main.ts', path: '/', port: 9000, health: '/healthz' })).toEqual({
      entry: 'server/main.ts', path: '/', port: 9000, args: [], health: '/healthz',
    });
    expect(parseProjectServer({ entry: 'server/main.ts', path: '/', port: 70000, health: 'healthz' })?.port).toBe(8080);
  });

  it('is no server without an entry inside the project and a path, and says which is missing', () => {
    for (const bad of [undefined, null, [], { path: '/a' }, { entry: '../x.ts', path: '/a' }, { entry: '/abs.ts', path: '/a' }, { entry: 'C:/x.ts', path: '/a' }, { entry: 'a.ts', path: 'a' }, { entry: 'a.ts', path: '/a b' }]) {
      expect(parseProjectServer(bad), JSON.stringify(bad)).toBeUndefined();
    }
    expect(projectServerProblem(undefined)).toMatch(/names no server/);
    expect(projectServerProblem({ entry: '../x.ts', path: '/a' })).toMatch(/server\.entry/);
    expect(projectServerProblem({ entry: 'x.ts', path: 'a' })).toMatch(/server\.path/);
  });

  it('survives the manifest parser, so the editor saving the project keeps it', async () => {
    const { parseManifest, ignoredManifestKeys } = await import('../src/project/format');
    const raw = { formatVersion: '1', name: 'g', server: { entry: 'server/main.ts', path: '/play' } };
    expect(parseManifest(raw).server).toEqual({ entry: 'server/main.ts', path: '/play', port: 8080, args: [] });
    expect(ignoredManifestKeys(raw)).toEqual([]);
  });

  it('keeps a server address that is only an address, and refuses anything else', async () => {
    const { serverUrlOf } = await import('../src/project/serverConfig');
    expect(parseProjectServer({ entry: 'a.ts', path: '/s', url: ' wss://Sector.Example.com:8443/s ' })?.url).toBe('wss://sector.example.com:8443/s');
    expect(parseProjectServer({ entry: 'a.ts', path: '/s', url: 'https://x.example/s' })?.url).toBeUndefined();
    for (const bad of ['https://x.example/s', 'wss://u:p@x.example/s', 'wss://x.example/s?a=1', 'wss://x.example/s#a', 'wss://x.example/a b', 'nope', 'wss://x.example/"><script>']) {
      expect(() => serverUrlOf(bad), bad).toThrow(/server url/);
    }
    expect(serverUrlOf('ws://127.0.0.1:8090/sector')).toBe('ws://127.0.0.1:8090/sector');
  });

  it('reaches the web and desktop exports, which have a page to write it in, and no other', async () => {
    const { parseManifest } = await import('../src/project/format');
    const { projectExportOptions } = await import('../src/export/projectExportOptions');
    const parsed = parseManifest({ formatVersion: '1', name: 'g', server: { entry: 'a.ts', path: '/s', url: 'wss://sector.example.com/s' } });
    expect((await projectExportOptions('/tmp/game', parsed, 'web')).serverUrl).toBe('wss://sector.example.com/s');
    expect((await projectExportOptions('/tmp/game', parsed, 'desktop')).serverUrl).toBe('wss://sector.example.com/s');
    expect((await projectExportOptions('/tmp/game', parsed, 'wechat')).serverUrl).toBeUndefined();
    const plain = parseManifest({ formatVersion: '1', name: 'g', server: { entry: 'a.ts', path: '/s' } });
    expect((await projectExportOptions('/tmp/game', plain, 'web')).serverUrl).toBeUndefined();
  });

  it('fills the placeholders where they stand', () => {
    expect(serverArgs({ port: 81, args: ['--port', '{port}', '--at={host}:{port}', '{data}/save.json', '{wasm}'] }, { host: 'h', data: '/d', wasm: '/w' }))
      .toEqual(['--port', '81', '--at=h:81', '/d/save.json', '/w']);
  });
});

describe('the files that deploy a server', () => {
  const server = { entry: 'server/main.ts', path: '/sector', port: 8090, args: ['--port', '{port}', '--host', '{host}', '--data', '{data}/sector.json', '--name', 'two words'], health: '/healthz' };
  const files = serverDeployFiles({ name: 'Space Frigate', server, web: true });

  it('names everything after the game', () => {
    expect(serverSlug('Space Frigate')).toBe('space-frigate');
    expect(serverSlug('2048!')).toBe('game-2048');
    expect(serverSlug('***')).toBe('game-server');
    expect(Object.keys(files).sort()).toEqual(['.dockerignore', 'Dockerfile', 'README.md', 'compose.yaml', 'deploy/Caddyfile', 'deploy/space-frigate.service', 'package.json']);
  });

  it('proxies only the WebSocket upgrade at the server\'s path, and serves the page from web/', () => {
    const caddy = files['deploy/Caddyfile']!;
    expect(caddy).toMatch(/path \/sector\n\t\theader Upgrade websocket/);
    expect(caddy).toContain('reverse_proxy @server {$UPSTREAM:127.0.0.1:8090}');
    expect(caddy).toContain('root * {$WEB_ROOT:/srv/space-frigate/web}');
    expect(files['compose.yaml']).toContain('UPSTREAM: server:8090');
  });

  it('starts the server on the machine and in the box with their own host and data folder', () => {
    expect(files['deploy/space-frigate.service']).toContain('ExecStart=/usr/bin/env node /srv/space-frigate/server.mjs --port 8090 --host 127.0.0.1 --data /var/lib/space-frigate/sector.json --name "two words"');
    expect(files['deploy/space-frigate.service']).toContain('StateDirectory=space-frigate');
    expect(files.Dockerfile).toContain('CMD ["node","server.mjs","--port","8090","--host","0.0.0.0","--data","/data/sector.json","--name","two words"]');
    expect(files.Dockerfile).toContain("fetch('http://127.0.0.1:8090/healthz')");
    expect(files.Dockerfile).not.toContain('COPY wasm');
  });

  it('answers at its own address when the page is elsewhere', () => {
    const away = serverDeployFiles({ name: 'Space Frigate', server: { ...server, url: 'wss://sector.example.com/sector' }, web: true });
    expect(away['deploy/Caddyfile']).toContain('{$SITE_ADDRESS:sector.example.com} {');
    expect(away['compose.yaml']).toContain('SITE_ADDRESS: ${SITE_ADDRESS:-sector.example.com}');
    expect(away['README.md']).toContain('GitHub Pages');
    expect(files['deploy/Caddyfile']).toContain('{$SITE_ADDRESS:localhost} {');
  });

  it('carries the engine into the box only for a server that runs it', () => {
    const engine = serverDeployFiles({ name: 'g', server: { ...server, args: ['--wasm', '{wasm}'] }, web: false, engine: true });
    expect(engine.Dockerfile).toContain('COPY wasm ./wasm');
    expect(engine.Dockerfile).toContain('CMD ["node","server.mjs","--wasm","/app/wasm"]');
    expect(engine['deploy/g.service']).toContain('server.mjs --wasm /srv/g/wasm');
  });
});
