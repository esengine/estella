// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-remote-capture.mjs — a development build dials the editor, and the
 *        editor captures and replays one of its frames.
 *
 * The editor's own server (desktop/shared/debugChannelServer.mjs) listens; a golden
 * project is exported with the channel and opened the way a player opens it; the
 * frame comes back over the socket. Asked of the package, not of the editor's
 * realms, because a capture that only works in-process is the one this exists to
 * go beyond. Also asked: a dial with the wrong token is refused, and a shipping
 * export will not carry a channel at all.
 *
 *   node tools/verify-remote-capture.mjs [--project input-actions] [--platform web]
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectDir, ROOT } from './goldenProjects.mjs';
import { spawnElectron } from './lib/electronRun.mjs';
import { createDebugChannelServer } from '../desktop/shared/debugChannelServer.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const PROJECT = arg('project', 'input-actions');
const PLATFORM = arg('platform', 'web');
const LAUNCHER = { web: 'launch-export.mjs', wechat: 'launch-minigame.mjs', douyin: 'launch-minigame.mjs' }[PLATFORM];
if (!LAUNCHER) {
  console.error(`verify-remote-capture: no launcher for ${PLATFORM}`);
  process.exit(2);
}
const WORK = path.join(ROOT, 'build', 'remote-capture');
const { WebSocketServer, WebSocket } = createRequire(path.join(ROOT, 'desktop', 'package.json'))('ws');

const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) problems.push(what);
};

const exportPackage = (out, extra) => spawnSync(process.execPath, [
  path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', projectDir(PROJECT),
  '--platform', PLATFORM, '--out', out, ...extra,
], { encoding: 'utf8', cwd: ROOT });

