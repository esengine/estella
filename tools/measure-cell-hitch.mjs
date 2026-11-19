// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    measure-cell-hitch.mjs
 * @brief   What streamed cells cost the frames a player sees, along the far-proxy town's flight, at phone speed.
 *
 * @details Exports `examples/far-proxy-town` with this checkout's SDK, boots it in headless Chromium with the CPU slowed
 *          (five times by default: a phone), and lets the game RUN, in real time, for as long as asked. Each frame the
 *          browser presents is timed from one animation frame to the next, and every Long Animation Frame is kept with the
 *          scripts that made it long, so a hitch is told by what ran in it: a cell's spawn, its preparation resuming from a
 *          fetch, or the frame's ordinary work. Every tenth frame it asks whether the cell under the flyer is in (a hole)
 *          and what the streamer's policy is doing.
 *
 *          Real time and not stepped frames, on purpose: a driver that steps frames inside one task never lets a fetch
 *          resolve between them, so every cell's preparation looked a whole batch of frames slower than it is, and a paused
 *          game still draws, so a stepped frame was timed with another frame inside it.
 *
 *          Run it on two checkouts (or before and after a change to the SDK) and compare the summaries.
 *
 *          With `--profile`, the main thread is sampled through the run and what ran OUTSIDE the frame callback (a fetch
 *          answering, a decode resuming) is told by function, inclusive: where the unbudgeted work is.
 *
 *          node tools/measure-cell-hitch.mjs [--seconds 60] [--cpu 5] [--label after] [--json out.json] [--no-export]
 *                                           [--profile [top]]
 */
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { serveHost } from './lib/staticServer.mjs';

const require = createRequire(path.join(ROOT, 'pipeline/package.json'));
const { chromium } = require('playwright');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const SECONDS = Number(arg('seconds', 60));
const CPU = Number(arg('cpu', 5));
const LABEL = arg('label', 'run');
const JSON_OUT = arg('json', null);
const PROFILE = process.argv.includes('--profile') ? (Number(arg('profile', 40)) || 40) : 0;
const WORK = path.join(ROOT, 'output/cell-hitch', LABEL);
const EXAMPLE = path.join(ROOT, 'examples/far-proxy-town');
const out = path.join(WORK, 'web');

if (!process.argv.includes('--no-export') || !existsSync(out)) {
    rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(WORK, { recursive: true });
    const project = path.join(WORK, 'project');
    cpSync(EXAMPLE, project, { recursive: true, filter: (p) => !/[\\/](node_modules|build|\.esengine)([\\/]|$)/.test(p) });
    const r = spawnSync(process.execPath, [path.join(ROOT, 'pipeline/bin/estella.mjs'), 'export', project, '--platform', 'web', '--out', out],
        { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
    if (r.status !== 0) {
        console.error(`✗ the package did not build\n${`${r.stderr}${r.stdout}`.split('\n').slice(-12).join('\n')}`);
        process.exit(1);
    }
}
const manifest = JSON.parse(readFileSync(path.join(out, 'world/main.world.json'), 'utf8'));
const cells = manifest.cells.map((c) => ({ name: c.name, minX: c.minX, minZ: c.minZ, maxX: c.maxX, maxZ: c.maxZ }));

const browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
const server = await serveHost(out);
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Every console line, by what it says with its numbers taken out: a line printed per cell is work done per cell.
const consoleLines = new Map();
let measuring = false;
page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300));
    if (!measuring) return;
    const key = `${m.type()} ${m.text().replace(/\[\d{2}:\d{2}:\d{2}\.\d+\]/g, '').replace(/[\d.]+/g, '#').replace(/"[^"]*"/g, '"…"').slice(0, 110)}`;
    consoleLines.set(key, (consoleLines.get(key) ?? 0) + 1);
});
await page.goto(`http://127.0.0.1:${server.address().port}/?headless&backend=webgl2`);
let ready = false;
for (let i = 0; i < 900 && !ready; i++) {
    ready = await page.evaluate(() => !!window.__estellaCooked?.streaming).catch(() => false);
    if (!ready) await new Promise((d) => setTimeout(d, 100));
}
if (!ready) throw new Error('the package never exposed a streaming report');
// Settled before the clock starts: the first cells come in with the game held at its start.
await page.evaluate(() => window.__estellaCooked.setPaused(true));
await page.evaluate(() => window.farProxyTown.restart());
for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(() => window.__estellaCooked.streaming());
    if (i >= 10 && s.loadingCells.length === 0 && s.unloadingCells.length === 0) break;
    await page.evaluate(() => window.__estellaCooked.step(1, 0));
    await new Promise((d) => setTimeout(d, 20));
}
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
if (PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    await cdp.send('Profiler.start');
}

