// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    verify-far-proxy-town.mjs
 * @brief   A town's far proxies, judged against the same town with every cell loaded, frame by frame along one flight.
 *
 * @details Three packages of `examples/far-proxy-town`, built by the CLI and booted in headless Chromium:
 *            - `proxies`: as authored, cells streamed around the flyer and far proxies everywhere else;
 *            - `none`: the same with far proxies off, the control: what an absent cell looks like;
 *            - `all`: every cell loaded all the time, the reference a proxy is meant to look like.
 *          The flight is a function of elapsed time, so stepping each package the same frames sees the same town from the same
 *          places. At each sample the pictures are compared with the reference; the control has to differ, or the comparison
 *          cannot see a hole. Residency is read beside each picture: every cell within the far distance has to be drawn by itself
 *          or by its proxy. After a whole lap the flyer is back where it began, and what is loaded has to be what was.
 *
 *          node tools/verify-far-proxy-town.mjs [--samples 45] [--backend webgl2|webgpu]
 */
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { serveHost } from './lib/staticServer.mjs';

const require = createRequire(path.join(ROOT, 'pipeline/package.json'));
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const SAMPLES = Number(arg('samples', 45));
const BACKEND = arg('backend', 'webgl2');
const LAP_FRAMES = 90 * 60;
const W = 640, H = 360;
const WORK = path.join(ROOT, 'output/far-proxy-town');
const EXAMPLE = path.join(ROOT, 'examples/far-proxy-town');

/** Copy the example and rewrite what its world and flyer say for one variant. */
function variant(name, edit) {
    const dir = path.join(WORK, name);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(dir, { recursive: true });
    const project = path.join(dir, 'project');
    cpSync(EXAMPLE, project, { recursive: true, filter: (p) => !/[\\/](node_modules|build|\.esengine)([\\/]|$)/.test(p) });
    const file = path.join(project, 'assets/scenes/main.esscene');
    const scene = JSON.parse(readFileSync(file, 'utf8'));
    for (const e of scene.entities) for (const c of e.components ?? []) edit(e, c);
    writeFileSync(file, JSON.stringify(scene));
    const out = path.join(dir, 'web');
    const began = Date.now();
    const r = spawnSync(process.execPath, [path.join(ROOT, 'pipeline/bin/estella.mjs'), 'export', project, '--platform', 'web', '--out', out],
        { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
    if (r.status !== 0) {
        console.error(`✗ ${name}: the package did not build\n${`${r.stderr}${r.stdout}`.split('\n').slice(-12).join('\n')}`);
        process.exit(1);
    }
    const bytes = (d) => readdirSync(d).reduce((n, f) => { const p = path.join(d, f); const s = statSync(p); return n + (s.isDirectory() ? bytes(p) : s.size); }, 0);
    const far = readdirSync(path.join(out, 'world')).filter((f) => f.includes('.far.'));
    const farBytes = far.reduce((n, f) => n + statSync(path.join(out, 'world', f)).size, 0);
    return { name, out, exportMs: Date.now() - began, packageBytes: bytes(out), farFiles: far.length, farBytes,
        log: `${r.stdout}`.split('\n').filter((l) => /far prox/i.test(l)).map((l) => l.trim()) };
}

const variants = [
    variant('proxies', () => {}),
    variant('none', (e, c) => { if (c.type === 'StreamedWorld') c.data.farProxies = false; }),
    variant('all', (e, c) => {
        if (c.type === 'StreamedWorld') c.data.farProxies = false;
        if (c.type === 'WorldStreamingSource' && e.name === 'Flyer') Object.assign(c.data, { loadRadius: 5000, unloadRadius: 6000, prefetchRadius: 6000 });
    }),
];
for (const v of variants) console.log(`  ${v.name}: exported in ${(v.exportMs / 1000).toFixed(1)} s, ${(v.packageBytes / 1048576).toFixed(1)} MiB`
    + (v.farFiles ? `, ${v.farFiles} far proxy files ${(v.farBytes / 1024).toFixed(0)} KiB` : '') + (v.log.length ? ` — ${v.log.join('; ')}` : ''));
const manifest = JSON.parse(readFileSync(path.join(variants[0].out, 'world/main.world.json'), 'utf8'));

const browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });

/** Fly one package the whole lap, sample by sample. */
async function fly(v) {
    const server = await serveHost(v.out);
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('favicon.ico')) errors.push(`HTTP ${res.status()} ${res.url()}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless&backend=${BACKEND}`);
    let ready = false;
    for (let i = 0; i < 600 && !ready; i++) {
        ready = await page.evaluate(() => !!window.__estellaCooked?.streaming).catch(() => false);
        if (!ready) await new Promise((d) => setTimeout(d, 100));
    }
    if (!ready) throw new Error(`${v.name}: the package never exposed a streaming report`);
    await page.evaluate(() => window.__estellaCooked.setPaused(true));
    // The flight's clock from zero, here, for every package alike; the settling steps below advance no time.
    await page.evaluate(() => window.farProxyTown.restart());
    await page.evaluate(() => window.__estellaCooked.step(1, 0));
    const settle = async () => {
        // Some frames first: a cell whose proxy just arrived leaves on the next reconciliation, not on this one.
        for (let i = 0; i < 400; i++) {
            const s = await page.evaluate(() => window.__estellaCooked.streaming());
            if (i >= 10 && s.loadingCells.length === 0 && s.unloadingCells.length === 0) return s;
            await page.evaluate(() => window.__estellaCooked.step(1, 0));
            await new Promise((d) => setTimeout(d, 20));
        }
        return page.evaluate(() => window.__estellaCooked.streaming());
    };
    const start = await settle();
    const samples = [];
    const per = Math.floor(LAP_FRAMES / SAMPLES);
    for (let k = 0; k <= SAMPLES; k++) {
        if (k > 0) await page.evaluate((n) => window.__estellaCooked.step(n, 1 / 60), per);
        const shot = await page.evaluate(async () => {
            const c = window.__estellaCooked;
            return { streaming: c.streaming(), render: c.drawn(), gpu: c.gpu(), at: c.probe(['Flyer']).at.Flyer };
        });
        const png = PNG.sync.read(await page.screenshot());
        samples.push({ ...shot, rgba: png.data });
        writeFileSync(path.join(WORK, v.name, `shot-${String(k).padStart(2, '0')}.png`), PNG.sync.write(png));
    }
    // Back at the start of the lap: what is loaded settles to what was.
    const end = await settle();
    if (process.env.FAR_TOWN_DEBUG) console.log(v.name, JSON.stringify({ startAt: samples[0].at, endAt: await page.evaluate(() => window.__estellaCooked.probe(['Flyer']).at.Flyer),
        startResident: start.residentCells, endResident: end.residentCells }));
    await page.close();
    server.close();
    return { start, end, samples, errors };
}

const flown = {};
for (const v of variants) {
    const began = Date.now();
    flown[v.name] = await fly(v);
    console.log(`  ${v.name}: flew ${SAMPLES} samples in ${((Date.now() - began) / 1000).toFixed(0)} s`);
}
await browser.close();

/** How far two pictures are apart: the mean channel difference, and the share of pixels off by more than a quarter of the range. */
function apart(a, b) {
    let sum = 0, broken = 0;
    for (let i = 0; i < a.length; i += 4) {
        let max = 0;
        for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); sum += d; if (d > max) max = d; }
        if (max > 64) broken++;
    }
    const n = a.length / 4;
    return { mean: sum / (n * 3), broken: broken / n };
}

