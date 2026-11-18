// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  zones-benchmark.mjs — esengine/zones across real processes.
 *
 * Every zone is its own Node process with a replication server, a ZoneHost and
 * player records; bots in other processes walk through portals between them.
 * The zones share one store: a MemoryStore behind the SDK's StoreHub in the
 * coordinator, which each zone reaches through a RemoteStore — so a versioned
 * write is atomic across processes, as a database adapter's must be.
 *
 * A portal is a bot's input: `{ portal: zoneId, portalSeq }`. The zone the bot
 * is in counts the hop in the player's record (`hops + 1`) and transfers it.
 * Each bot counts the hops it completed — state back to `ready` after
 * `transferring`. At the end, every player's stored `hops` must equal what
 * its bot counted: a lost write, a write from a zone that no longer holds the
 * player, or a transfer counted twice all show as a mismatch.
 *
 * Whispers ride the zones' bus: every few seconds a bot sends one to another
 * bot through its own zone, which passes it to wherever the other player is
 * (`ZoneHost.sendToPlayer` over a `RemoteBus` to a `BusHub` the coordinator
 * serves). Reported: how many arrived and how long they took — delivery is at
 * most once, so the ones aimed at a player mid-transfer may not.
 *
 * Reported: transfers completed per second, transfer time (portal asked to
 * ready in the new zone) p50 / p95 / max, refused or failed transfers, and
 * the integrity check. `--drain` updates one zone halfway as a deployment
 * would: it drains (every player moved to another line), exits, and a new
 * process takes its id; reported are how long the drain took, how many it
 * moved and how many it had to kick (none, when there is somewhere to go). `--crash` kills one zone halfway: its bots log in to
 * another zone, which refuses them until their leases run out; the time that
 * takes and the hops lost since the last autosave are reported apart.
 *
 *   node tools/zones-benchmark.mjs
 *   node tools/zones-benchmark.mjs --zones 4 --players 200 --seconds 30 --interval 3
 *   node tools/zones-benchmark.mjs --crash
 *   node tools/zones-benchmark.mjs --drain     # a rolling update of one zone
 *
 * Reads the built SDK (sdk/dist). No wasm: the zones run the replication and
 * zone machinery, not a renderer or physics.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'sdk', 'dist');
const { WebSocketServer } = createRequire(path.join(ROOT, 'sdk', 'package.json'))('ws');

function args() {
    const out = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const key = argv[i].slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) out[key] = true;
        else { out[key] = next; i++; }
    }
    return out;
}
const A = args();
const ROLE = A.role ?? 'run';
const HZ = 20;
const STEP = 1 / HZ;
const LEASE_TTL = Number(A['lease-ttl'] ?? 5000);
const AUTOSAVE = Number(A.autosave ?? 2000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/** Between the coordinator's store hub and its zones. */
const STORE_SECRET = 'zones-benchmark';
const quantile = (xs, q) => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

async function loadSdk() {
    const sdk = await import(pathToFileURL(path.join(DIST, 'index.node.js')).href);
    const repl = await import(pathToFileURL(path.join(DIST, 'net', 'replication', 'index.js')).href);
    const persist = await import(pathToFileURL(path.join(DIST, 'persist', 'index.js')).href);
    const zones = await import(pathToFileURL(path.join(DIST, 'zones', 'index.js')).href);
    const metrics = await import(pathToFileURL(path.join(DIST, 'metrics', 'index.js')).href);
    return { sdk, repl, persist, zones, metrics };
}

/** Read a Prometheus text page into series, the zone it is for, and its sample-time buckets. */
function parseMetrics(text) {
    const series = new Map();
    const buckets = [];
    let zone = '';
    for (const line of text.split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const m = /^(\S+?)(\{.*\})? (\S+)$/.exec(line);
        if (!m) continue;
        const [, name, labels = '', value] = m;
        const v = value === '+Inf' ? Infinity : Number(value);
        zone ||= /zone="([^"]*)"/.exec(labels)?.[1] ?? '';
        if (name === 'estella_replication_sample_ms_bucket') {
            const le = /le="([^"]*)"/.exec(labels)?.[1];
            buckets.push([le === '+Inf' ? Infinity : Number(le), v]);
            continue;
        }
        series.set(name + labels.replace(/,?le="[^"]*"/, ''), v);
    }
    series.zone = zone;
    series.buckets = buckets;
    return series;
}