const lines = [];
const server = await createDebugChannelServer({
  WebSocketServer, host: '127.0.0.1', onLog: (_id, level, line) => lines.push({ level, line }),
});
let child = null;
try {
  const refused = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/?token=not-${server.token}`);
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('error', () => {});
  });
  check(refused === 401, `a dial with the wrong token is refused at the upgrade (got ${refused})`);

  mkdirSync(WORK, { recursive: true });
  const shipping = exportPackage(path.join(WORK, 'shipping'), ['--minify', '--debug-channel', server.urlFor('127.0.0.1')]);
  check(shipping.status !== 0 && /never carries a debug channel/.test(`${shipping.stdout}${shipping.stderr}`),
    'a shipping export refuses the channel');

  const out = path.join(WORK, `${PROJECT}-${PLATFORM}`);
  rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  const exported = exportPackage(out, ['--debug-channel', server.urlFor('127.0.0.1')]);
  if (exported.status !== 0) {
    console.error(`${exported.stdout}${exported.stderr}`.trim().split('\n').slice(-8).join('\n'));
    throw new Error(`export of ${PROJECT} for ${PLATFORM} failed`);
  }

  const connected = new Promise((resolve) => {
    const poll = setInterval(() => {
      const t = server.targets()[0];
      if (t) { clearInterval(poll); resolve(t); }
    }, 100);
  });
  child = spawnElectron([path.join(ROOT, 'tools', 'launchers', LAUNCHER), '--dir', out,
    '--settle', '3600', '--timeout', '60000'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => child.on('close', resolve));

  const target = await Promise.race([
    connected,
    exited.then(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 90_000)),
  ]);
  check(!!target, `the package dialled the editor${target ? ` (${target.platform}, protocol ${target.protocol})` : ''}`);
  if (!target) {
    console.error(log.trim().split('\n').slice(-12).join('\n'));
    throw new Error('no device connected');
  }

  const report = await server.query(target.id, 'frameCapture');
  const draws = report?.draws ?? [];
  check(draws.length > 0 && report.passCount >= 1,
    `a frame came back over the socket: ${draws.length} draw(s) in ${report?.passCount ?? 0} pass(es)`);
  const named = Object.keys(report?.names ?? {}).length;
  check(named > 0, `the device named its entities (${named})`);

  const scene = draws.filter((d) => d.pass === 0);
  const last = (scene.length ? scene : draws).at(-1);
  const image = last ? await server.query(target.id, 'frameReplay', { drawIndex: last.index }) : null;
  const size = image ? image.width * image.height * 4 : 0;
  check(!!image && size > 0 && image.pixels.byteLength === size,
    `the replay of draw ${last?.index} came back as ${image?.width}x${image?.height} RGBA (${image?.pixels.byteLength ?? 0} bytes)`);
  check(!!image?.matchesCapture, 'the replay matches the frame it was captured from');
  let lit = 0;
  for (let i = 0; image && i < image.pixels.length; i += 4) {
    if (image.pixels[i + 3] > 0 && (image.pixels[i] | image.pixels[i + 1] | image.pixels[i + 2]) > 8) lit++;
  }
  check(lit > 0, `the replayed pass has drawn pixels (${lit})`);

  const now = server.targets().find((t) => t.id === target.id);
  check(now?.project === 'Input Actions' && typeof now?.revision === 'string',
    `the build said which project and content it is (${now?.project}, ${now?.revision})`);
  // Lines travel in batches, behind whatever answer is on the socket.
  for (const until = Date.now() + 5000; Date.now() < until && !lines.some((l) => /EstellaContext initialized/.test(l.line));) {
    await new Promise((r) => setTimeout(r, 100));
  }
  check(lines.some((l) => /EstellaContext initialized/.test(l.line)),
    `what the device printed before it connected reached the editor (${lines.length} line(s))`);

  // The first ask turns timings on; they exist once the device has run a frame since,
  // which a software-rendered runner can take a second or more to do.
  await server.query(target.id, 'stats');
  let stats = null;
  for (const until = Date.now() + 10_000; Date.now() < until;) {
    await new Promise((r) => setTimeout(r, 250));
    stats = await server.query(target.id, 'stats');
    if (Object.keys(stats?.phases ?? {}).length > 0) break;
  }
  check(stats?.entities > 0 && Object.keys(stats?.phases ?? {}).length > 0 && stats?.wasmBytes > 0,
    `the device reported its frame: ${stats?.entities} entities, ${Object.keys(stats?.phases ?? {}).length} phase(s), ${stats?.wasmBytes} wasm bytes`);

  // What the channel costs the game it watches, over a window of frames, by its own clock.
  await server.query(target.id, 'stats');
  await new Promise((r) => setTimeout(r, 2000));
  const cost = await server.query(target.id, 'stats');
  const perFrame = cost?.frames > 0 ? cost.agentMs / cost.frames : NaN;
  check(typeof cost?.agentMs === 'number' && cost.frames > 0 && perFrame <= 0.5,
    `the debug channel cost the device ${cost?.agentMs?.toFixed(3)} ms over ${cost?.frames} frame(s) — ${perFrame.toFixed(4)} ms a frame (budget 0.5)`);

  const tree = (await server.query(target.id, 'snapshot', { selectedId: null, withTree: true }))?.tree;
  const ship = tree?.entities.find((e) => e.name === 'Ship');
  const one = ship ? (await server.query(target.id, 'snapshot', { selectedId: ship.id, withTree: false }))?.selected : null;
  const transform = one?.components.find((c) => c.type === 'Transform');
  check(!!ship && typeof transform?.data?.position?.x === 'number',
    `the device's world came back: ${tree?.entities.length ?? 0} entities, Ship's Transform ${JSON.stringify(transform?.data?.position)}`);

  const paused = await server.query(target.id, 'control', { paused: true, fps: 30 });
  const stepped = await server.query(target.id, 'control', { step: 2 });
  const resumed = await server.query(target.id, 'control', { paused: false, fps: 0 });
  check(paused.paused && paused.fps === 30 && stepped.paused && !resumed.paused && resumed.fps === 0,
    `the device paused, stepped while paused, capped and resumed (${JSON.stringify([paused, stepped, resumed])})`);
} catch (e) {
  problems.push(e.message);
  console.error(`✗ ${e.message}`);
} finally {
  child?.kill();
  await server.close();
}

if (problems.length) {
  console.error(`\nverify-remote-capture: ${problems.length} problem(s) — ${PROJECT} on ${PLATFORM}`);
  process.exit(1);
}
console.log(`\nverify-remote-capture: ${PROJECT} on ${PLATFORM} — captured and replayed over the debug channel.`);
