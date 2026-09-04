// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-arena-server.mjs — a multiplayer game runs without the editor.
 *
 * `check-headless-export` proves a project PACKAGES from the command line. This
 * proves the other half of shipping a multiplayer one: that the authority runs
 * as an ordinary Node process, over a real socket, driving the project's own
 * gameplay code — and that the parts the editor's preview structurally cannot
 * reach still work.
 *
 * The preview wires its players over MessagePorts inside one process. Those
 * never drop, so nothing there ever exercised a connection LEAVING; and the
 * host is always a player, so nothing exercised an authority with no pawn of
 * its own. Both are ordinary facts of a dedicated server, and both are checked
 * here against `examples/multiplayer-arena`:
 *
 *   1. the server boots headless (no renderer, no editor) and accepts sockets
 *   2. no phantom host pawn — a keyboard-less authority owns nothing
 *   3. a client's input moves ITS pawn, and the arena wall clamps it
 *   4. that movement reaches a THIRD party as replicated state
 *   5. a client that leaves takes its pawn with it
 *
 *   node tools/check-arena-server.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'examples', 'multiplayer-arena');
const SDK = path.join(ROOT, 'sdk', 'dist', 'index.node.js');
const WASM = path.join(ROOT, 'build', 'wasm', 'web');

/** Arena bounds, from the example's own movement rule. */
const BOUND_X = 420;
const STEP = 1 / 60;

const work = mkdtempSync(path.join(tmpdir(), 'estella-arena-'));
let server = null;

function fail(message, detail) {
  console.error(`check-arena-server: ${message}`);
  if (detail) console.error(detail);
  cleanup();
  process.exit(1);
}

function cleanup() {
  if (server && server.exitCode === null) server.kill();
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** tsc and esbuild both want a path, not a file:// URL, with forward slashes. */
const posix = (p) => p.split(path.sep).join('/');

// ---------------------------------------------------------------------------
// Build both ends from the project's own sources.
// ---------------------------------------------------------------------------

/**
 * Type-check the server entry first: esbuild only strips types, so drift from
 * the SDK would surface as a runtime throw. The project's own tsconfig covers
 * `src/` alone — a game project has no `ws` or `@types/node` — so the check
 * runs from here, against the SDK install that does.
 */
const TSC = path.join(ROOT, 'sdk', 'node_modules', 'typescript', 'bin', 'tsc');
const SDK_TYPES = path.join(ROOT, 'sdk', 'node_modules', '@types');
const tsconfig = path.join(work, 'tsconfig.json');
writeFileSync(tsconfig, JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
    strict: true, skipLibCheck: true, noEmit: true, esModuleInterop: true,
    types: ['node'], typeRoots: [posix(SDK_TYPES)],
    baseUrl: '.',
    paths: {
      esengine: [posix(path.join(ROOT, 'sdk', 'dist', 'index.d.ts'))],
      'esengine/node': [posix(path.join(ROOT, 'sdk', 'dist', 'index.node.d.ts'))],
      ws: [posix(path.join(SDK_TYPES, 'ws', 'index.d.ts'))],
    },
  },
  include: [posix(path.join(PROJECT, 'server', '**', '*.ts')), posix(path.join(PROJECT, 'src', '**', '*.ts'))],
}, null, 2));

const typed = spawnSync(process.execPath, [TSC, '-p', tsconfig], { encoding: 'utf8', cwd: ROOT });
if (typed.status !== 0) {
  fail('the server entry does not type-check against the SDK.', typed.stdout || typed.stderr);
}

const built = spawnSync(process.execPath, [
  path.join(PROJECT, 'server', 'run.mjs'), '--build-only',
], { encoding: 'utf8', cwd: ROOT });
if (built.status !== 0) fail('the server bundle failed to build.', built.stderr || built.stdout);

/**
 * The client half, built from the project's REAL entry point: it registers the
 * same components (the handshake compares schemas and would reject a faked
 * probe) and runs the same input/prediction system a browser would. The second
 * client registers nothing, which is what makes it a fair witness.
 */
const probeSource = `
// 'esengine' rather than a path: the alias below points it at the same headless
// SDK the server bundle uses, so probe and project share one module instance.
export { loadEsengineModule, createHeadlessApp, flushPendingRegistrations, GameSocket, Net, Input, Replicated, Transform } from 'esengine';
import ${JSON.stringify(posix(path.join(PROJECT, 'src', 'main.ts')))};
`;
writeFileSync(path.join(work, 'probe.entry.ts'), probeSource);

const probeOut = path.join(work, 'probe.mjs');
const { build } = await import('esbuild');
await build({
  entryPoints: [path.join(work, 'probe.entry.ts')],
  outfile: probeOut,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
  // The project's `import ... from 'esengine'` resolves to the same headless SDK
  // the server bundle uses — one build on both ends, which is what the
  // handshake's ABI/schema check insists on.
  alias: { esengine: SDK, 'esengine/node': SDK },
});

