// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  net-sample-microbench.mjs — what one replication sample costs the server, in one process.
 *
 * `net-capacity-benchmark.mjs` measures a whole server against real sockets and
 * bot processes, which is the honest number and a noisy one: on a shared
 * machine the same run varies by half. This isolates the replication tick —
 * no sockets, no bots — so two versions of the server can be compared: N
 * connections over in-memory links that discard what they are sent, N pawns
 * moving every tick, and the server's own tick timed.
 *
 * Two clocks: wall time, and this thread's CPU time (`process.threadCpuUsage`),
 * which other processes taking the machine move far less. Compare versions by
 * CPU time.
 *
 *   node tools/net-sample-microbench.mjs                      # 200 players, crowd
 *   node tools/net-sample-microbench.mjs --players 800 --spread --wasm
 *   node tools/net-sample-microbench.mjs --players 200 --budget 16000
 *
 * `--wasm` runs the real engine: pawns are placed by `Transform` and interest is
 * the default radius provider, which keeps its grid between samples — the path
 * a shipped server takes. Without it a script component stands in for the
 * position and the grid is rebuilt every sample. `--spread` gives each player
 * about 30 others in range instead of everyone.
 *
 * `--phases` also prints what each phase of the sample cost per tick (the
 * server's own `samplePhases`), so a change to one phase can be read off that
 * phase rather than off the whole tick.
 *
 * Reads the built SDK (sdk/dist), and with `--wasm` the engine at build/wasm/web.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `ES_SDK_DIST` points at another build of the SDK, to compare two versions in turn.
const DIST = process.env.ES_SDK_DIST ? path.resolve(process.env.ES_SDK_DIST) : path.join(ROOT, 'sdk', 'dist');
const sdk = await import(pathToFileURL(path.join(DIST, 'index.node.js')).href);
const repl = await import(pathToFileURL(path.join(DIST, 'net', 'replication', 'index.js')).href);

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const PLAYERS = Number(opt('players', 200));
const BUDGET = Number(opt('budget', 0));
const TICKS = Number(opt('ticks', 300));
const WARMUP = Number(opt('warmup', 60));
const SPREAD = argv.includes('--spread');
const WASM = argv.includes('--wasm');
const PHASES = argv.includes('--phases');
const RADIUS = 100;
const STEP = 1 / 20;

const module = WASM ? await sdk.loadEsengineModule(path.join(ROOT, 'build', 'wasm', 'web')) : null;
const newApp = () => (module ? sdk.createHeadlessApp(module) : sdk.App.new());

// Where a pawn is, and how it moves: Transform with the engine, a script component without.
const Pos = WASM ? null : sdk.defineComponent('BenchPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
const position = Pos
    ? (world, e) => { const p = world.tryGet(e, Pos); return p ? { x: p.x, y: p.y, z: p.z } : null; }
    : undefined;
const place = (world, e, x, z) => {
    if (Pos) world.insert(e, Pos, { x, y: 0, z });
    else world.insert(e, sdk.Transform, { position: { x, y: 0, z } });
};
const move = (world, e, dx, dz, half) => {
    if (Pos) {
        world.update(e, Pos, (d) => {
            d.x = Math.max(-half, Math.min(half, d.x + dx));
            d.z = Math.max(-half, Math.min(half, d.z + dz));
        });
    } else {
        const t = world.tryGet(e, sdk.Transform);
        t.position.x = Math.max(-half, Math.min(half, t.position.x + dx));
        t.position.z = Math.max(-half, Math.min(half, t.position.z + dz));
        world.set(e, sdk.Transform, t);
    }
};

const serverApp = newApp();
serverApp.setFixedTimestep(STEP);
if (!WASM) serverApp.addPlugin(repl.replicationPlugin);
const server = serverApp.getResource(repl.Net).startServer({ heartbeat: false, helloTimeoutMs: 0 });
server.setInterestProvider(repl.radiusInterestProvider(RADIUS, position ? { position } : {}));
if (BUDGET > 0) server.setBandwidthBudget({ bytesPerSecond: BUDGET, ...(position ? { position } : {}) });

// Each connection: a real client completes the handshake, then lets go of its
// end, so what the server sends after that lands nowhere and costs nothing.
// One client world serves every handshake.
const clientApp = newApp();
if (!WASM) clientApp.addPlugin(repl.replicationPlugin);
const side = SPREAD ? Math.sqrt((PLAYERS * Math.PI * RADIUS * RADIUS) / 30) : RADIUS * 1.4;
const pawns = [];
for (let i = 0; i < PLAYERS; i++) {
    const [a, b] = repl.MemoryTransport.pair();
    const id = server.attachConnection(a);
    const client = new repl.ReplicationClient(clientApp.world, { interpolationDelayTicks: 0 });
    await client.connect(b);
    client.disconnect();
    const e = serverApp.world.spawn(`p${i}`);
    place(serverApp.world, e, (Math.random() - 0.5) * side, (Math.random() - 0.5) * side);
    serverApp.world.insert(e, repl.Replicated, { owner: id });
    pawns.push({ e, heading: Math.random() * Math.PI * 2 });
}

const half = side / 2;
server.profileSample = PHASES;
const wall = [];
const cpu = [];
for (let t = 0; t < WARMUP + TICKS; t++) {
    for (const p of pawns) {
        if (Math.random() < 0.02) p.heading = Math.random() * Math.PI * 2;
        move(serverApp.world, p.e, Math.cos(p.heading) * 6 * STEP, Math.sin(p.heading) * 6 * STEP, half);
    }
    const c0 = process.threadCpuUsage();
    const t0 = performance.now();
    await serverApp.tick(STEP);
    const w = performance.now() - t0;
    const c = process.threadCpuUsage(c0);
    if (t >= WARMUP) { wall.push(w); cpu.push((c.user + c.system) / 1000); }
    if (t === WARMUP - 1) server.samplePhases.clear();
}
const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
    return { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p90: q(0.9) };
};
const w = stat(wall);
const c = stat(cpu);
console.log(`${PLAYERS} players, ${SPREAD ? 'spread' : 'crowd'}, ${WASM ? 'engine' : 'script'} positions, ${BUDGET > 0 ? `budget ${BUDGET} B/s` : 'no budget'}: `
    + `tick mean ${w.mean.toFixed(2)} ms (cpu ${c.mean.toFixed(2)} ms), p50 ${w.p50.toFixed(2)} (cpu ${c.p50.toFixed(2)}), p90 ${w.p90.toFixed(2)}, `
    + `rows sent ${server.deltaRowsSent}, deferred ${server.rowsDeferred}`);
if (PHASES) {
    const rows = [...server.samplePhases].sort((a, b) => b[1] - a[1]);
    for (const [phase, ms] of rows) console.log(`  ${phase.padEnd(20)} ${(ms / TICKS).toFixed(3)} ms/tick`);
}
