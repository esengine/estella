// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The dynamic GI's cost gate: how much work its passes are asked to do, held to budgets on any machine.
 *
 *   node tools/gi/check-gi-cost.mjs
 *
 * What a frame of the effect costs on a device is the work (rays traced, texels read, bytes forced on the scene pass) times what that work
 * costs there. The second factor is the device's: the phone this runs on took 20 ms for work an RTX does in 3. The first is the engine's, and
 * it is counted where the passes are dispatched (DynamicGIStats, read back through `postprocess_giStats`), so it is the same number on both. A
 * change that doubles the rays, or makes every pixel read twice as much, shows here, on the machine where the GPU is too fast to notice.
 *
 * What is held:
 *   - the probes' rays a frame, and that their number does not grow with the picture (a probe count that follows the pixels is a cost that
 *     follows the screen of a phone);
 *   - the cards relit a frame are a slice of them, not all;
 *   - the texture reads of the apply pass per pixel, which the gate also counts in the kernel text, so the number the engine reports cannot
 *     drift from the kernel it describes;
 *   - what the effect forces the scene pass to write, and what it keeps resident.
 *
 * Runs headless on the machine's own GPU (the lab room, exported for the web). Exits 0 with a note where there is no WebGPU adapter or no
 * Python to write the lab with: a gate that cannot run says so, and does not fail.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');

// Measured 2026-11-11 on the lab room (10 boxes, ~3.7k card pixels), default settings (cards over 4 frames, one probe ray in 2).
const BUDGET = {
    /** Probes cover about 160 x 90 of the picture whatever its size. */
    probeCount: { min: 12000, max: 17000 },
    /** A probe has 64 rays, and one in `stride` is traced a frame. */
    probeRaysPerProbe: 32,
    /** Rays per pixel of the picture at 720p: the probes' share. */
    raysPerPixel720: 0.6,
    /** A slice of the cards a frame, not all of them. */
    cardSliceOfAll: 0.3,
    /** Texture reads per pixel of the apply pass. */
    applyLoadsPerPixel: 25,
    /** Bytes per pixel the scene pass writes for this effect alone (G-buffer 8 + albedo 4). */
    forcedBytesPerPixel: 12,
    residentBytes: 64 * 1024 * 1024,
};

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

function skip(why) {
    console.log(`check-gi-cost: skipped - ${why}`);
    process.exit(0);
}