measuring = true;
const run = await page.evaluate(async ({ seconds, cells }) => {
    const c = window.__estellaCooked;
    const loafs = [];
    let observer = null;
    try {
        observer = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
                loafs.push({
                    at: e.startTime, ms: e.duration, blocking: e.blockingDuration ?? 0,
                    scripts: (e.scripts ?? []).map((s) => ({
                        ms: s.duration, invoker: s.invoker, fn: s.sourceFunctionName, src: (s.sourceURL ?? '').split('/').pop(),
                    })),
                });
            }
        });
        observer.observe({ type: 'long-animation-frame', buffered: false });
    } catch { /* no LoAF in this browser: the frame intervals still stand */ }
    window.farProxyTown.restart();
    c.setPaused(false);
    const frames = [];
    const samples = [];
    const began = performance.now();
    let last = began;
    let n = 0;
    await new Promise((resolve) => {
        const tick = (t) => {
            frames.push({ at: t - began, ms: t - last });
            last = t;
            if (++n % 10 === 0) {
                const s = c.streaming();
                const at = c.probe(['Flyer']).at.Flyer;
                const under = cells.find((k) => at && at.x >= k.minX && at.x < k.maxX && at.z >= k.minZ && at.z < k.maxZ);
                samples.push({
                    at: t - began, hole: !!under && !s.residentCells.includes(under.name),
                    loads: s.loadCount, unloads: s.unloadCount, holding: !!s.holding,
                    holdCount: s.holdCount ?? 0, holdMs: s.holdMs ?? 0, rushCount: s.rushCount ?? 0,
                });
            }
            if (t - began < seconds * 1000) requestAnimationFrame(tick);
            else resolve();
        };
        requestAnimationFrame(tick);
    });
    c.setPaused(true);
    observer?.disconnect();
    const s = c.streaming();
    return { frames, samples, loafs, delivery: s.delivery ?? {} };
}, { seconds: SECONDS, cells });

