// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  zones-benchmark.mjs — esengine/zones across real processes.
 *
 * Every zone is its own Node process with a replication server, a ZoneHost and
 * player records; bots in other processes walk through portals between them.
 * The zones share one store, served here over a WebSocket from the coordinator
 * (a MemoryStore behind an RPC, so a versioned write is atomic across
 * processes the way a database adapter's must be — a FileStore is not).
 *
 * A portal is a bot's input: `{ portal: zoneId, portalSeq }`. The zone the bot
 * is in counts the hop in the player's record (`hops + 1`) and transfers it.
 * Each bot counts the hops it completed — state back to `ready` after
 * `transferring`. At the end, every player's stored `hops` must equal what
 * its bot counted: a lost write, a write from a zone that no longer holds the
 * player, or a transfer counted twice all show as a mismatch.
 *
 * Reported: transfers completed per second, transfer time (portal asked to
 * ready in the new zone) p50 / p95 / max, refused or failed transfers, and
 * the integrity check. `--crash` kills one zone halfway: its bots log in to
 * another zone, which refuses them until their leases run out; the time that
 * takes and the hops lost since the last autosave are reported apart.
 *
 *   node tools/zones-benchmark.mjs
 *   node tools/zones-benchmark.mjs --zones 4 --players 200 --seconds 30 --interval 3
 *   node tools/zones-benchmark.mjs --crash
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
const { WebSocketServer, WebSocket } = createRequire(path.join(ROOT, 'sdk', 'package.json'))('ws');

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
    return { sdk, repl, persist, zones };
}

// ---------------------------------------------------------------------------
// The shared store, over a socket
// ---------------------------------------------------------------------------

/** Serve a PersistStore: one JSON request per message, answered in order. */
function serveStore(store) {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
    wss.on('connection', (socket) => {
        socket.on('message', async (raw) => {
            const req = JSON.parse(String(raw));
            try {
                let result;
                if (req.op === 'get') result = await store.get(req.key);
                else if (req.op === 'put') result = await store.put(req.key, req.value, req.options);
                else if (req.op === 'delete') result = await store.delete(req.key, req.options);
                else if (req.op === 'keys') result = await store.keys(req.prefix);
                socket.send(JSON.stringify({ id: req.id, ok: true, result }));
            } catch (err) {
                socket.send(JSON.stringify({
                    id: req.id, ok: false,
                    error: { name: err.name, message: err.message, key: err.key, expected: err.expected, actual: err.actual },
                }));
            }
        });
    });
    return new Promise((resolve) => wss.on('listening', () => resolve({ wss, url: `ws://127.0.0.1:${wss.address().port}` })));
}

/** The client half: a PersistStore whose every call is a round trip to `serveStore`. */
async function remoteStore(url, persist) {
    const socket = new WebSocket(url, { perMessageDeflate: false });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const pending = new Map();
    let seq = 0;
    socket.on('message', (raw) => {
        const res = JSON.parse(String(raw));
        const p = pending.get(res.id);
        pending.delete(res.id);
        if (!p) return;
        if (res.ok) p.resolve(res.result);
        else if (res.error.name === 'PersistConflict') p.reject(new persist.PersistConflict(res.error.key, res.error.expected, res.error.actual));
        else p.reject(Object.assign(new Error(res.error.message), { name: res.error.name }));
    });
    const call = (req) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ ...req, id }));
    });
    return {
        get: (key) => call({ op: 'get', key }),
        put: (key, value, options) => call({ op: 'put', key, value, options }),
        delete: (key, options) => call({ op: 'delete', key, options }),
        keys: (prefix) => call({ op: 'keys', prefix }),
    };
}

// ---------------------------------------------------------------------------
// A zone
// ---------------------------------------------------------------------------