// The kernel text, for the loads the apply pass makes: the ones of its own and the ones of each probe it asks.
const source = readFileSync(path.join(root, 'src/esengine/renderer/frame/DynamicGI.cpp'), 'utf8');
const applySource = source.slice(source.indexOf('const char* kApply'), source.indexOf('#else', source.indexOf('const char* kApply')));
const probeTerm = applySource.slice(applySource.indexOf('fn probeTerm'), applySource.indexOf('@compute', applySource.indexOf('fn probeTerm')));
const main = applySource.slice(applySource.indexOf('@compute'));
const loads = (text) => (text.match(/textureLoad\(/g) ?? []).length;
const mainLoads = loads(main), perProbe = loads(probeTerm);
// The geometry of a probe is read before the early-out on a probe with nothing in it; five loads a probe is what a probe that counts costs.
const modelLoads = mainLoads + 4 * perProbe;

const python = ['python', 'python3'].find((p) => spawnSync(p, ['--version']).status === 0);
if (!python) skip('no Python to write the lab with');

const work = mkdtempSync(path.join(tmpdir(), 'gi-cost-'));
const project = path.join(work, 'project');
const web = path.join(work, 'web');
try {
    const env = { ...process.env, BACKEND: 'webgpu', EFFECTS: JSON.stringify([{ type: 'dynamicGI', enabled: true, uniforms: {} }]) };
    let r = spawnSync(python, [path.join(root, 'tools/render-lab/gi_project.py'), project, 'gi_room'], { env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`gi_project.py: ${r.stderr}`);
    spawnSync('node', [path.join(root, 'tools/asset-meta.js'), path.join(project, 'assets')], { encoding: 'utf8' });
    r = spawnSync('node', [path.join(root, 'pipeline/bin/estella.mjs'), 'export', project, '--out', web], { encoding: 'utf8', cwd: root });
    if (r.status !== 0) throw new Error(`export: ${(r.stdout + r.stderr).slice(-400)}`);

    const { chromium } = await import(pathToFileURL(path.join(root, 'node_modules/playwright/index.mjs')).href);
    const { serveHost } = await import(pathToFileURL(path.join(root, 'tools/lib/staticServer.mjs')).href);
    const server = await serveHost(web);
    const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio'] });
    const stats = {};
    try {
        for (const [w, h] of [[1280, 720], [1920, 1080]]) {
            const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
            await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
            const got = await page.waitForFunction(() => {
                const s = window.__estellaGIStats?.();
                return s && s[0] > 0 && s[15] >= 6 ? s : null;
            }, null, { timeout: 90000, polling: 500 }).then((h2) => h2.jsonValue()).catch(() => null);
            await page.close();
            if (!got) skip(`the effect did not run at ${w}x${h} (no WebGPU adapter, or no compute stage)`);
            stats[`${w}x${h}`] = got;
        }
    } finally {
        await browser.close();
        server.close();
    }

    const [NAMES] = [['width', 'height', 'probeSpacing', 'probes', 'probeRays', 'cardPixels', 'cardPixelsRelit', 'cardRays', 'applyPixels', 'applyLoadsPerPixel', 'forcedAttachmentBytes', 'residentBytes', 'levels', 'lights', 'instances', 'frame']];
    const named = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Object.fromEntries(NAMES.map((n, i) => [n, v[i]]))]));
    for (const [size, s] of Object.entries(named)) {
        console.log(`${size}: ${s.probes} probes ${s.probeSpacing} px apart, ${s.probeRays} probe rays, ${s.cardPixelsRelit}/${s.cardPixels} cards relit (${s.cardRays} rays), `
            + `${s.applyLoadsPerPixel} reads a pixel, ${(s.forcedAttachmentBytes / s.applyPixels).toFixed(0)} B a pixel forced on the scene pass, ${(s.residentBytes / 1048576).toFixed(1)} MB resident`);
        check(s.probes >= BUDGET.probeCount.min && s.probes <= BUDGET.probeCount.max, `${size}: ${s.probes} probes, expected ${BUDGET.probeCount.min}-${BUDGET.probeCount.max} whatever the size`);
        check(Math.abs(s.probeRays - s.probes * BUDGET.probeRaysPerProbe) < 1, `${size}: ${s.probeRays} probe rays, expected ${s.probes * BUDGET.probeRaysPerProbe}`);
        check(s.cardPixelsRelit <= s.cardPixels * BUDGET.cardSliceOfAll, `${size}: ${s.cardPixelsRelit} of ${s.cardPixels} cards relit in a frame, expected at most ${BUDGET.cardSliceOfAll} of them`);
        check(s.applyLoadsPerPixel <= BUDGET.applyLoadsPerPixel, `${size}: ${s.applyLoadsPerPixel} reads a pixel in the apply pass, budget ${BUDGET.applyLoadsPerPixel}`);
        check(s.applyLoadsPerPixel === modelLoads, `${size}: the engine reports ${s.applyLoadsPerPixel} reads a pixel but the kernel makes ${modelLoads} (${mainLoads} + 4 x ${perProbe}): update DynamicGIStats`);
        check(s.forcedAttachmentBytes / s.applyPixels <= BUDGET.forcedBytesPerPixel, `${size}: ${s.forcedAttachmentBytes / s.applyPixels} bytes a pixel forced on the scene pass, budget ${BUDGET.forcedBytesPerPixel}`);
        check(s.residentBytes <= BUDGET.residentBytes, `${size}: ${s.residentBytes} bytes resident, budget ${BUDGET.residentBytes}`);
    }
    const a = named['1280x720'], b = named['1920x1080'];
    check(a.probeRays / (a.width * a.height) <= BUDGET.raysPerPixel720, `720p: ${(a.probeRays / (a.width * a.height)).toFixed(3)} probe rays a pixel, budget ${BUDGET.raysPerPixel720}`);
    check(Math.abs(b.probeRays - a.probeRays) <= 0.1 * a.probeRays, `probe rays grew with the picture: ${a.probeRays} at 720p, ${b.probeRays} at 1080p`);
} catch (e) {
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
    console.error('check-gi-cost:', e instanceof Error ? e.message : String(e));
    process.exit(1);
}
rmSync(work, { recursive: true, force: true, maxRetries: 5 });

if (failures.length > 0) {
    console.error('check-gi-cost FAILED:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
}
console.log('check-gi-cost passed');
