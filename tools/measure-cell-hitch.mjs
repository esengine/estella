// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    measure-cell-hitch.mjs
 * @brief   What a streamed cell's arrival and departure cost the frame it lands in, along the far-proxy town's flight.
 *
 * @details Exports `examples/far-proxy-town` with this checkout's SDK, boots it in headless Chromium with the CPU slowed
 *          five times (a phone), and steps the flight one frame at a time, timing each step on the page's main thread. A
 *          frame in which a cell came in or went out is a streaming frame; what the worst of those cost, against the frames
 *          around them, is the hitch a player feels. Beside the times it counts frames in which the cell under the flyer
 *          was not in (a hole) and what the streamer reports of its policy (urgent cells, holds, rushed publications).
 *
 *          Run it on two checkouts (or before and after a change to the SDK) and compare the summaries; `--json` writes
 *          the per-frame rows.
 *
 *          node tools/measure-cell-hitch.mjs [--frames 2700] [--cpu 5] [--label after] [--json out.json] [--no-export]
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
const FRAMES = Number(arg('frames', 2700));
const CPU = Number(arg('cpu', 5));
const LABEL = arg('label', 'run');
const JSON_OUT = arg('json', null);
const WORK = path.join(ROOT, 'output/cell-hitch', LABEL);
const EXAMPLE = path.join(ROOT, 'examples/far-proxy-town');
const out = path.join(WORK, 'web');

if (!process.argv.includes('--no-export') || !existsSync(out)) {
    rmSync(WORK, { recursive: true, force: true });
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
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${server.address().port}/?headless&backend=webgl2`);
let ready = false;
for (let i = 0; i < 900 && !ready; i++) {
    ready = await page.evaluate(() => !!window.__estellaCooked?.streaming).catch(() => false);
    if (!ready) await new Promise((d) => setTimeout(d, 100));
}
if (!ready) throw new Error('the package never exposed a streaming report');
await page.evaluate(() => window.__estellaCooked.setPaused(true));
await page.evaluate(() => window.farProxyTown.restart());
// Settled before the clock starts: the first cells come in with no flight under way.
for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(() => window.__estellaCooked.streaming());
    if (i >= 10 && s.loadingCells.length === 0 && s.unloadingCells.length === 0) break;
    await page.evaluate(() => window.__estellaCooked.step(1, 0));
    await new Promise((d) => setTimeout(d, 20));
}
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

/** In the page, `n` frames: each step timed alone, and what residency said after it. */
const rows = [];
const BATCH = 60;
for (let done = 0; done < FRAMES; done += BATCH) {
    const batch = await page.evaluate(async ({ n, cells }) => {
        const c = window.__estellaCooked;
        const out = [];
        for (let i = 0; i < n; i++) {
            const t0 = performance.now();
            await c.step(1, 1 / 60);
            const ms = performance.now() - t0;
            const s = c.streaming();
            const at = c.probe(['Flyer']).at.Flyer;
            const under = cells.find((k) => at && at.x >= k.minX && at.x < k.maxX && at.z >= k.minZ && at.z < k.maxZ);
            out.push({
                ms, loads: s.loadCount, unloads: s.unloadCount,
                hole: !!under && !s.residentCells.includes(under.name),
                // Where the cell under the flyer stands when it is not in: what a hole is waiting for.
                under: !under ? '' : s.residentCells.includes(under.name) ? 'resident'
                    : s.loadingCells.includes(under.name) ? 'loading' : s.unloadingCells.includes(under.name) ? 'unloading'
                    : s.preparedCells.includes(under.name) ? 'prepared' : (s.queuedCells ?? []).includes(under.name) ? 'queued'
                    : s.desiredCells.includes(under.name) ? 'desired' : 'absent',
                publishing: s.loadingCells.length, unloading: s.unloadingCells.length,
                urgent: (s.urgentCells ?? []).length, holding: !!s.holding,
                holdCount: s.holdCount ?? 0, rushCount: s.rushCount ?? 0,
                bakes: c.bakes().map((b) => b.label).join(', '),
            });
        }
        return out;
    }, { n: Math.min(BATCH, FRAMES - done), cells });
    rows.push(...batch);
}
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await page.close();
server.close();
await browser.close();

// A streaming frame: a cell finished arriving or leaving in it, or work for one was in hand.
for (let i = 0; i < rows.length; i++) {
    const r = rows[i], p = rows[i - 1];
    r.streaming = r.publishing > 0 || r.unloading > 0 || r.bakes.length > 0
        || (p !== undefined && (r.loads !== p.loads || r.unloads !== p.unloads));
}
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const pct = (xs, q) => { const s = sorted(xs); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const all = rows.map((r) => r.ms);
const streaming = rows.filter((r) => r.streaming).map((r) => r.ms);
const quiet = rows.filter((r) => !r.streaming).map((r) => r.ms);
const last = rows[rows.length - 1];
const summary = {
    label: LABEL, frames: rows.length, cpuSlowdown: CPU,
    loads: last.loads - rows[0].loads, unloads: last.unloads - rows[0].unloads,
    worstMs: Math.max(...all), p99Ms: pct(all, 0.99), medianMs: pct(all, 0.5),
    streamingFrames: streaming.length, worstStreamingMs: streaming.length ? Math.max(...streaming) : 0,
    quietMedianMs: pct(quiet, 0.5), quietWorstMs: quiet.length ? Math.max(...quiet) : 0,
    over33: all.filter((m) => m > 33.4).length, over50: all.filter((m) => m > 50).length, over100: all.filter((m) => m > 100).length,
    holeFrames: rows.filter((r) => r.hole).length,
    holdCount: last.holdCount, rushCount: last.rushCount,
    errors: errors.length,
};
const worst = rows.map((r, i) => ({ i, ...r })).sort((a, b) => b.ms - a.ms).slice(0, 8)
    .map((r) => `#${r.i} ${r.ms.toFixed(1)} ms${r.streaming ? ' streaming' : ''}${r.bakes ? ` [${r.bakes}]` : ''}`);
console.log(JSON.stringify(summary, null, 1));
console.log('worst frames:\n  ' + worst.join('\n  '));
for (const e of errors.slice(0, 5)) console.log('page error:', e);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ summary, rows }, null, 1));
