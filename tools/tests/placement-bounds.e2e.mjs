// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    placement-bounds.e2e.mjs
 * @brief   Compare native instance culling with individual deformed meshes.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serveHost } from '../lib/staticServer.mjs';
import { requireCurrentEngine } from '../lib/engineBuild.mjs';

const { PNG } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('pngjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(repo, 'output/placement-bounds');
const host = path.join(repo, 'build/render-host');
requireCurrentEngine(repo, path.join(host, 'wasm'));
await mkdir(out, { recursive: true });
const server = await serveHost(host);
const browser = await chromium.launch({
    channel: 'chromium', headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const report = { status: 'failed', checks: [] };
try {
    const backends = process.argv.includes('--webgl-only') ? ['webgl2'] : ['webgl2', 'webgpu'];
    for (const backend of backends) {
        const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto(`http://127.0.0.1:${server.address().port}/?w=256&h=256&backend=${backend}`);
        await page.evaluate(async () => { await window.__estellaHeadless.ready; });
        const loaded = await page.evaluate(() => window.__estellaHeadless.api.loadScene('/scenes/placement-bounds.esscene'));
        assert.deepEqual(loaded.missing, []);
        await page.evaluate(() => window.__estellaHeadless.api.setCpuProfiling(true));
        const capture = async label => {
            const raw = await page.evaluate(async () => {
                const { api } = window.__estellaHeadless;
                await api.step(2);
                if (!await api.waitForShaders()) throw new Error('Shader compilation did not complete');
                await api.step(1);
                const image = await api.captureViewportPixels();
                return { width: image.width, height: image.height, rgba: Array.from(image.rgba), counters: api.getCounters() };
            });
            const image = new PNG({ width: raw.width, height: raw.height });
            const bytes = Buffer.from(raw.rgba), stride = raw.width * 4;
            for (let y = 0; y < raw.height; y++) {
                bytes.copy(image.data, y * stride, (raw.height - 1 - y) * stride, (raw.height - y) * stride);
            }
            await writeFile(path.join(out, `${backend}-${label}.png`), PNG.sync.write(image));
            let green = 0;
            for (let i = 0; i < image.data.length; i += 4) {
                if (image.data[i + 1] > 200 && image.data[i] < 20 && image.data[i + 2] < 20) green++;
            }
            return { image, green, counters: raw.counters };
        };
        for (const scale of [1, 3]) {
            await page.evaluate(async scale => {
                const { api } = window.__estellaHeadless;
                await api.setField(1, 'Transform', 'position', '', { x: -300 * scale, y: 0, z: 0 });
                await api.setField(1, 'Transform', 'scale', '', { x: scale, y: scale, z: scale });
                await api.setField(1, 'MeshRenderer', 'enabled', '', true);
                await api.setField(2, 'MeshRenderer', 'enabled', '', false);
                api.setMeshPlacements(2, [scale, 0, 0, -300 * scale, 0, scale, 0, 0, 0, 0, scale, 0, 1, 1, 1, 1]);
            }, scale);
            const individual = await capture(`scale-${scale}-individual`);
            assert.ok(individual.green > 1000, 'The individual deformed mesh must be visible');
            await page.evaluate(async () => {
                const { api } = window.__estellaHeadless;
                await api.setField(1, 'MeshRenderer', 'enabled', '', false);
                await api.setField(2, 'MeshRenderer', 'enabled', '', true);
            });
            const placements = await capture(`scale-${scale}-instances`);
            let changed = 0;
            for (let i = 0; i < individual.image.data.length; i += 4) {
                if ([0, 1, 2].some(c => individual.image.data[i + c] !== placements.image.data[i + c])) changed++;
            }
            report.checks.push({ backend, scale, individualGreen: individual.green, instancesGreen: placements.green,
                changed, counters: placements.counters });
        }
        for (const test of [
            { name: 'coarse-bounds', reference: 3, placed: 4, record: [1, 0, 0, 350, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1] },
            { name: 'rotated-bounds', reference: 5, placed: 6, record: [0, -1, 0, 0, 1, 0, 0, 350, 0, 0, 1, 0, 1, 1, 1, 1] },
            { name: 'tight-bounds', reference: 5, placed: 6, outside: 1,
                record: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1,
                         1, 0, 0, 0, 0, 1, 0, 350, 0, 0, 1, 0, 1, 1, 1, 1] },
        ]) {
            await page.evaluate(async test => {
                const { api } = window.__estellaHeadless;
                await api.setField(0, 'Camera', 'projectionType', '', test.name === 'coarse-bounds' ? 0 : 1);
                if (test.name === 'tight-bounds') {
                    await api.setField(5, 'Transform', 'position', '', { x: 0, y: 0, z: 0 });
                    await api.setField(5, 'Transform', 'rotation', '', { x: 0, y: 0, z: 0, w: 1 });
                }
                for (let id = 1; id <= 6; id++) await api.setField(id, 'MeshRenderer', 'enabled', '', id === test.reference);
                api.setMeshPlacements(test.placed, test.record);
            }, test);
            const individual = await capture(`${test.name}-individual`);
            assert.ok(individual.green > 20, 'The reference surface must intersect the view');
            await page.evaluate(async test => {
                const { api } = window.__estellaHeadless;
                await api.setField(test.reference, 'MeshRenderer', 'enabled', '', false);
                await api.setField(test.placed, 'MeshRenderer', 'enabled', '', true);
            }, test);
            const placements = await capture(`${test.name}-instances`);
            let changed = 0;
            for (let i = 0; i < individual.image.data.length; i += 4) {
                if ([0, 1, 2].some(c => Math.abs(individual.image.data[i + c] - placements.image.data[i + c]) > 2)) changed++;
            }
            report.checks.push({ backend, name: test.name, individualGreen: individual.green,
                instancesGreen: placements.green, changed, counters: placements.counters,
                correctCull: placements.counters['render.placements.outside'] === (test.outside ?? 0) });
        }
        assert.deepEqual(errors, []);
        await page.close();
    }
    assert.ok(report.checks.every(row => row.changed === 0 && row.correctCull !== false),
        'Instancing must preserve visible geometry and reject placements outside the view');
    report.status = 'checks-passed';
    console.log(JSON.stringify(report));
} catch (error) {
    report.error = String(error);
    throw error;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