// ---------------------------------------------------------------------------
// A zone
// ---------------------------------------------------------------------------

async function runZone() {
    const { sdk, repl, persist, zones, metrics } = await loadSdk();
    const id = A.id;
    // The SDK's own store client, to the hub the coordinator serves.
    const store = new persist.RemoteStore({ connect: () => new sdk.GameSocket({ url: A.store }), secret: STORE_SECRET });
    const Pos = sdk.defineComponent('BenchPos', { x: 0, z: 0 }, { replicatedFields: ['x', 'z'] });

    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
    await new Promise((r) => wss.once('listening', r));
    const address = `ws://127.0.0.1:${wss.address().port}`;

    const errors = { load: 0, save: 0, transfer: 0, release: 0, renew: 0, heartbeat: 0 };
    const records = new persist.PlayerPersistence({
        store, schema: 1, autosaveMs: AUTOSAVE,
        create: () => ({ hops: 0, lastPortalSeq: 0 }),
        onError: (_pid, _err, during) => { errors[during]++; },
    });
    const bus = new zones.RemoteBus({ connect: () => new sdk.GameSocket({ url: A.bus }) });
    let zoneServer = null;
    const zone = new zones.ZoneHost({
        bus,
        zone: { id, address, kind: 'map' }, store, players: records, leaseTtlMs: LEASE_TTL, directoryTtlMs: 6000,
        authenticate: (c) => ({ playerId: c.token }),
        // A player a drain moves is told so first (the same link carries the
        // transfer after it), so the bot does not count the move as its portal.
        route: async (ctx) => {
            if (ctx.reason === 'drain') {
                const cid = zoneServer?.connectionIdOf(ctx.playerId);
                if (cid !== undefined) zoneServer.message(cid, 'moved-by-server');
            }
            return ctx.defaultRoute();
        },
        onError: (_err, during) => { errors[during]++; },
    });
    const app = sdk.App.new();
    app.setFixedTimestep(STEP);
    app.addPlugin(repl.replicationPlugin);
    // Why hellos were turned away or sent elsewhere, by name: a healthy run has
    // only redirects for logins, and none for transfers.
    const refusals = {};
    const authenticate = async (c, hello) => {
        try {
            return await zone.authenticate(c, hello);
        } catch (err) {
            const key = `${hello.transfer !== undefined ? 'transfer' : 'login'}:${err.name}:${String(err.message).slice(0, 40)}`;
            refusals[key] = (refusals[key] ?? 0) + 1;
            throw err;
        }
    };
    const server = app.getResource(repl.Net).startServer({ authenticate, reconnectGraceMs: 1000 });
    zoneServer = server;
    zone.attach(server);
    await zone.start();
    // A whisper from a player here goes to wherever the other player is.
    let whispersRouted = 0;
    server.onMessage('whisper', (cid, d) => {
        const from = server.playerIdOf(cid);
        if (!from || typeof d?.to !== 'string') return;
        whispersRouted++;
        void zone.sendToPlayer(d.to, 'whisper', { from, seq: d.seq, sentAt: d.sentAt });
    });
    wss.on('connection', (socket) => {
        const link = server.attachConnection(repl.webSocketTransport(socket));
        socket.on('close', () => server.detachConnection(link));
        socket.on('error', () => server.detachConnection(link));
    });
    // Which zone a client sees, by name.
    const mark = app.world.spawn(`zone ${id}`);
    app.world.insert(mark, repl.Replicated, {});

    const pawns = new Map();
    const transferring = new Set();
    let transfersOut = 0;
    const loop = async () => {
        zone.tick();
        const present = new Map();
        for (const cid of server.presentIds) present.set(server.playerIdOf(cid), cid);
        for (const [pid, pawn] of [...pawns]) {
            if (present.has(pid)) continue;
            app.world.despawn(pawn);
            pawns.delete(pid);
        }
        for (const [pid, cid] of present) {
            if (!records.isReady(pid)) continue;
            if (!pawns.has(pid)) {
                const arrival = zone.takeArrival(pid);
                const pawn = app.world.spawn(`pawn ${pid}`);
                app.world.insert(pawn, Pos, { x: arrival?.x ?? 0, z: 0 });
                app.world.insert(pawn, repl.Replicated, { owner: cid });
                pawns.set(pid, pawn);
            }
            // A portal: once per portalSeq, counted in the record the transfer saves.
            const actions = server.tickInputOf(cid)?.actions;
            const rec = records.get(pid);
            // Portals close while the zone drains: every move out of it is the drain's.
            if (!actions || typeof actions.portal !== 'string' || transferring.has(pid) || zone.draining) continue;
            if (actions.portalSeq <= rec.lastPortalSeq || actions.portal === id) continue;
            transferring.add(pid);
            records.set(pid, { hops: rec.hops + 1, lastPortalSeq: actions.portalSeq });
            zone.transfer(cid, actions.portal, { x: actions.portalSeq })
                .then(() => { transfersOut++; })
                .catch(() => {
                    errors.transfer++;
                    // Not sent: the hop did not happen. The record may already be
                    // saved with it, so put the count back for the next save.
                    if (records.isReady(pid)) {
                        const now = records.get(pid);
                        records.set(pid, { hops: now.hops - 1, lastPortalSeq: actions.portalSeq });
                    }
                })
                .finally(() => transferring.delete(pid));
        }
        await app.tick(STEP);
    };
    const timer = setInterval(() => { void loop(); }, 1000 / HZ);
    const report_ = setInterval(() => {
        console.log('STAT ' + JSON.stringify({ id, present: server.presentIds.length, transfersOut, errors, refusals }));
    }, 1000);
    // What a deployment would scrape: the SDK's collectors on a /metrics endpoint.
    const registry = new metrics.MetricsRegistry({ labels: { zone: id } });
    registry.register(metrics.replicationMetrics(server));
    registry.register(metrics.zoneMetrics(zone));
    registry.register(metrics.playerPersistenceMetrics(records));
    registry.register(metrics.processMetrics());
    const http = await import('node:http');
    const metricsServer = http.createServer(metrics.metricsHandler(registry));
    await new Promise((r) => metricsServer.listen(0, '127.0.0.1', r));
    console.log(`METRICS http://127.0.0.1:${metricsServer.address().port}/metrics`);
    console.log(`LISTEN ${address}`);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (cmd) => {
        if (cmd.includes('drain')) {
            // The ticks go on: drain moves players through ordinary transfers.
            const t0 = performance.now();
            const report = await zone.drain({ deadlineMs: 15000 });
            clearInterval(timer);
            clearInterval(report_);
            console.log('STAT ' + JSON.stringify({ id, present: server.presentIds.length, transfersOut, errors, refusals }));
            console.log('DRAINED ' + JSON.stringify({ ...report, ms: performance.now() - t0 }));
            setTimeout(() => process.exit(0), 100);
            return;
        }
        if (!cmd.includes('stop')) return;
        clearInterval(timer);
        clearInterval(report_);
        await zone.stop();
        console.log('STAT ' + JSON.stringify({ id, present: server.presentIds.length, transfersOut, errors }));
        console.log('STOPPED');
        process.exit(0);
    });
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