const profile = PROFILE ? (await cdp.send('Profiler.stop')).profile : null;
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await page.close();
server.close();
await browser.close();

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const pct = (xs, q) => { const s = sorted(xs); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const median = (xs) => pct(xs, 0.5);
const ms = run.frames.slice(1).map((f) => f.ms);
const first = run.samples[0], last = run.samples[run.samples.length - 1];
const summary = {
    label: LABEL, seconds: SECONDS, cpuSlowdown: CPU, frames: ms.length,
    loads: last.loads - first.loads, unloads: last.unloads - first.unloads,
    medianFrameMs: median(ms), p99FrameMs: pct(ms, 0.99), worstFrameMs: Math.max(...ms),
    over50: ms.filter((m) => m > 50).length, over100: ms.filter((m) => m > 100).length, over200: ms.filter((m) => m > 200).length,
    longAnimationFrames: run.loafs.length,
    holeSamples: run.samples.filter((s) => s.hole).length, samples: run.samples.length,
    // Over the flight only: a world's first cells hold the game at boot, which is a loading screen and not a hitch.
    holdCount: last.holdCount - first.holdCount, holdMs: Math.round(last.holdMs - first.holdMs),
    rushCount: last.rushCount - first.rushCount, heldSamples: run.samples.filter((s) => s.holding).length,
    errors: errors.length,
};
console.log(JSON.stringify(summary, null, 1));

// What the long frames ran: script time by the function a script entry names, over every Long Animation Frame.
const byFn = new Map();
for (const l of run.loafs) for (const s of l.scripts) {
    const k = `${s.fn || '(anonymous)'} ${s.invoker ?? ''} ${s.src}`.trim();
    const e = byFn.get(k) ?? { ms: 0, n: 0, worst: 0 };
    e.ms += s.ms; e.n++; e.worst = Math.max(e.worst, s.ms);
    byFn.set(k, e);
}
console.log('long-frame scripts (total / count / worst):');
for (const [k, e] of [...byFn].sort((a, b) => b[1].ms - a[1].ms).slice(0, 15)) {
    console.log(`  ${e.ms.toFixed(0).padStart(7)} ms ${String(e.n).padStart(5)} ${e.worst.toFixed(0).padStart(6)} ms  ${k}`);
}
const worst = [...run.loafs].sort((a, b) => b.ms - a.ms).slice(0, 6);
console.log('worst long frames:');
for (const l of worst) {
    const top = [...l.scripts].sort((a, b) => b.ms - a.ms).slice(0, 3).map((s) => `${s.fn || s.invoker} ${s.ms.toFixed(0)}`).join(', ');
    console.log(`  ${(l.at / 1000).toFixed(1)} s: ${l.ms.toFixed(0)} ms (blocking ${l.blocking.toFixed(0)}) — ${top}`);
}
{
    const cellsSeen = Object.values(run.delivery);
    const line = (name, xs) => `  ${name.padEnd(20)} median ${median(xs).toFixed(0).padStart(6)} ms  max ${Math.max(0, ...xs).toFixed(0).padStart(6)} ms`;
    console.log(`delivery over ${cellsSeen.length} cells (wall clock):`);
    console.log(line('prepare', cellsSeen.map((d) => d.prepareMs)));
    console.log(line('publish', cellsSeen.map((d) => d.publishMs)));
    console.log(line('demand to resident', cellsSeen.map((d) => d.demandToResidentMs)));
    for (const ph of ['fetch', 'prefab', 'assets', 'readying']) console.log(line(ph, cellsSeen.map((d) => d.phases?.[ph] ?? 0)));
}
for (const e of errors.slice(0, 5)) console.log('page error:', e);
{
    const total = [...consoleLines.values()].reduce((a, b) => a + b, 0);
    console.log(`console lines while running: ${total}`);
    for (const [k, n] of [...consoleLines].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(6)}  ${k}`);
}
if (profile) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const name = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    // A frame is whatever runs under the animation-frame callback; everything else ran between frames.
    const FRAME = new Set(['runFrame_', 'mainLoop', 'tick']);
    const inclusive = new Map();
    const tasks = new Map();
    let between = 0;
    for (let i = 0; i < profile.samples.length; i++) {
        const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
        let id = profile.samples[i];
        const leaf = byId.get(id).callFrame.functionName;
        if (leaf === '(idle)' || leaf === '(program)' || leaf === '(garbage collector)') continue;
        const chain = [];
        while (id !== undefined) { chain.push(byId.get(id)); id = parent.get(id); }
        if (chain.some((n) => FRAME.has(n.callFrame.functionName))) continue;
        // The harness's own reports (streaming, probe) are not the engine's work.
        if (chain.some((n) => n.callFrame.functionName === 'streaming' || n.callFrame.functionName === 'probe')) continue;
        between += ms;
        const seen = new Set();
        for (const n of chain) {
            const k = name(n);
            if (seen.has(k)) continue;
            seen.add(k);
            inclusive.set(k, (inclusive.get(k) ?? 0) + ms);
        }
        // The outermost named function: which task it was.
        const outer = [...chain].reverse().find((n) => n.callFrame.functionName && !n.callFrame.functionName.startsWith('('));
        if (outer) tasks.set(name(outer), (tasks.get(name(outer)) ?? 0) + ms);
    }
    console.log(`between frames: ${between.toFixed(0)} ms of main thread`);
    console.log('by function, inclusive:');
    for (const [k, v] of [...inclusive].sort((a, b) => b[1] - a[1]).slice(0, PROFILE)) console.log(`  ${v.toFixed(0).padStart(7)} ms  ${k}`);
    writeFileSync(path.join(WORK, 'run.cpuprofile'), JSON.stringify(profile));
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ summary, ...run }, null, 1));
