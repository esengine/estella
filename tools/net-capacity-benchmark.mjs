// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  net-capacity-benchmark.mjs — how many players one server process holds.
 *
 * One authority process (headless engine, real wasm, `ws` sockets, the shipped
 * replication server) and a set of bot processes, each holding many real
 * clients on real sockets. Every bot owns a pawn, sends one move command per
 * tick and wanders. The run steps the player count up until the server can no
 * longer keep its tick rate, and reports per step:
 *
 *   - tick: what one simulation + replication tick costs (p50 / p99 / max)
 *   - ELU:  how busy the server's event loop is overall, socket I/O included —
 *           this, not the tick alone, is what runs out first
 *   - rate: ticks the server actually achieved per second against its target
 *   - out:  bytes per second sent to one client, and in total
 *   - bots: the busiest bot process's ELU — above ~0.9 the bots, not the
 *           server, are what the step measured, and it is marked as such
 *
 * A step HOLDS when the server keeps ≥ 97% of its tick rate, its p99 tick fits
 * the tick interval, and its ELU stays under 0.85.
 *
 * World: a square sized so a player sees about `--visible` others within
 * `--radius` (constant density, as in a zone that spreads its players out).
 * `--interest none` turns interest off (everyone sees everyone) and `--crowd`
 * puts everyone in one circle of `--radius` (a town square / world boss) —
 * the two worst cases.
 *
 *   node tools/net-capacity-benchmark.mjs
 *   node tools/net-capacity-benchmark.mjs --hz 20 --steps 200,400,800,1600 --seconds 10
 *   node tools/net-capacity-benchmark.mjs --crowd --steps 50,100,200,400
 *   node tools/net-capacity-benchmark.mjs --no-batch    # one socket write per frame, as before
 *   node tools/net-capacity-benchmark.mjs --json out.json
 *
 * Needs the engine wasm at build/wasm/web and a built sdk/dist.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SDK = path.join(ROOT, 'sdk', 'dist', 'index.node.js');
const REPL = path.join(ROOT, 'sdk', 'dist', 'net', 'replication', 'index.js');
const WASM = path.join(ROOT, 'build', 'wasm', 'web');

function args() {
    const out = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) out[key] = true;
        else { out[key] = next; i++; }
    }
    return out;
}

const A = args();
const ROLE = A.role ?? 'run';
const HZ = Number(A.hz ?? 20);
const RADIUS = Number(A.radius ?? 100);
const VISIBLE = Number(A.visible ?? 30);
const SPEED = Number(A.speed ?? 6);
const INTEREST = A.interest ?? 'radius';
const CROWD = A.crowd === true;
const BATCH = A['no-batch'] !== true;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Side of the square world for `players` at the density that gives `VISIBLE` neighbours. */
function worldSide(players) {
    if (CROWD) return RADIUS * 1.4; // a square that fits inside the interest circle around any point of it
    return Math.sqrt((players * Math.PI * RADIUS * RADIUS) / Math.max(1, VISIBLE));
}

