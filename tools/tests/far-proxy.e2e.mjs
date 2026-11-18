// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    far-proxy.e2e.mjs
 * @brief   Verify a streamed cell's far proxy draws the place while it is absent, looks like it, and leaves no frame empty.
 *
 * @details Two textured districts on the ground, the observer in one. Without far proxies the other district is not drawn; with
 *          them its proxy is, and its pixels match the district drawn resident. Walking from one district to the other, every
 *          frame is captured: a cell leaving before its proxy arrives, or a proxy leaving before its cell, shows as a frame with
 *          a district missing.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serveHost } from '../lib/staticServer.mjs';
import { requireCurrentEngine } from '../lib/engineBuild.mjs';
import { streamingDistricts } from '../lib/streamingDistricts.mjs';
import { ROOT as root } from '../lib/repo.mjs';

const out = path.join(root, 'output/far-proxy');
const { PNG } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('pngjs');
requireCurrentEngine(root, path.join(root, 'build/render-host/wasm'));
await mkdir(out, { recursive: true });
const backends = process.argv.includes('--webgl-only') ? ['webgl2']
    : process.argv.includes('--webgpu-only') ? ['webgpu'] : ['webgl2', 'webgpu'];
const texture = new PNG({ width: 8, height: 8 });
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    texture.data.set((x + y) % 2 === 0 ? [245, 174, 61, 255] : [34, 151, 192, 255], (y * 8 + x) * 4);
}
const textureBytes = PNG.sync.write(texture);
const server = await serveHost(path.join(root, 'build/render-host'));
const browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
const report = { status: 'failed', cases: [] };
const NEAR = 'districts.cell_0_0', FAR = 'districts.cell_3_2';