async function runBots() {
    const { sdk, repl } = await loadSdk();
    sdk.defineComponent('BenchPos', { x: 0, z: 0 }, { replicatedFields: ['x', 'z'] });
    const zoneList = JSON.parse(A.zones); // [{ id, address }]
    const first = Number(A.first);
    const count = Number(A.count);
    const interval = Number(A.interval ?? 3) * 1000;
    const whisperEvery = Number(A.whisper ?? 2) * 1000;
    const totalPlayers = Number(A.total);
    const bots = [];
    let quiet = false;

    /** The zone a client sees, and the entity its landmark is: a client that left and came back holds a new one. */
    const landmarkOf = (app) => {
        for (const e of app.world.getEntitiesWithComponents([repl.Replicated])) {
            const n = app.world.tryGet(e, sdk.Name)?.value ?? '';
            if (n.startsWith('zone ')) return { zone: n.slice(5), entity: e };
        }
        return null;
    };
    const zoneOf = (app) => landmarkOf(app)?.zone ?? null;

    // Each bot's entries: the other zones, where it logs in again (each in turn)
    // if its own dies, and is routed from there — the framework's recovery, not
    // the bot's. A deployment would give one load-balanced address instead.
    const entryFor = (zone) => {
        const i = zoneList.indexOf(zone);
        return [...zoneList.slice(i + 1), ...zoneList.slice(0, i)].map((z) => z.address);
    };

    async function login(bot, zone) {
        const app = sdk.App.new();
        app.setFixedTimestep(STEP);
        app.addPlugin(repl.replicationPlugin);
        const socket = new sdk.GameSocket({ url: zone.address });
        socket.connect();
        const client = await app.getResource(repl.Net).connect(socket, {
            interpolationDelayTicks: 0, credentials: { token: bot.token },
            reconnect: { minDelayMs: 200, maxDelayMs: 1000 },
            entry: entryFor(zone), entryAfterMs: 1500,
            dial: (url) => new sdk.GameSocket({ url }),
        });
        bot.app = app;
        bot.client = client;
        bot.socket = socket;
        // What the client went through, heard as it happens: a transfer or a
        // reroute can pass through several states between two loop turns, and
        // a turn can be late by seconds on a busy machine.
        bot.server = client.serverId; // a login is not a hop: counting starts here
        bot.phase = new Set();
        client.onMessage('whisper', (d) => { bot.heard.push(Date.now() - d.sentAt); });
        client.onMessage('moved-by-server', () => { bot.serverMoving = true; });
        client.onStateChange((state) => {
            const now = performance.now();
            if (state !== 'ready') {
                if (state === 'reconnecting' && !bot.phase.has('reconnecting')) bot.lostAt = now;
                bot.phase.add(state);
                return;
            }
            const moved = client.serverId !== bot.server;
            const t = (now / 1000).toFixed(2);
            if (moved && bot.phase.has('reconnecting')) {
                // Its link was lost (a transfer's never is) and the client found
                // its own way to another server: its zone died, an entry routed it.
                bot.rerouted.push(now - bot.lostAt);
                bot.events.push(`${t}s rerouted`);
                bot.askedAt = 0;
            } else if (moved && (bot.serverMoving || !bot.askedAt)) {
                bot.askedAt = 0;
                // Moved by the server (a zone draining), not through a portal.
                bot.serverMoves++;
                bot.events.push(`${t}s moved by the server`);
            } else if (moved) {
                bot.hops++;
                bot.events.push(`${t}s hop${bot.askedAt ? ` asked ${bot.portal}` : ' UNASKED'}`);
                if (bot.askedAt) bot.latencies.push(now - bot.askedAt);
                bot.askedAt = 0;
            } else if (bot.phase.has('transferring')) {
                // Sent to a zone that could not be reached, and back where it was.
                bot.bounces++;
                bot.bounceTimes.push(now - (bot.askedAt || now));
                bot.events.push(`${t}s bounce`);
                bot.askedAt = 0;
            }
            bot.server = client.serverId;
            bot.serverMoving = false;
            bot.phase.clear();
        });
    }

    for (let i = 0; i < count; i++) {
        const bot = { serverMoves: 0, heard: [], whispersSent: 0, whisperSeq: 0, nextWhisper: performance.now() + Math.random() * whisperEvery, events: [], rerouted: [], token: `bot${first + i}`, hops: 0, bounces: 0, bounceTimes: [], relogins: 0, seq: 0, nextPortal: 0, askedAt: 0, latencies: [], refused: 0, reconnectingSince: 0, recovered: [] };
        const zone = zoneList[(first + i) % zoneList.length];
        for (;;) {
            try { await login(bot, zone); break; } catch { bot.refused++; await delay(300); }
        }
        bot.nextPortal = performance.now() + Math.random() * interval;
        bots.push(bot);
    }
    console.log(`READY ${bots.length}`);

    const loop = async () => {
        const now = performance.now();
        for (const bot of bots) {
            const c = bot.client;
            if (!c) continue;
            // A zone that does not come back, or a transfer into one that died:
            // log in somewhere else, as a game would.
            if (c.state === 'reconnecting' || c.state === 'closed') {
                bot.reconnectingSince ||= now;
                // While a transfer is under way the client finds its own way back;
                // only a plain drop that does not heal is the bot's to handle.
                const patience = 15000;
                if ((c.state === 'closed' || now - bot.reconnectingSince > patience) && !bot.relogging) {
                    bot.relogging = true;
                    bot.askedAt = 0;
                    const lostAt = bot.reconnectingSince;
                    c.disconnect();
                    bot.socket.close();
                    bot.client = null;
                    void (async () => {
                        for (;;) {
                            const zone = zoneList[Math.floor(Math.random() * zoneList.length)];
                            try { await login(bot, zone); break; } catch { bot.refused++; await delay(300); }
                        }
                        bot.recovered.push(performance.now() - lostAt);
                        bot.relogins++;
                        bot.relogging = false;
                        bot.reconnectingSince = 0;
                    })();
                    continue;
                }
            } else bot.reconnectingSince = 0;

            if (c.state === 'ready' && !quiet && now >= bot.nextPortal && !bot.askedAt) {
                const here = zoneOf(bot.app);
                const others = zoneList.filter((z) => z.id !== here);
                if (here && others.length > 0) {
                    bot.seq++;
                    bot.portal = others[Math.floor(Math.random() * others.length)].id;
                    bot.askedAt = now;
                    bot.nextPortal = now + interval * (0.5 + Math.random());
                }
            }
            if (c.state === 'ready') c.sendInput({ portal: bot.askedAt ? bot.portal : null, portalSeq: bot.seq });
            // A whisper to another bot, wherever it is.
            if (c.state === 'ready' && !quiet && now >= bot.nextWhisper) {
                bot.nextWhisper = now + whisperEvery * (0.5 + Math.random());
                const to = `bot${Math.floor(Math.random() * totalPlayers)}`;
                if (to !== bot.token && c.message('whisper', { to, seq: ++bot.whisperSeq, sentAt: Date.now() })) bot.whispersSent++;
            }
            await bot.app.tick(STEP);
        }
        // A portal asked for and never answered (the transfer was refused): ask again later.
        for (const bot of bots) if (bot.askedAt && bot.client?.state === 'ready' && now - bot.askedAt > 5000) bot.askedAt = 0;
    };
    const timer = setInterval(() => { void loop(); }, 1000 / HZ);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (cmd) => {
        if (cmd.includes('quiet')) { quiet = true; return; }
        if (!cmd.includes('stop')) return;
        clearInterval(timer);
        for (const bot of bots) { bot.client?.disconnect(); bot.socket?.close(); }
        console.log('FINAL ' + JSON.stringify(bots.map((b) => ({
            token: b.token, hops: b.hops, bounces: b.bounces, bounceTimes: b.bounceTimes, latencies: b.latencies,
            refused: b.refused, recovered: b.recovered, relogins: b.relogins, rerouted: b.rerouted, events: b.events,
            whispersSent: b.whispersSent, heard: b.heard, serverMoves: b.serverMoves,
        }))));
        await delay(100);
        process.exit(0);
    });
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