const results = [];
const claim = (ok, text, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${text}${detail ? ` — ${detail}` : ''}`); };
const rows = flown.all.samples.map((ref, k) => ({
    k, proxies: apart(flown.proxies.samples[k].rgba, ref.rgba), none: apart(flown.none.samples[k].rgba, ref.rgba),
    proxyCells: flown.proxies.samples[k].streaming.proxyCells.length, resident: flown.proxies.samples[k].streaming.residentCells.length,
    draws: { proxies: flown.proxies.samples[k].render.gpuDraws, all: ref.render.gpuDraws, none: flown.none.samples[k].render.gpuDraws },
    tris: { proxies: flown.proxies.samples[k].render.triangles, all: ref.render.triangles },
}));
writeFileSync(path.join(WORK, 'samples.json'), JSON.stringify(rows, null, 1));
if (process.env.FAR_TOWN_DEBUG) for (const k of [36, 37, 38]) for (const name of ['all', 'proxies']) console.log(k, name, JSON.stringify(flown[name].samples[k]?.gpu));
const worst = (key, field) => rows.reduce((m, r) => (r[key][field] > m[key][field] ? r : m));
const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;

// The control first: a comparison that cannot tell the town without proxies from the reference cannot judge proxies either.
claim(mean((r) => r.none.broken) > 0.02, 'without far proxies the distant town is missing, so the comparison can see a hole',
    `mean ${(100 * mean((r) => r.none.broken)).toFixed(1)}% of pixels badly off`);
const wp = worst('proxies', 'broken');
claim(wp.proxies.broken < 0.02, 'with far proxies every sampled frame looks like the fully loaded town',
    `worst sample ${wp.k}: ${(100 * wp.proxies.broken).toFixed(2)}% of pixels badly off, mean channel ${wp.proxies.mean.toFixed(2)};`
    + ` over the lap ${(100 * mean((r) => r.proxies.broken)).toFixed(2)}% (control ${(100 * mean((r) => r.none.broken)).toFixed(1)}%)`);

// Residency beside each picture: within the far distance, a cell is drawn by itself or by its proxy.
const far = manifest.farDistance;
let uncovered = 0, firstGap = null;
for (const [k, s] of flown.proxies.samples.entries()) {
    const shown = new Set([...s.streaming.residentCells, ...s.streaming.proxyCells, ...s.streaming.loadingCells]);
    for (const cell of manifest.cells) {
        if (!cell.proxy) continue;
        const dx = Math.max(cell.minX - s.at.x, 0, s.at.x - cell.maxX), dz = Math.max(cell.minZ - s.at.z, 0, s.at.z - cell.maxZ);
        if (Math.hypot(dx, dz) <= far && !shown.has(cell.name)) { uncovered++; firstGap ??= `${cell.name} at sample ${k}`; }
    }
}
claim(uncovered === 0, 'every cell within the far distance is drawn, resident or by its proxy, at every sample',
    uncovered ? `${uncovered} gaps, first ${firstGap}` : `${manifest.cells.filter((c) => c.proxy).length} of ${manifest.cells.length} cells have a proxy`);

// Back over the start after a lap: what is resident is what some source's band still holds, and nothing is both a cell and a proxy.
const p = flown.proxies;
const scene = JSON.parse(readFileSync(path.join(EXAMPLE, 'assets/scenes/main.esscene'), 'utf8'));
const sources = scene.entities.flatMap((e) => {
    const s = (e.components ?? []).find((c) => c.type === 'WorldStreamingSource');
    return s ? [{ name: e.name, unload: s.data.unloadRadius, at: e.components.find((c) => c.type === 'Transform').data.position }] : [];
});
const endAt = p.samples.at(-1).at;
const held = (cell) => sources.some((s) => {
    const at = s.name === 'Flyer' ? endAt : s.at;
    return Math.hypot(Math.max(cell.minX - at.x, 0, at.x - cell.maxX), Math.max(cell.minZ - at.z, 0, at.z - cell.maxZ)) <= s.unload;
});
const strays = p.end.residentCells.filter((name) => !held(manifest.cells.find((c) => c.name === name)));
const both = p.end.residentCells.filter((name) => p.end.proxyCells.includes(name));
claim(strays.length === 0 && both.length === 0, 'after a lap every resident cell is one a source still holds, and none is also drawn by its proxy',
    `${p.end.residentCells.length} resident, ${p.end.proxyCells.length} proxied; ${p.end.loadCount} loads, ${p.end.unloadCount} unloads over the lap`
    + (strays.length ? `; held by no source: ${strays.join(', ')}` : '') + (both.length ? `; both: ${both.join(', ')}` : ''));
claim(p.errors.length === 0 && flown.none.errors.length === 0 && flown.all.errors.length === 0, 'no errors in any package',
    [...p.errors, ...flown.none.errors, ...flown.all.errors].slice(0, 3).join(' | '));

console.log(`  draws per frame, lap mean: proxies ${mean((r) => r.draws.proxies).toFixed(0)}, all loaded ${mean((r) => r.draws.all).toFixed(0)},`
    + ` none ${mean((r) => r.draws.none).toFixed(0)}; triangles: proxies ${mean((r) => r.tris.proxies ?? 0).toFixed(0)},`
    + ` all loaded ${mean((r) => r.tris.all ?? 0).toFixed(0)}; resident cells ${mean((r) => r.resident).toFixed(1)}, proxied ${mean((r) => r.proxyCells).toFixed(1)}`);
writeFileSync(path.join(WORK, 'report.json'), JSON.stringify({ variants: variants.map(({ log, ...v }) => ({ ...v, log })), rows: rows.length,
    passed: results.every(Boolean) }, null, 2));
process.exit(results.every(Boolean) ? 0 : 1);
