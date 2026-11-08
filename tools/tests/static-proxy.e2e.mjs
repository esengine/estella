// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    static-proxy.e2e.mjs
 * @brief   Render baked cluster geometry with the engine on both graphics backends.
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serveHost } from '../lib/staticServer.mjs';
import { requireCurrentEngine } from '../lib/engineBuild.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'output/static-proxy');
const { PNG } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('pngjs');
requireCurrentEngine(root, path.join(root, 'build/render-host/wasm'));
await mkdir(out, { recursive: true });
await build({ entryPoints: [path.join(root, 'tools/fixtures/static-proxy.ts')], outfile: path.join(out, 'fixture.mjs'),
    bundle: true, format: 'esm', platform: 'node', alias: { esengine: path.join(root, 'sdk/dist/index.node.js') } });
const fixture = await (await import(pathToFileURL(path.join(out, 'fixture.mjs')).href)).staticProxyFixture();
assert.ok(fixture.statistics.groups < fixture.statistics.sources);
assert.ok(fixture.statistics.coarseTriangles < fixture.statistics.fullTriangles);
const server = await serveHost(path.join(root, 'build/render-host'));
const browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
assert.ok(!(process.argv.includes('--webgl-only') && process.argv.includes('--webgpu-only')));
const backends = process.argv.includes('--webgl-only') ? ['webgl2'] : process.argv.includes('--webgpu-only') ? ['webgpu'] : ['webgl2', 'webgpu'];
const report = { status: 'failed', statistics: fixture.statistics, cases: [] };
try {
    for (const backend of backends) {
        const page = await browser.newPage({ viewport: { width: 640, height: 400 } }), errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.route('**/proxy/**', route => {
            const name = new URL(route.request().url()).pathname;
            return route.fulfill(name.endsWith('.esscene') ? { json: fixture.scene }
                : { contentType: 'application/octet-stream', body: Buffer.from(fixture.assets[name]) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/?w=640&h=400&backend=${backend}`);
        await page.evaluate(async () => { await window.__estellaHeadless.ready; });
        const loaded = await page.evaluate(() => window.__estellaHeadless.api.loadScene('/proxy/fixture.esscene'));
        assert.deepEqual(loaded.missing, []);
        const capture = async label => {
            const raw = await page.evaluate(async () => {
                const { api } = window.__estellaHeadless;
                await api.step(3); await api.waitForShaders(); await api.step(2);
                const pixels = await api.captureViewportPixels();
                return { width: pixels.width, height: pixels.height, rgba: Array.from(pixels.rgba) };
            });
            const image = new PNG({ width: raw.width, height: raw.height }), data = Buffer.from(raw.rgba), stride = raw.width * 4;
            for (let y = 0; y < raw.height; y++) data.copy(image.data, y * stride, (raw.height - y - 1) * stride, (raw.height - y) * stride);
            await writeFile(path.join(out, `${backend}-${label}.png`), PNG.sync.write(image));
            return image;
        };
        const reference = await capture('detail');
        let cyan = 0, red = 0;
        for (let i = 0; i < reference.data.length; i += 4) {
            const [r, g, b] = reference.data.subarray(i, i + 3);
            if (g > r * 1.5 && b > r * 1.5 && g > 40) cyan++;
            if (r > g * 2 && r > b * 2 && r > 40) red++;
        }
        assert.ok(cyan > 1000 && red > 500, `Both material groups must render: cyan=${cyan}, red=${red}`);
        for (const [label, ids] of [['exact', fixture.exactIds], ['coarse', fixture.coarseIds]]) {
            await page.evaluate(({ full, exact, coarse, active }) => {
                const api = window.__estellaHeadless.api;
                for (const id of [...full, ...exact, ...coarse]) api.setField(id, 'MeshRenderer', 'enabled', '', active.includes(id));
            }, { full: fixture.fullIds, exact: fixture.exactIds, coarse: fixture.coarseIds, active: ids });
            const proxy = await capture(label);
            let changed = 0, sum = 0, over8 = 0;
            for (let i = 0; i < reference.data.length; i += 4) {
                let max = 0;
                for (let c = 0; c < 3; c++) { const d = Math.abs(reference.data[i + c] - proxy.data[i + c]); sum += d; max = Math.max(max, d); }
                if (max) changed++; if (max > 8) over8++;
            }
            const pixels = reference.width * reference.height, meanChannel = sum / (pixels * 3);
            report.cases.push({ backend, label, changed, over8, pixels, meanChannel });
            assert.ok(meanChannel < (label === 'exact' ? 0.1 : 1), `${backend} ${label} changed average color by ${meanChannel}`);
            assert.ok(over8 < pixels * (label === 'exact' ? 0.001 : 0.02), `${backend} ${label} changed ${over8} significant pixels`);
        }
        assert.deepEqual(errors, []); await page.close();
    }
    report.status = 'checks-passed';
} catch (error) { report.error = String(error); throw error; }
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(JSON.stringify(report));
