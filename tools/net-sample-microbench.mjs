// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  net-sample-microbench.mjs — what one replication sample costs the server, in one process.
 *
 * `net-capacity-benchmark.mjs` measures a whole server against real sockets and
 * bot processes, which is the honest number and a noisy one: on a shared
 * machine the same run varies by half. This isolates the replication sample
 * itself — no wasm, no sockets, no bots — so two versions of the server can be
 * compared within a few percent: N connections over in-memory links that
 * discard what they are sent, N pawns moving every tick in a crowd (everyone
 * inside everyone's interest radius), and the server's own sample timed.
 *
 *   node tools/net-sample-microbench.mjs                      # 200 players, crowd
 *   node tools/net-sample-microbench.mjs --players 200 --budget 16000
 *   node tools/net-sample-microbench.mjs --spread             # ~30 visible each instead of all
 *
 * Reads the built SDK (sdk/dist).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = await import(pathToFileURL(path.join(ROOT, 'sdk', 'dist', 'index.node.js')).href);
const repl = await import(pathToFileURL(path.join(ROOT, 'sdk', 'dist', 'net', 'replication', 'index.js')).href);

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
const RADIUS = 100;
const STEP = 1 / 20;

const Pos = sdk.defineComponent('BenchPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
const position = (world, e) => {
    const p = world.tryGet(e, Pos);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
};

const serverApp = sdk.App.new();
serverApp.setFixedTimestep(STEP);
serverApp.addPlugin(repl.replicationPlugin);
const server = serverApp.getResource(repl.Net).startServer();
server.setInterestProvider(repl.radiusInterestProvider(RADIUS, { position }));
if (BUDGET > 0) {
    // The default priority (distance to what the connection owns), reading this benchmark's position component.
    server.setBandwidthBudget({ bytesPerSecond: BUDGET, position });
}

// Each connection: a real client completes the handshake, then lets go of its
// end, so what the server sends after that lands nowhere and costs nothing.
const side = SPREAD ? Math.sqrt((PLAYERS * Math.PI * RADIUS * RADIUS) / 30) : RADIUS * 1.4;
const pawns = [];
for (let i = 0; i < PLAYERS; i++) {
    const clientApp = sdk.App.new();
    clientApp.addPlugin(repl.replicationPlugin);
    const [a, b] = repl.MemoryTransport.pair();
    const id = server.attachConnection(a);
    const client = await clientApp.getResource(repl.Net).connect(b, { interpolationDelayTicks: 0 });
    client.disconnect();
    const e = serverApp.world.spawn(`p${i}`);
    serverApp.world.insert(e, Pos, { x: (Math.random() - 0.5) * side, y: 0, z: (Math.random() - 0.5) * side });
    serverApp.world.insert(e, repl.Replicated, { owner: id });
    pawns.push({ e, heading: Math.random() * Math.PI * 2 });
}

const half = side / 2;
const times = [];
for (let t = 0; t < WARMUP + TICKS; t++) {
    for (const p of pawns) {
        if (Math.random() < 0.02) p.heading = Math.random() * Math.PI * 2;
        serverApp.world.update(p.e, Pos, (d) => {
            d.x = Math.max(-half, Math.min(half, d.x + Math.cos(p.heading) * 6 * STEP));
            d.z = Math.max(-half, Math.min(half, d.z + Math.sin(p.heading) * 6 * STEP));
        });
    }
    const t0 = performance.now();
    await serverApp.tick(STEP);
    if (t >= WARMUP) times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const q = (f) => times[Math.min(times.length - 1, Math.floor(f * times.length))];
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`${PLAYERS} players, ${SPREAD ? 'spread' : 'crowd'}, ${BUDGET > 0 ? `budget ${BUDGET} B/s` : 'no budget'}: `
    + `tick mean ${mean.toFixed(2)} ms, p50 ${q(0.5).toFixed(2)}, p90 ${q(0.9).toFixed(2)}, rows sent ${server.deltaRowsSent}, deferred ${server.rowsDeferred}`);