const probe = await import(pathToFileURL(probeOut).href);

// ---------------------------------------------------------------------------
// Boot the server and learn the port it got.
// ---------------------------------------------------------------------------

server = spawn(process.execPath, [
  path.join(PROJECT, '.esengine', 'cache', 'server.mjs'),
  '--port', '0', '--wasm', WASM,
], { cwd: ROOT });

let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });
server.on('exit', (code) => {
  if (code !== 0 && code !== null) fail(`the server exited ${code}.`, serverLog);
});

const url = await (async () => {
  for (let i = 0; i < 100; i++) {
    const match = serverLog.match(/listening on (ws:\/\/\S+)/);
    if (match) return match[1];
    await delay(100);
  }
  return null;
})();
if (!url) fail('the server never reported a listening address.', serverLog);

// ---------------------------------------------------------------------------
// Two clients.
// ---------------------------------------------------------------------------

/** A client App on a real socket, ticking on the fixed step like a game does. */
async function connectClient({ withGameplay }) {
  const app = probe.createHeadlessApp(await probe.loadEsengineModule(WASM));
  // Only the first client installs the project's systems; the spectator runs
  // the replication plugin alone, so what it sees it was SENT.
  if (withGameplay) probe.flushPendingRegistrations(app);
  const socket = new probe.GameSocket({ url });
  socket.connect();
  const client = await app.getResource(probe.Net).connect(socket, { interpolationDelayTicks: 0 });
  return { app, client, socket };
}

/** Every replicated entity this client can see, with its position. */
function ghosts(app) {
  return app.world.getEntitiesWithComponents([probe.Replicated]).map((e) => ({
    entity: e,
    x: app.world.tryGet(e, probe.Transform)?.position.x ?? NaN,
  }));
}

/** Tick both apps for `seconds` of simulated time, letting the socket breathe. */
async function run(apps, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    for (const app of apps) await app.tick(STEP);
    await delay(4);
  }
}

let player, spectator;
try {
  player = await connectClient({ withGameplay: true });
  spectator = await connectClient({ withGameplay: false });
} catch (err) {
  fail(`a client could not complete the handshake: ${err?.message ?? err}`, serverLog);
}

// Let the roster settle: the authority provisions a pawn per connection on its
// next fixed tick, and the spawns come back over the socket.
await run([player.app, spectator.app], 0.5);

// 2 — the authority has no keyboard, so it owns no pawn. Two connections, two
// pawns; a third would be the host phantom this deployment must not have.
const seen = ghosts(spectator.app);
if (seen.length !== 2) {
  fail(`the spectator sees ${seen.length} replicated pawn(s), expected 2 (one per connection).`
    + ' A third would mean the dedicated server spawned a host pawn it cannot steer.', serverLog);
}

// 3 — hold a direction. This is the project's own input system reading the
// project's own key bindings; nothing here reaches past it to move anything.
const input = player.app.getResource(probe.Input);
input.keysDown.add('KeyD');

const own = () => ghosts(player.app).find((g) => player.client.ownsEntity(g.entity));
const startX = own()?.x;
if (startX === undefined) fail('the connected client owns no pawn.', serverLog);

await run([player.app, spectator.app], 0.4);
const movedX = own().x;
if (!(movedX > startX + 20)) {
  fail(`holding right moved the owned pawn from ${startX} to ${movedX} — expected it to advance.`, serverLog);
}

// Long enough to cross the arena and pin against the wall. The clamp is part of
// the shared movement rule, so server and prediction must agree on it exactly.
await run([player.app, spectator.app], 3.0);
input.keysDown.delete('KeyD');
const wallX = own().x;
if (Math.abs(wallX - BOUND_X) > 0.5) {
  fail(`the owned pawn settled at x=${wallX}, expected the arena wall at ${BOUND_X}.`, serverLog);
}

// 4 — a third party saw it happen. The spectator runs no gameplay code at all,
// so this position can only have arrived as replicated state.
await run([player.app, spectator.app], 0.3);
const witnessed = ghosts(spectator.app).map((g) => g.x);
if (!witnessed.some((x) => Math.abs(x - BOUND_X) < 40)) {
  fail(`the spectator never saw the moving pawn reach the wall (saw x=${witnessed.join(', ')}).`, serverLog);
}

// 5 — leaving takes the pawn with it. This is the assertion the editor's
// preview cannot make: its MessagePorts never close.
player.client.disconnect();
player.socket.close();
await run([spectator.app], 0.6);
const after = ghosts(spectator.app);
if (after.length !== 1) {
  fail(`after a client left the spectator still sees ${after.length} pawn(s), expected 1.`
    + ' The authority is not retiring pawns for departed connections.', serverLog);
}

spectator.client.disconnect();
spectator.socket.close();
cleanup();
console.log('check-arena-server: multiplayer-arena served headless over a real socket —'
  + ' no host phantom, input moved and clamped, replicated to a third party, and a leaver was retired.');
