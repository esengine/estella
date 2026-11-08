// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world-residency.e2e.mjs
 * @brief   Verify real XY/XZ scene transactions, repeated residency and cancellation of delayed assets.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serveHost } from '../lib/staticServer.mjs';
import { requireCurrentEngine } from '../lib/engineBuild.mjs';
import { streamingDistricts } from '../lib/streamingDistricts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'output/world-residency');
const { PNG } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('pngjs');
requireCurrentEngine(root, path.join(root, 'build/render-host/wasm'));
await mkdir(out, { recursive: true });
assert.ok(!(process.argv.includes('--webgl-only') && process.argv.includes('--webgpu-only')));
const backends = process.argv.includes('--webgl-only') ? ['webgl2']
    : process.argv.includes('--webgpu-only') ? ['webgpu'] : ['webgl2', 'webgpu'];
const texture = new PNG({ width: 8, height: 8 });
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = (y * 8 + x) * 4, bright = (x + y) % 2 === 0;
    texture.data.set(bright ? [245, 174, 61, 255] : [34, 151, 192, 255], p);
}
const textureBytes = PNG.sync.write(texture);
const server = await serveHost(path.join(root, 'build/render-host'));
const browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
const report = { status: 'failed', cases: [] };
try {
    for (const backend of backends) for (const plane of ['xy', 'xz']) {
        const page = await browser.newPage({ viewport: { width: 384, height: 256 } });
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        let releaseLate, lateRequested = false;
        const lateGate = new Promise(resolve => { releaseLate = resolve; });
        await page.route('**/textures/residency-*.png', async route => {
            if (route.request().url().endsWith('/residency-late-b.png')) { lateRequested = true; await lateGate; }
            await route.fulfill({ contentType: 'image/png', body: textureBytes });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/?w=384&h=256&backend=${backend}`);
        await page.evaluate(async () => { await window.__estellaHeadless.ready; });
        const manifest = await page.evaluate(scene => window.__estellaHeadless.api.loadStreamedWorld(scene, 'districts'), streamingDistricts(plane));
        assert.equal(manifest.plane ?? 'xz', plane);
        assert.deepEqual(manifest.cells.map(cell => [cell.x, cell.z]), [[0, 0], [3, 2]]);
        const snapshot = () => page.evaluate(() => window.__estellaHeadless.api.worldResidencySnapshot());
        const baseline = await snapshot();
        const wait = async predicate => {
            let state;
            for (let i = 0; i < 300; i++) {
                await page.evaluate(() => window.__estellaHeadless.api.step(2));
                state = await snapshot();
                if (predicate(state)) return state;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            throw new Error(`Residency did not settle: ${JSON.stringify(state)}`);
        };
        const settled = state => state.loadingCells.length === 0 && state.unloadingCells.length === 0 && state.assets.pendingLoads === 0;
        const enabled = value => page.evaluate(value => window.__estellaHeadless.api.setField(2, 'WorldStreamingSource', 'enabled', '', value), value);
        const move = far => page.evaluate(({ far, plane }) => window.__estellaHeadless.api.setField(2, 'Transform', 'position', '',
            { x: far ? 350 : 50, y: plane === 'xy' ? (far ? 250 : 50) : 0, z: plane === 'xz' ? (far ? 250 : 50) : 0 }), { far, plane });
        const assertEmpty = state => {
            assert.deepEqual(state.residentCells, []); assert.deepEqual(state.preparedCells, []);
            assert.deepEqual(state.loadingCells, []); assert.deepEqual(state.unloadingCells, []);
            assert.equal(state.entities, baseline.entities);
            assert.equal(state.assets.refRows, baseline.assets.refRows);
            assert.equal(state.assets.trackedRefRows, baseline.assets.trackedRefRows);
            assert.equal(state.assets.pendingLoads, 0);
        };
        await page.evaluate(() => window.__estellaHeadless.api.setRunMode(true));
        const initial = await wait(state => settled(state) && state.residentCells.length === 1 && state.preparedCells.length === 1);
        assert.equal(initial.residentCells[0], 'districts.cell_0_0');
        assert.ok(initial.entities > baseline.entities && initial.assets.refRows > baseline.assets.refRows);
        const raw = await page.evaluate(async () => {
            const { api } = window.__estellaHeadless;
            await api.step(3); await api.waitForShaders(); await api.step(2);
            const p = await api.captureViewportPixels(); return { width: p.width, height: p.height, rgba: Array.from(p.rgba) };
        });
        const shot = new PNG({ width: raw.width, height: raw.height }), pixels = Buffer.from(raw.rgba), stride = raw.width * 4;
        let visible = 0;
        for (let i = 0; i < pixels.length; i += 4) if ([0, 1, 2].some(c => Math.abs(pixels[i + c] - pixels[c]) > 8)) visible++;
        for (let y = 0; y < raw.height; y++) pixels.copy(shot.data, y * stride, (raw.height - y - 1) * stride, (raw.height - y) * stride);
        await writeFile(path.join(out, `${backend}-${plane}-resident.png`), PNG.sync.write(shot));
        assert.ok(visible > 200, `A resident neighbourhood must produce visible pixels: ${visible}`);
        const cycles = [];
        for (let i = 0; i < 6; i++) {
            await move(i % 2 === 0);
            const live = await wait(state => settled(state) && state.residentCells[0] === (i % 2 === 0 ? 'districts.cell_3_2' : 'districts.cell_0_0') && state.preparedCells.length === 1);
            assert.equal(live.entities, initial.entities);
            assert.equal(live.assets.refRows, initial.assets.refRows);
            await enabled(false);
            const began = performance.now();
            await page.evaluate(() => window.__estellaHeadless.api.clearWorldResidency());
            const empty = await snapshot(); assertEmpty(empty);
            cycles.push({ clearMs: performance.now() - began, entities: empty.entities, assetRefRows: empty.assets.refRows });
            await enabled(true);
        }
        await wait(state => settled(state) && state.residentCells.length === 1 && state.preparedCells.length === 1);
        await page.evaluate(scene => window.__estellaHeadless.api.replaceStreamedWorld(scene, 'replacement'), streamingDistricts(plane, 'replacement'));
        const replaced = await snapshot(); assertEmpty(replaced);
        assert.ok(!replaced.names.some(name => name?.startsWith('base-')));
        const residentReplacement = await wait(state => settled(state) && state.residentCells.length === 1 && state.preparedCells.length === 1);
        assert.ok(residentReplacement.names.some(name => name?.startsWith('replacement-')));
        await enabled(false);
        await page.evaluate(scene => window.__estellaHeadless.api.replaceStreamedWorld(scene, 'late'), streamingDistricts(plane, 'late'));
        await move(false); await enabled(true);
        await wait(state => state.residentCells.includes('late.cell_0_0') && state.loadingCells.includes('late.cell_3_2') && lateRequested);
        await page.evaluate(() => {
            const { api } = window.__estellaHeadless;
            api.setField(2, 'WorldStreamingSource', 'enabled', '', false);
            window.__clearDone = false;
            window.__clearResult = api.clearWorldResidency().then(() => { window.__clearDone = true; });
        });
        assert.equal(await page.evaluate(() => window.__clearDone), false);
        releaseLate();
        await page.evaluate(() => window.__clearResult);
        const cancelled = await snapshot(); assertEmpty(cancelled);
        assert.ok(!cancelled.names.some(name => name?.startsWith('late-')));
        assert.deepEqual(errors, []);
        report.cases.push({ backend, plane, persistentEntities: baseline.entities, visiblePixels: visible,
            residentEntities: initial.entities, residentAssetRefRows: initial.assets.refRows, cycles,
            replacementCleared: true, delayedPreparationCancelled: true, finalAssetRefRows: cancelled.assets.refRows });
        console.log(JSON.stringify(report.cases.at(-1)));
        await page.close();
    }
    report.status = 'checks-passed';
} catch (error) { report.error = String(error); throw error; }
finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