function quantile(sorted, q) {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

async function loadEngine() {
    const sdk = await import(pathToFileURL(SDK).href);
    const repl = await import(pathToFileURL(REPL).href);
    const module = await sdk.loadEsengineModule(WASM);
    return { sdk, repl, module };
}

/** The pawn's one gameplay component — speed and a wander target live on the authority only. */
function definePawn(sdk) {
    return sdk.defineComponent('BenchPawn', { player: 0 });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** The adapter servers wrote by hand before the SDK had one: one socket write per frame. */
function plainTransport(socket) {
    const handlers = new Set();
    socket.on('message', (data, isBinary) => {
        const frame = isBinary ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : String(data);
        for (const h of [...handlers]) h(frame);
    });
    return {
        delivery: 'reliable-ordered',
        send: (d) => socket.send(d),
        on: (_event, handler) => { handlers.add(handler); return () => handlers.delete(handler); },
    };
}

async function runServer() {
    const players = Number(A.players);
    const side = worldSide(players);
    const { sdk, repl, module } = await loadEngine();
    // `ws` is installed with the SDK, not at the repo root.
    const { WebSocketServer } = createRequire(path.join(ROOT, 'sdk', 'package.json'))('ws');
    const Pawn = definePawn(sdk);

    const app = sdk.createHeadlessApp(module);
    app.setFixedTimestep(1 / HZ);
    const server = app.getResource(repl.Net).startServer();
    if (INTEREST === 'radius') server.setInterestProvider(repl.radiusInterestProvider(RADIUS));

    // Movement: each pawn consumes its connection's command for this tick.
    app.addSystemToSchedule(sdk.Schedule.FixedUpdate, sdk.defineSystem(
        [sdk.GetWorld(), sdk.Res(sdk.Time)],
        (world, time) => {
            const half = side / 2;
            for (const e of world.getEntitiesWithComponents([Pawn, repl.Replicated])) {
                const owner = world.tryGet(e, repl.Replicated).owner;
                const move = server.tickInputOf(owner)?.actions?.move;
                if (!move || (move.x === 0 && move.z === 0)) continue;
                const t = world.tryGet(e, sdk.Transform);
                t.position.x = Math.max(-half, Math.min(half, t.position.x + move.x * SPEED * time.fixedDelta));
                t.position.z = Math.max(-half, Math.min(half, t.position.z + move.z * SPEED * time.fixedDelta));
                world.set(e, sdk.Transform, t);
            }
        },
        { name: 'BenchMoveSystem' },
    ));

    let bytesOut = 0;
    let framesOut = 0;
    const pawns = new Map();

    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
    await new Promise((r) => wss.once('listening', r));
    wss.on('connection', (socket) => {
        // The SDK's adapter batches each sample into one write per client;
        // --no-batch is the plain adapter every frame used to take.
        const inner = BATCH ? repl.webSocketTransport(socket) : plainTransport(socket);
        const id = server.attachConnection({
            ...inner,
            send: (d) => {
                bytesOut += typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength;
                framesOut++;
                inner.send(d);
            },
        });
        // The pawn exists from the first tick: a connection with no positioned
        // entity fails open to the whole world, which would flood every joiner.
        const e = app.world.spawn(`P${id}`);
        app.world.insert(e, sdk.Transform, {
            position: { x: (Math.random() - 0.5) * side, y: 0, z: (Math.random() - 0.5) * side },
        });
        app.world.insert(e, Pawn, { player: id });
        app.world.insert(e, repl.Replicated, { owner: id });
        pawns.set(id, e);
        const drop = () => {
            if (!pawns.has(id)) return;
            server.detachConnection(id);
            app.world.despawn(pawns.get(id));
            pawns.delete(id);
        };
        socket.on('close', drop);
        socket.on('error', drop);
    });

    const port = wss.address().port;
    console.log(`LISTEN ${port}`);
    // A clean exit after N seconds, so `node --cpu-prof` gets to write its profile.
    if (A['exit-after']) setTimeout(() => process.exit(0), Number(A['exit-after']) * 1000);

    // Own fixed-rate loop rather than runHeadless: it measures every tick and
    // schedules against absolute time, so a slow tick shows as a lost tick.
    const interval = 1000 / HZ;
    const ticks = [];
    let ticksThisSecond = 0;
    let elu = performance.eventLoopUtilization();
    let cpu = process.cpuUsage();
    let windowStart = performance.now();
    let next = performance.now();
    let last = performance.now();

    const report = () => {
        const now = performance.now();
        const span = (now - windowStart) / 1000;
        const sorted = ticks.slice().sort((a, b) => a - b);
        const eluNow = performance.eventLoopUtilization(elu);
        const cpuNow = process.cpuUsage(cpu);
        console.log('STAT ' + JSON.stringify({
            connections: pawns.size,
            rate: ticksThisSecond / span,
            tickP50: quantile(sorted, 0.5),
            tickP99: quantile(sorted, 0.99),
            tickMax: sorted[sorted.length - 1] ?? 0,
            elu: eluNow.utilization,
            cpu: (cpuNow.user + cpuNow.system) / 1000 / (span * 1000),
            bytesOut: bytesOut / span,
            framesOut: framesOut / span,
            rssMB: process.memoryUsage().rss / 1048576,
        }));
        ticks.length = 0;
        ticksThisSecond = 0;
        bytesOut = 0;
        framesOut = 0;
        elu = performance.eventLoopUtilization();
        cpu = process.cpuUsage();
        windowStart = now;
    };
    setInterval(report, 1000);

    const loop = async () => {
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        const t0 = performance.now();
        await app.tick(dt);
        ticks.push(performance.now() - t0);
        ticksThisSecond++;
        next += interval;
        // Behind by more than a tick: give up on the backlog instead of spiralling.
        if (performance.now() - next > interval) next = performance.now();
        setTimeout(loop, Math.max(0, next - performance.now()));
    };
    setTimeout(loop, interval);
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

async function runBots() {
    const count = Number(A.count);
    const url = A.url;
    const { sdk, repl, module } = await loadEngine();
    definePawn(sdk); // the handshake compares replication tables; both ends declare the same set

    const bots = [];
    let bytesIn = 0;
    let failed = 0;

    // Count what arrives without changing what the client does with it.
    const NativeWS = globalThis.WebSocket;
    globalThis.WebSocket = class extends NativeWS {
        constructor(...a) {
            super(...a);
            this.addEventListener('message', (ev) => {
                bytesIn += typeof ev.data === 'string' ? Buffer.byteLength(ev.data) : (ev.data.byteLength ?? ev.data.size ?? 0);
            });
        }
    };

    async function connectOne() {
        const app = sdk.createHeadlessApp(module);
        app.setFixedTimestep(1 / HZ);
        const socket = new sdk.GameSocket({ url });
        socket.connect();
        const client = await app.getResource(repl.Net).connect(socket, { interpolationDelayTicks: 2 });
        const bot = { app, client, socket, move: { x: 0, z: 0 }, turnAt: 0 };
        app.addSystemToSchedule(sdk.Schedule.FixedUpdate, sdk.defineSystem([], () => {
            if (performance.now() > bot.turnAt) {
                const a = Math.random() * Math.PI * 2;
                bot.move = Math.random() < 0.2 ? { x: 0, z: 0 } : { x: Math.cos(a), z: Math.sin(a) };
                bot.turnAt = performance.now() + 1000 + Math.random() * 4000;
            }
            client.sendInput({ move: bot.move });
        }, { name: 'BotInputSystem' }));
        bots.push(bot);
    }

    // Join in waves: a thousand handshakes in one instant is a login storm, which is its own test.
    for (let i = 0; i < count; i += 10) {
        const wave = [];
        for (let j = i; j < Math.min(count, i + 10); j++) wave.push(connectOne().catch(() => { failed++; }));
        await Promise.all(wave);
        await delay(20);
    }
    console.log(`READY ${bots.length} ${failed}`);

    const interval = 1000 / HZ;
    let elu = performance.eventLoopUtilization();
    let windowStart = performance.now();
    let ghostSample = 0;
    setInterval(() => {
        const now = performance.now();
        const span = (now - windowStart) / 1000;
        let ghosts = 0;
        const sample = bots.slice(0, Math.min(20, bots.length));
        for (const b of sample) ghosts += b.app.world.getEntitiesWithComponents([repl.Replicated]).length;
        ghostSample = sample.length ? ghosts / sample.length : 0;
        console.log('STAT ' + JSON.stringify({
            bots: bots.length,
            failed,
            bytesIn: bytesIn / span,
            elu: performance.eventLoopUtilization(elu).utilization,
            ghosts: ghostSample,
        }));
        bytesIn = 0;
        elu = performance.eventLoopUtilization();
        windowStart = now;
    }, 1000);

    let next = performance.now();
    let last = performance.now();
    const loop = async () => {
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        for (const b of bots) await b.app.tick(dt);
        next += interval;
        if (performance.now() - next > interval) next = performance.now();
        setTimeout(loop, Math.max(0, next - performance.now()));
    };
    loop();
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

function child(role, extra) {
    const argv = [fileURLToPath(import.meta.url), '--role', role, '--hz', String(HZ), '--radius', String(RADIUS),
        '--visible', String(VISIBLE), '--speed', String(SPEED), '--interest', INTEREST, ...(CROWD ? ['--crowd'] : []), ...(BATCH ? [] : ['--no-batch']), ...extra];
    const proc = spawn(process.execPath, argv, {
        cwd: ROOT,
        env: { ...process.env, NODE_PATH: [path.join(ROOT, 'sdk', 'node_modules'), path.join(ROOT, 'node_modules')].join(path.delimiter) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stats = [];
    proc.log = '';
    let buf = '';
    proc.stdout.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line.startsWith('STAT ')) proc.stats.push(JSON.parse(line.slice(5)));
            else proc.log += line + '\n';
        }
    });
    proc.stderr.on('data', (d) => { proc.log += d.toString(); });
    return proc;
}

async function waitFor(proc, re, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const m = proc.log.match(re);
        if (m) return m;
        if (proc.exitCode !== null) break;
        await delay(50);
    }
    throw new Error(`timed out waiting for ${re}\n${proc.log.slice(-2000)}`);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

async function runStep(players, botProcs, seconds) {
    const server = child('server', ['--players', String(players)]);
    const port = Number((await waitFor(server, /LISTEN (\d+)/, 30000))[1]);
    const url = `ws://127.0.0.1:${port}`;
    const procs = Math.max(1, Math.min(botProcs, Math.ceil(players / 25)));
    const bots = [];
    for (let i = 0; i < procs; i++) {
        const n = Math.floor(players / procs) + (i < players % procs ? 1 : 0);
        bots.push(child('bots', ['--count', String(n), '--url', url]));
    }
    try {
        let joined = 0;
        let failed = 0;
        for (const b of bots) {
            const m = await waitFor(b, /READY (\d+) (\d+)/, 600000);
            joined += Number(m[1]);
            failed += Number(m[2]);
        }
        // Settle: joins finished, interest sets formed, the GC has seen the population.
        await delay(3000);
        const from = server.stats.length;
        const botFrom = bots.map((b) => b.stats.length);
        await delay(seconds * 1000);
        const s = server.stats.slice(from);
        const botStats = bots.map((b, i) => b.stats.slice(botFrom[i]));
        const per = (k) => mean(s.map((x) => x[k]));
        const result = {
            players,
            joined,
            failed,
            connections: Math.min(...s.map((x) => x.connections)),
            rate: per('rate'),
            tickP50: per('tickP50'),
            tickP99: Math.max(...s.map((x) => x.tickP99)),
            tickMax: Math.max(...s.map((x) => x.tickMax)),
            elu: per('elu'),
            cpu: per('cpu'),
            bytesOutTotal: per('bytesOut'),
            bytesOutPerClient: per('bytesOut') / Math.max(1, joined),
            rssMB: Math.max(...s.map((x) => x.rssMB)),
            ghosts: mean(botStats.map((xs) => mean(xs.map((x) => x.ghosts)))),
            botEluMax: Math.max(...botStats.map((xs) => mean(xs.map((x) => x.elu)))),
            botProcs: procs,
        };
        result.holds = result.rate >= HZ * 0.97 && result.tickP99 <= 1000 / HZ && result.elu < 0.85 && failed === 0;
        result.botBound = result.botEluMax > 0.9;
        return result;
    } finally {
        for (const b of bots) b.kill();
        server.kill();
        await delay(500);
    }
}

function fmtBytes(n) {
    if (n >= 1048576) return `${(n / 1048576).toFixed(2)} MB/s`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB/s`;
    return `${n.toFixed(0)} B/s`;
}

async function runAll() {
    if (!existsSync(path.join(WASM, 'esengine.wasm'))) {
        console.error('net-capacity-benchmark: no engine wasm at build/wasm/web (node build-tools/cli.js build -t web)');
        process.exit(1);
    }
    const steps = String(A.steps ?? '100,200,400,800,1200,1600,2400').split(',').map(Number);
    const seconds = Number(A.seconds ?? 10);
    const botProcs = Number(A.bots ?? Math.max(2, os.cpus().length - 4));
    const modeBase = CROWD ? `crowd (everyone within ${RADIUS})` : INTEREST === 'none' ? 'no interest (everyone sees everyone)'
        : `radius ${RADIUS}, ~${VISIBLE} visible`;
    const mode = modeBase + (BATCH ? ', one write per client per sample' : ', one write per message (--no-batch)');
    console.log(`net-capacity-benchmark: ${HZ} Hz, ${mode}, ${seconds}s per step, up to ${botProcs} bot processes, ${os.cpus()[0].model}`);
    console.log('players | rate     | tick p50/p99/max ms  | ELU  | out/client | out total   | seen | rss MB | bots ELU | verdict');
    const results = [];
    let failures = 0;
    for (const players of steps) {
        let r;
        try {
            r = await runStep(players, botProcs, seconds);
        } catch (err) {
            console.log(`${String(players).padStart(7)} | step failed: ${String(err.message).split('\n')[0]}`);
            break;
        }
        results.push(r);
        const verdict = r.botBound ? 'BOTS SATURATED' : r.holds ? 'holds' : 'OVER';
        console.log([
            String(r.players).padStart(7),
            `${r.rate.toFixed(1).padStart(5)}/${HZ}`,
            `${r.tickP50.toFixed(2)} / ${r.tickP99.toFixed(2)} / ${r.tickMax.toFixed(1)}`.padEnd(20),
            r.elu.toFixed(2),
            fmtBytes(r.bytesOutPerClient).padStart(10),
            fmtBytes(r.bytesOutTotal).padStart(11),
            r.ghosts.toFixed(0).padStart(4),
            r.rssMB.toFixed(0).padStart(6),
            r.botEluMax.toFixed(2).padStart(8),
            verdict + (r.failed ? ` (${r.failed} joins failed)` : ''),
        ].join(' | '));
        if (!r.holds && !r.botBound) { if (++failures >= 2) break; }
    }
    if (A.json) writeFileSync(path.resolve(A.json), JSON.stringify({ hz: HZ, radius: RADIUS, visible: VISIBLE, interest: INTEREST, crowd: CROWD, results }, null, 2));
}

if (ROLE === 'server') await runServer();
else if (ROLE === 'bots') await runBots();
else await runAll();
