// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * What a camera moving through the dynamic GI scene costs: the frames it hitches and what each rebuild of the following distance field spends.
 *
 *   node tools/gi/measure-camera-move.mjs [seconds=12]      env CELL (default 2.5): the finest cell of the three levels
 *
 * Exports the GI lab with a script that walks the camera back and forth (CAM_MOVE), runs it headless on the machine GPU, and reads the frame
 * intervals the page saw and the system's own record of each rebuild (instances, field, pack, hand-over to the engine, megabytes of field).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const seconds = Number(process.argv[2] ?? 12), cell = Number(process.env.CELL ?? 2.5);
const work = mkdtempSync(path.join(tmpdir(), 'gi-move-'));
const project = path.join(work, 'project'), web = path.join(work, 'web');
const env = { ...process.env, BACKEND: 'webgpu', CAM_MOVE: '1', EFFECTS: JSON.stringify([{ type: 'dynamicGI', enabled: true, uniforms: { u_cellSize: cell } }]) };
let r = spawnSync('python', [path.join(root, 'tools/render-lab/gi_project.py'), project, 'gi_room'], { env, encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
spawnSync('node', [path.join(root, 'tools/asset-meta.js'), path.join(project, 'assets')], { encoding: 'utf8' });
r = spawnSync('node', [path.join(root, 'pipeline/bin/estella.mjs'), 'export', project, '--out', web], { encoding: 'utf8', cwd: root });
if (r.status !== 0) { console.error((r.stdout + r.stderr).slice(-600)); process.exit(1); }

const { chromium } = await import(pathToFileURL(path.join(root, 'node_modules/playwright/index.mjs')).href);
const { serveHost } = await import(pathToFileURL(path.join(root, 'tools/lib/staticServer.mjs')).href);
const server = await serveHost(web);
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
        window.__frames = [];
        let last = performance.now();
        const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await page.waitForTimeout(8000);  // load, the first build, settle
    await page.evaluate(() => { window.__frames.length = 0; if (window.__estellaGIBuild) window.__estellaGIBuild.ms.length = 0; });
    await page.waitForTimeout(seconds * 1000);
    const { frames, builds } = await page.evaluate(() => ({ frames: window.__frames.slice(), builds: window.__estellaGIBuild ? window.__estellaGIBuild.ms.slice() : [] }));
    const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
    console.log(`frames: ${frames.length} in ${seconds}s, median ${pct(frames, 0.5).toFixed(1)} ms, p99 ${pct(frames, 0.99).toFixed(1)} ms, worst ${Math.max(...frames).toFixed(1)} ms, over 50 ms: ${frames.filter((f) => f > 50).length}`);
    console.log(`rebuilds: ${builds.length}`);
    if (builds.length > 0) {
        const col = (i) => builds.map((b) => b[i]);
        const sum = builds.map((b) => b[0] + b[1] + b[2] + b[3]);
        const m = (i) => `${pct(col(i), 0.5).toFixed(1)} / ${Math.max(...col(i)).toFixed(1)}`;
        console.log(`  per rebuild (median / worst ms): instances ${m(0)}, field ${m(1)}, pack ${m(2)}, hand-over ${m(3)}; total ${pct(sum, 0.5).toFixed(1)} / ${Math.max(...sum).toFixed(1)}; ${builds[0][4].toFixed(1)} MB of field`);
    }
} finally {
    await browser.close();
    server.close();
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