async function runZone() {
    const { sdk, repl, persist, zones } = await loadSdk();
    const id = A.id;
    const store = await remoteStore(A.store, persist);
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
    const zone = new zones.ZoneHost({
        zone: { id, address, kind: 'map' }, store, players: records, leaseTtlMs: LEASE_TTL, directoryTtlMs: 6000,
        authenticate: (c) => ({ playerId: c.token }),
        onError: (_err, during) => { errors[during]++; },
    });
    const app = sdk.App.new();
    app.setFixedTimestep(STEP);
    app.addPlugin(repl.replicationPlugin);
    const server = app.getResource(repl.Net).startServer({ authenticate: zone.authenticate, reconnectGraceMs: 1000 });
    zone.attach(server);
    await zone.start();
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
            if (!actions || typeof actions.portal !== 'string' || transferring.has(pid)) continue;
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
    const report = setInterval(() => {
        console.log('STAT ' + JSON.stringify({ id, present: server.presentIds.length, transfersOut, errors }));
    }, 1000);
    console.log(`LISTEN ${address}`);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (cmd) => {
        if (!cmd.includes('stop')) return;
        clearInterval(timer);
        clearInterval(report);
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
    const bots = [];
    let quiet = false;

    const zoneOf = (app) => {
        for (const e of app.world.getEntitiesWithComponents([repl.Replicated])) {
            const n = app.world.tryGet(e, sdk.Name)?.value ?? '';
            if (n.startsWith('zone ')) return n.slice(5);
        }
        return null;
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
            dial: (url) => new sdk.GameSocket({ url }),
        });
        bot.app = app;
        bot.client = client;
        bot.socket = socket;
        // A login is not a hop: the first zone seen after it is where the count starts.
        bot.zone = null;
    }

    for (let i = 0; i < count; i++) {
        const bot = { token: `bot${first + i}`, hops: 0, relogins: 0, seq: 0, nextPortal: 0, askedAt: 0, latencies: [], refused: 0, reconnectingSince: 0, recovered: [] };
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
            // A completed hop: the world it sees is another zone's. A transfer can
            // run start to end between two of these checks, so the states it
            // passes through are not what is watched.
            const seen = c.state === 'ready' ? zoneOf(bot.app) : null;
            if (seen) {
                if (bot.zone && seen !== bot.zone) {
                    bot.hops++;
                    if (bot.askedAt) bot.latencies.push(now - bot.askedAt);
                    bot.askedAt = 0;
                }
                bot.zone = seen;
            }
            // A zone that does not come back, or a transfer into one that died:
            // log in somewhere else, as a game would.
            if (c.state === 'reconnecting' || c.state === 'closed') {
                bot.reconnectingSince ||= now;
                if ((c.state === 'closed' || now - bot.reconnectingSince > 2000) && !bot.relogging) {
                    bot.relogging = true;
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
            await bot.app.tick(STEP);
        }
        // A portal asked for and never answered (the transfer was refused): ask again later.
        for (const bot of bots) if (bot.askedAt && now - bot.askedAt > 5000) bot.askedAt = 0;
    };
    const timer = setInterval(() => { void loop(); }, 1000 / HZ);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (cmd) => {
        if (cmd.includes('quiet')) { quiet = true; return; }
        if (!cmd.includes('stop')) return;
        clearInterval(timer);
        for (const bot of bots) { bot.client?.disconnect(); bot.socket?.close(); }
        console.log('FINAL ' + JSON.stringify(bots.map((b) => ({
            token: b.token, hops: b.hops, latencies: b.latencies, refused: b.refused, recovered: b.recovered, relogins: b.relogins,
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
        '--lease-ttl', String(LEASE_TTL), '--autosave', String(AUTOSAVE), ...extra], {
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

    const store = new persist.MemoryStore();
    const served = await serveStore(store);
    console.log(`zones-benchmark: ${ZONES} zones, ${PLAYERS} players in ${BOT_PROCS} bot processes, a portal every ~${INTERVAL}s each,`
        + ` ${SECONDS}s, lease ttl ${LEASE_TTL} ms, autosave ${AUTOSAVE} ms${CRASH ? ', one zone crashes halfway' : ''}`);

    const zoneProcs = [];
    for (let i = 0; i < ZONES; i++) zoneProcs.push(child('zone', ['--id', `z${i}`, '--store', served.url]));
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
        botProcs.push(child('bots', ['--zones', JSON.stringify(zoneList), '--first', String(i * per), '--count', String(n), '--interval', String(INTERVAL)]));
    }
    for (const b of botProcs) await waitFor(b, () => b.log.includes('READY'), 120000, 'bots');

    const started = performance.now();
    let crashedAt = 0;
    if (CRASH) {
        await delay((SECONDS * 1000) / 2);
        zoneProcs[0].kill('SIGKILL');
        crashedAt = performance.now();
        await delay((SECONDS * 1000) / 2);
    } else {
        await delay(SECONDS * 1000);
    }
    const elapsed = (performance.now() - started) / 1000;

    // Let transfers in flight land, then everyone leaves and every zone saves.
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
        if (CRASH && bot.relogins > 0) {
            crashedPlayers.add(bot.token);
            if (stored < bot.hops) unsavedLost += bot.hops - stored;
            else sentIntoDeadZone += stored - bot.hops;
            continue;
        }
        if (stored === bot.hops) continue;
        mismatches++;
        if (examples.length < 5) examples.push(`${bot.token}: stored ${stored}, bot counted ${bot.hops}`);
    }
    const latencies = bots.flatMap((b) => b.latencies);
    const hops = bots.reduce((n, b) => n + b.hops, 0);
    const zoneErrors = {};
    for (const z of zoneProcs) {
        const last = z.stats[z.stats.length - 1];
        for (const [k, v] of Object.entries(last?.errors ?? {})) zoneErrors[k] = (zoneErrors[k] ?? 0) + v;
    }
    const recovered = bots.flatMap((b) => b.recovered);
    // Leases still live after every zone stopped; a crashed zone's run out on their own.
    let leftoverLeases = 0;
    for (const key of await store.keys('lease:')) {
        const lease = (await store.get(key))?.value;
        if (lease && lease.until > Date.now() && lease.zoneId !== 'z0') leftoverLeases++;
        else if (lease && lease.until > Date.now() && !CRASH) leftoverLeases++;
    }

    console.log(`transfers: ${hops} in ${elapsed.toFixed(1)} s = ${(hops / elapsed).toFixed(1)}/s`);
    console.log(`transfer time: p50 ${quantile(latencies, 0.5).toFixed(0)} ms, p95 ${quantile(latencies, 0.95).toFixed(0)} ms, max ${Math.max(0, ...latencies).toFixed(0)} ms`);
    console.log(`zone-side failures: ${JSON.stringify(zoneErrors)}; logins refused while held elsewhere: ${bots.reduce((n, b) => n + b.refused, 0)}`);
    console.log(`leases still held by a stopped zone: ${leftoverLeases}`);
    if (CRASH) {
        console.log(`crash: ${crashedPlayers.size} players had to log in again; ${unsavedLost} hops lost unsaved, `
            + `${sentIntoDeadZone} transfers saved into the zone as it died; back in another zone after `
            + `p50 ${quantile(recovered, 0.5).toFixed(0)} ms, max ${Math.max(0, ...recovered).toFixed(0)} ms (lease ttl ${LEASE_TTL} ms)`);
    }
    console.log(`integrity: ${mismatches === 0 ? 'every record matches its bot' : `${mismatches} MISMATCHED`}`
        + (examples.length ? `\n  ${examples.join('\n  ')}` : ''));

    served.wss.close();
    for (const p of [...zoneProcs, ...botProcs]) if (alive(p)) p.kill();
    process.exit(mismatches === 0 ? 0 : 1);
}

if (ROLE === 'zone') await runZone();
else if (ROLE === 'bots') await runBots();
else await runAll();