function child(role, extra) {
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', role,
        '--lease-ttl', String(LEASE_TTL), '--autosave', String(AUTOSAVE), ...(A.verbose ? ['--verbose'] : []), ...extra], {
        cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.log = '';
    proc.stats = [];
    let buf = '';
    proc.stdout.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line.startsWith('STAT ')) proc.stats.push(JSON.parse(line.slice(5)));
            else if (line.startsWith('FINAL ')) proc.final = JSON.parse(line.slice(6));
            else if (line.startsWith('DRAINED ')) proc.drained = JSON.parse(line.slice(8));
            else proc.log += line + '\n';
        }
    });
    proc.stderr.on('data', (d) => { proc.log += d.toString(); });
    return proc;
}

/** A process killed by a signal has a null exitCode and a signalCode instead. */
const alive = (proc) => proc.exitCode === null && proc.signalCode === null;

async function waitFor(proc, test, ms, what) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const m = test();
        if (m) return m;
        if (!alive(proc)) break;
        await delay(50);
    }
    throw new Error(`timed out waiting for ${what}\n${proc.log.slice(-1500)}`);
}

async function runAll() {
    const { persist } = await loadSdk();
    const ZONES = Number(A.zones ?? 3);
    const PLAYERS = Number(A.players ?? 60);
    const SECONDS = Number(A.seconds ?? 20);
    const INTERVAL = Number(A.interval ?? 3);
    const BOT_PROCS = Math.max(1, Math.min(Number(A.bots ?? 4), PLAYERS));
    const CRASH = A.crash === true;
    const DRAIN = A.drain === true;

    const store = new persist.MemoryStore();
    // One store for every zone, behind the SDK's StoreHub: every versioned
    // write and transaction runs here, so they are atomic across processes.
    const storeHub = new persist.StoreHub(store, { secret: STORE_SECRET });
    const storeServer = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
    await new Promise((r) => storeServer.once('listening', r));
    storeServer.on('connection', (socket) => storeHub.accept(socket));
    const served = { wss: storeServer, url: `ws://127.0.0.1:${storeServer.address().port}` };
    const { BusHub } = await import(pathToFileURL(path.join(DIST, 'zones', 'index.js')).href);
    const hub = new BusHub();
    const busServer = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
    await new Promise((r) => busServer.once('listening', r));
    busServer.on('connection', (socket) => hub.accept(socket));
    const busUrl = `ws://127.0.0.1:${busServer.address().port}`;
    console.log(`zones-benchmark: ${ZONES} zones, ${PLAYERS} players in ${BOT_PROCS} bot processes, a portal every ~${INTERVAL}s each,`
        + ` ${SECONDS}s, lease ttl ${LEASE_TTL} ms, autosave ${AUTOSAVE} ms${CRASH ? ', one zone crashes halfway' : ''}`);

    const zoneProcs = [];
    for (let i = 0; i < ZONES; i++) zoneProcs.push(child('zone', ['--id', `z${i}`, '--store', served.url, '--bus', busUrl]));
    const zoneList = [];
    for (let i = 0; i < ZONES; i++) {
        const m = await waitFor(zoneProcs[i], () => zoneProcs[i].log.match(/LISTEN (\S+)/), 30000, `zone z${i}`);
        zoneList.push({ id: `z${i}`, address: m[1] });
    }

    const botProcs = [];
    const per = Math.ceil(PLAYERS / BOT_PROCS);
    for (let i = 0; i < BOT_PROCS; i++) {
        const n = Math.min(per, PLAYERS - i * per);
        if (n <= 0) break;
        botProcs.push(child('bots', ['--zones', JSON.stringify(zoneList), '--first', String(i * per), '--count', String(n), '--interval', String(INTERVAL), '--total', String(PLAYERS)]));
    }
    for (const b of botProcs) await waitFor(b, () => b.log.includes('READY'), 120000, 'bots');

    const started = performance.now();
    let crashedAt = 0;
    const retired = [];
    let drained = null;
    if (CRASH) {
        await delay((SECONDS * 1000) / 2);
        zoneProcs[0].kill('SIGKILL');
        crashedAt = performance.now();
        await delay((SECONDS * 1000) / 2);
    } else if (DRAIN) {
        await delay((SECONDS * 1000) / 2);
        const half = performance.now();
        const old = zoneProcs[0];
        old.stdin.write('drain\n');
        drained = await waitFor(old, () => old.drained, 30000, 'drain');
        // The new version takes the zone's id; the old process's numbers stay counted.
        retired.push(old);
        zoneProcs[0] = child('zone', ['--id', 'z0', '--store', served.url, '--bus', busUrl]);
        await waitFor(zoneProcs[0], () => zoneProcs[0].log.match(/LISTEN (\S+)/), 30000, 'new z0');
        drained.restartedAfterMs = performance.now() - half;
        await delay(Math.max(0, SECONDS * 1000 - (performance.now() - started)));
    } else {
        await delay(SECONDS * 1000);
    }
    const elapsed = (performance.now() - started) / 1000;

    // Let transfers in flight land, then everyone leaves and every zone saves.
    // Scrape every live zone's /metrics as Prometheus would, before the run winds down.
    const scraped = [];
    for (const z of zoneProcs.filter(alive)) {
        const url = z.log.match(/METRICS (\S+)/)?.[1];
        if (!url) continue;
        try {
            const text = await (await fetch(url)).text();
            scraped.push(parseMetrics(text));
        } catch { /* a zone that would not answer is reported by its absence */ }
    }
    for (const b of botProcs) b.stdin.write('quiet\n');
    await delay(3000);
    for (const b of botProcs) b.stdin.write('stop\n');
    for (const b of botProcs) await waitFor(b, () => b.final, 15000, 'bot report');
    await delay(2500); // grace 1 s, then each departure is saved
    const live = zoneProcs.filter(alive);
    for (const z of live) z.stdin.write('stop\n');
    for (const z of live) await waitFor(z, () => z.log.includes('STOPPED'), 15000, 'zone stop');

    // What the bots counted against what the store holds.
    const bots = botProcs.flatMap((b) => b.final);
    // A player the crash touched (it had to log in again) is told apart: what
    // its zone had not saved yet is lost (stored < counted), and a transfer
    // into the zone as it died is saved but never arrived (stored > counted).
    // Neither is a fault of the transfer protocol; everyone else must match.
    const crashedPlayers = new Set();
    let mismatches = 0;
    let unsavedLost = 0;
    let sentIntoDeadZone = 0;
    const examples = [];
    for (const bot of bots) {
        const doc = await store.get(`player:${bot.token}`);
        const stored = doc?.value?.data?.hops ?? 0;
        if (CRASH && (bot.relogins > 0 || bot.rerouted.length > 0)) {
            crashedPlayers.add(bot.token);
            if (stored < bot.hops) unsavedLost += bot.hops - stored;
            else sentIntoDeadZone += stored - bot.hops;
            continue;
        }
        // A bounce was counted where it left (the record is written before the
        // client is told), and the client came back: one hop stored, none made.
        if (stored === bot.hops + bot.bounces) continue;
        mismatches++;
        if (examples.length < 5) {
            examples.push(`${bot.token}: stored ${stored}, bot counted ${bot.hops} hops + ${bot.bounces} bounces`
                + ` (rerouted ${bot.rerouted.length}, bot re-logins ${bot.relogins})`
                + (A.verbose ? '\n      ' + bot.events.join('\n      ') : ''));
        }
    }
    const latencies = bots.flatMap((b) => b.latencies);
    const hops = bots.reduce((n, b) => n + b.hops, 0);
    const zoneErrors = {};
    const refusals = {};
    for (const z of [...zoneProcs, ...retired]) {
        const last = z.stats[z.stats.length - 1];
        for (const [k, v] of Object.entries(last?.errors ?? {})) zoneErrors[k] = (zoneErrors[k] ?? 0) + v;
        for (const [k, v] of Object.entries(last?.refusals ?? {})) refusals[k] = (refusals[k] ?? 0) + v;
    }
    const recovered = bots.flatMap((b) => b.recovered);
    const rerouted = bots.flatMap((b) => b.rerouted);
    const bounceTimes = bots.flatMap((b) => b.bounceTimes);
    // Leases still live after every zone stopped; a crashed zone's run out on their own.
    let leftoverLeases = 0;
    for (const key of await store.keys('lease:')) {
        const lease = (await store.get(key))?.value;
        if (lease && lease.until > Date.now() && lease.zoneId !== 'z0') leftoverLeases++;
        else if (lease && lease.until > Date.now() && !CRASH) leftoverLeases++;
    }

    console.log(`transfers: ${hops} in ${elapsed.toFixed(1)} s = ${(hops / elapsed).toFixed(1)}/s`);
    const sent = bots.reduce((n, b) => n + b.whispersSent, 0);
    const heard = bots.flatMap((b) => b.heard);
    console.log(`whispers across zones: ${heard.length} of ${sent} arrived (${sent ? ((100 * heard.length) / sent).toFixed(1) : '0'}%), `
        + `p50 ${quantile(heard, 0.5).toFixed(0)} ms, p95 ${quantile(heard, 0.95).toFixed(0)} ms, max ${Math.max(0, ...heard).toFixed(0)} ms`);
    console.log(`transfer time: p50 ${quantile(latencies, 0.5).toFixed(0)} ms, p95 ${quantile(latencies, 0.95).toFixed(0)} ms, max ${Math.max(0, ...latencies).toFixed(0)} ms`);
    console.log(`zone-side failures: ${JSON.stringify(zoneErrors)}; logins refused while held elsewhere: ${bots.reduce((n, b) => n + b.refused, 0)}`);
    console.log(`leases still held by a stopped zone: ${leftoverLeases}`);
    if (scraped.length > 0) {
        console.log('per zone, from its /metrics:');
        console.log('  zone | present | sample p50/p99 ms | state KB/s | transfers sent/failed | messages delivered/forwarded/held/dropped | ELU  | rss MB');
        for (const m of scraped) {
            const g = (name, labels = '') => m.get(`estella_${name}{zone="${m.zone}"${labels}}`) ?? 0;
            const count = g('replication_sample_ms_count');
            const q = (p) => {
                const want = p * count;
                for (const [le, v] of m.buckets) if (v >= want) return le;
                return Infinity;
            };
            console.log(`  ${m.zone.padEnd(4)} | ${String(g('replication_players_present')).padStart(7)} | ${`${q(0.5)} / ${q(0.99)}`.padStart(17)} | `
                + `${(g('replication_state_bytes_total') / 1024 / elapsed).toFixed(0).padStart(10)} | `
                + `${`${g('zone_transfers_total', ',outcome="sent"')} / ${g('zone_transfers_total', ',outcome="failed"')}`.padStart(21)} | `
                + `${['delivered', 'forwarded', 'held', 'dropped'].map((o) => g('zone_player_messages_total', `,outcome="${o}"`)).join(' / ').padStart(42)} | `
                + `${g('process_event_loop_utilization').toFixed(2)} | ${(g('process_resident_memory_bytes') / 1048576).toFixed(0).padStart(6)}`);
        }
    }
    if (DRAIN && drained) {
        const relogged = bots.reduce((n, b) => n + b.relogins, 0);
        const rerouted = bots.reduce((n, b) => n + b.rerouted.length, 0);
        console.log(`drain: ${drained.moved} players moved to other lines in ${drained.ms.toFixed(0)} ms, ${drained.kicked} kicked; `
            + `new z0 up ${drained.restartedAfterMs.toFixed(0)} ms after the drain began; clients that saw a server move ${bots.reduce((n, b) => n + b.serverMoves, 0)}, `
            + `had to log in again ${relogged}, rerouted by an entry ${rerouted}`);
    }
    if (Object.keys(refusals).length > 0) console.log(`hellos turned away or redirected: ${JSON.stringify(refusals)}`);
    if (CRASH) {
        console.log(`crash: ${crashedPlayers.size} players touched, ${bots.reduce((n, b) => n + b.relogins, 0)} needed the bot to log in again; ${unsavedLost} hops lost unsaved, `
            + `${sentIntoDeadZone} transfers saved into the zone as it died; back in another zone after `
            + `p50 ${quantile(recovered, 0.5).toFixed(0)} ms, max ${Math.max(0, ...recovered).toFixed(0)} ms (lease ttl ${LEASE_TTL} ms)`);
        console.log(`in the dead zone and rerouted by themselves (entry): ${rerouted.length}, `
            + `in another zone after p50 ${quantile(rerouted, 0.5).toFixed(0)} ms, p95 ${quantile(rerouted, 0.95).toFixed(0)} ms, max ${Math.max(0, ...rerouted).toFixed(0)} ms`);
        console.log(`sent to the dead zone and back by themselves: ${bounceTimes.length}, `
            + `back after p50 ${quantile(bounceTimes, 0.5).toFixed(0)} ms, p95 ${quantile(bounceTimes, 0.95).toFixed(0)} ms, max ${Math.max(0, ...bounceTimes).toFixed(0)} ms`);
        if (A.verbose) console.log(`  bounce times: ${bounceTimes.map((t) => t.toFixed(0)).sort((x, y) => x - y).join(' ')}`);
        if (A.verbose) console.log(`  recoveries: ${recovered.map((t) => t.toFixed(0)).sort((x, y) => x - y).join(' ')}`);
    }
    console.log(`integrity: ${mismatches === 0 ? 'every record matches its bot' : `${mismatches} MISMATCHED`}`
        + (examples.length ? `\n  ${examples.join('\n  ')}` : ''));

    served.wss.close();
    busServer.close();
    for (const p of [...zoneProcs, ...botProcs]) if (alive(p)) p.kill();
    process.exit(mismatches === 0 ? 0 : 1);
}

if (ROLE === 'zone') await runZone();
else if (ROLE === 'bots') await runBots();
else await runAll();