/** A page running the district world; `world` is what its StreamedWorld adds. */
async function open(backend, world) {
    const page = await browser.newPage({ viewport: { width: 384, height: 256 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.route('**/textures/residency-*.png', route => route.fulfill({ contentType: 'image/png', body: textureBytes }));
    await page.goto(`http://127.0.0.1:${server.address().port}/?w=384&h=256&backend=${backend}`);
    await page.evaluate(async () => { await window.__estellaHeadless.ready; });
    await page.evaluate(scene => window.__estellaHeadless.api.loadStreamedWorld(scene, 'districts'), streamingDistricts('xz', 'base', world));
    await page.evaluate(() => window.__estellaHeadless.api.setRunMode(true));
    const snapshot = () => page.evaluate(() => window.__estellaHeadless.api.worldResidencySnapshot());
    const settled = state => state.loadingCells.length === 0 && state.unloadingCells.length === 0 && state.assets.pendingLoads === 0;
    const wait = async predicate => {
        let state;
        for (let i = 0; i < 400; i++) {
            await page.evaluate(() => window.__estellaHeadless.api.step(2));
            state = await snapshot();
            if (settled(state) && predicate(state)) return state;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error(`Residency did not settle: ${JSON.stringify(state)}`);
    };
    /** The frame as RGBA rows top first, after shaders are in. */
    const capture = async (warm = true) => page.evaluate(async (warm) => {
        const { api } = window.__estellaHeadless;
        if (warm) { await api.step(3); await api.waitForShaders(); await api.step(2); }
        const p = await api.captureViewportPixels();
        return { width: p.width, height: p.height, rgba: Array.from(p.rgba) };
    }, warm);
    const move = far => page.evaluate(far => window.__estellaHeadless.api.setField(2, 'Transform', 'position', '',
        { x: far ? 350 : 50, y: 0, z: far ? 250 : 50 }), far);
    return { page, errors, snapshot, wait, capture, move };
}

/** Pixels that differ from the frame's corner (the clear colour), per half: the near district is left, the far one right. */
function drawn(raw) {
    let left = 0, right = 0;
    const p = raw.rgba;
    for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
        const i = (y * raw.width + x) * 4;
        if ([0, 1, 2].some(c => Math.abs(p[i + c] - p[c]) > 8)) { if (x < raw.width / 2) left++; else right++; }
    }
    return { left, right };
}

/** Mean channel difference over the right half, where the far district is drawn. */
function farDifference(a, b) {
    let sum = 0, n = 0;
    for (let y = 0; y < a.height; y++) for (let x = a.width / 2; x < a.width; x++) {
        const i = (y * a.width + x) * 4;
        for (let c = 0; c < 3; c++) { sum += Math.abs(a.rgba[i + c] - b.rgba[i + c]); n++; }
    }
    return sum / n;
}

async function save(raw, name) {
    const image = new PNG({ width: raw.width, height: raw.height }), data = Buffer.from(raw.rgba), stride = raw.width * 4;
    for (let y = 0; y < raw.height; y++) data.copy(image.data, y * stride, (raw.height - y - 1) * stride, (raw.height - y) * stride);
    await writeFile(path.join(out, name), PNG.sync.write(image));
}

try {
    for (const backend of backends) {
        // Without far proxies: the far district is simply not there.
        const plain = await open(backend, {});
        await plain.wait(state => state.residentCells.includes(NEAR));
        const without = await plain.capture();
        await save(without, `${backend}-without.png`);
        // And with it resident (the observer walked over), what the district looks like, to compare a proxy with.
        await plain.move(true);
        await plain.wait(state => state.residentCells.includes(FAR) && !state.residentCells.includes(NEAR));
        const residentFar = await plain.capture();
        await save(residentFar, `${backend}-far-resident.png`);
        assert.deepEqual(plain.errors, []);
        await plain.page.close();

        const world = await open(backend, { farProxies: true, farDistance: 1000 });
        const start = await world.wait(state => state.residentCells.includes(NEAR) && state.proxyCells.includes(FAR));
        assert.ok(!start.residentCells.includes(FAR), 'the far district must be absent for its proxy to be the one drawing it');
        const proxied = await world.capture();
        await save(proxied, `${backend}-proxy.png`);
        const before = drawn(without), after = drawn(proxied);
        assert.ok(after.right > before.right + 200, `the proxy must draw the absent district: ${before.right} -> ${after.right}`);
        const likeness = farDifference(proxied, residentFar);
        assert.ok(likeness < 2, `the proxy must look like the district it stands for: mean channel difference ${likeness}`);

        // Walk over, capturing every frame. Each district must stay drawn, by itself or by its proxy, throughout.
        await world.move(true);
        const frames = [];
        let state;
        for (let i = 0; i < 400; i++) {
            // One call per frame: the residency read beside the frame it drew, with nothing resolving in between.
            const step = await world.page.evaluate(async () => {
                const { api } = window.__estellaHeadless;
                await api.step(1);
                const p = await api.captureViewportPixels();
                return { raw: { width: p.width, height: p.height, rgba: Array.from(p.rgba) }, state: api.worldResidencySnapshot() };
            });
            const raw = step.raw;
            state = step.state;
            frames.push({ ...drawn(raw), resident: state.residentCells, proxies: state.proxyCells,
                loading: state.loadingCells, unloading: state.unloadingCells });
            if (state.residentCells.includes(FAR) && !state.residentCells.includes(NEAR) && state.proxyCells.includes(NEAR)
                && !state.proxyCells.includes(FAR) && state.loadingCells.length === 0 && state.unloadingCells.length === 0) break;
        }
        assert.ok(state.proxyCells.includes(NEAR) && state.residentCells.includes(FAR), `the walk did not settle: ${JSON.stringify(state)}`);
        const floor = { left: Math.min(...frames.map(f => f.left)), right: Math.min(...frames.map(f => f.right)) };
        await writeFile(path.join(out, `${backend}-handoff.json`), JSON.stringify(frames, null, 1));
        assert.ok(floor.left > 200 && floor.right > before.right + 200,
            `a frame lost a district during the handoff: fewest pixels left ${floor.left}, right ${floor.right}`);
        assert.deepEqual(world.errors, []);
        report.cases.push({ backend, withoutRight: before.right, proxyRight: after.right, likeness, handoffFrames: frames.length, floor });
        console.log(JSON.stringify(report.cases.at(-1)));
        await world.page.close();
    }
    report.status = 'checks-passed';
} catch (error) { report.error = String(error); throw error; }
finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
