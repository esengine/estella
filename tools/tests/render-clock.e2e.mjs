// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    render-clock.e2e.mjs
 * @brief   Verify scaled and paused shader time across sprite and mesh rendering.
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
const out = path.join(repo, 'output/render-clock');
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
        report.activeBackend = backend;
        report.errors = errors;
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto(`http://127.0.0.1:${server.address().port}/?w=256&h=256&backend=${backend}`);
        await page.evaluate(async () => { await window.__estellaHeadless.ready; });
        const loaded = await page.evaluate(() => window.__estellaHeadless.api.loadScene('/scenes/render-clock.esscene'));
        assert.deepEqual(loaded.missing, []);
        const frames = [];
        const capture = async (label, expected) => {
            const raw = await page.evaluate(async () => {
                const { api, clock } = window.__estellaHeadless;
                const state = clock.state();
                clock.pause(true);
                try {
                    const image = await api.captureViewportPixels();
                    return { state, width: image.width, height: image.height, rgba: Array.from(image.rgba) };
                } finally {
                    clock.pause(state.paused);
                }
            });
            assert.ok(Math.abs(raw.state.elapsed - expected) < 1e-6, `${label}: simulation clock`);
            assert.ok(Math.abs(raw.state.renderElapsed - expected) < 1e-6, `${label}: render clock`);
            const image = new PNG({ width: raw.width, height: raw.height });
            const bytes = Buffer.from(raw.rgba), stride = raw.width * 4;
            for (let y = 0; y < raw.height; y++) {
                bytes.copy(image.data, y * stride, (raw.height - 1 - y) * stride, (raw.height - y) * stride);
            }
            await writeFile(path.join(out, `${backend}-${label}.png`), PNG.sync.write(image));
            const want = [Math.round((expected % 1) * 255), Math.round((1 - expected % 1) * 255), 0];
            const pixels = [64, 192].map(x => Array.from(image.data.subarray((128 * 256 + x) * 4, (128 * 256 + x) * 4 + 3)));
            for (const pixel of pixels) {
                for (let c = 0; c < 3; c++) {
                    assert.ok(Math.abs(pixel[c] - want[c]) <= 2, `${label}: sprite/mesh ${pixel}, expected ${want}`);
                }
            }
            frames.push({ label, ...raw.state, pixels });
            return image;
        };
        await page.evaluate(async () => {
            const { api, clock } = window.__estellaHeadless;
            clock.pause(true);
            await api.step(3, 0.2);
        });
        assert.equal(await page.evaluate(() => window.__estellaHeadless.api.waitForShaders()), true,
            'scene shader variants must finish compiling');
        await page.evaluate(() => window.__estellaHeadless.api.step(1, 0.2));
        await capture('cold-paused', 0);
        await page.evaluate(() => window.__estellaHeadless.clock.step(0.25));
        const held = await capture('stepped', 0.25);
        await page.waitForTimeout(200);
        await page.evaluate(() => window.__estellaHeadless.api.step(3, 0.2));
        const later = await capture('paused-later', 0.25);
        assert.deepEqual(later.data, held.data, 'paused redraws must preserve the entire picture');
        await page.evaluate(async () => {
            const { clock } = window.__estellaHeadless;
            clock.scale(0.5);
            await clock.step(0.2);
        });
        await capture('half-speed-step', 0.35);
        await page.evaluate(async () => {
            const { api, clock } = window.__estellaHeadless;
            clock.pause(false);
            await api.step(1, 0.2);
        });
        const scaled = await capture('half-speed-running', 0.45);
        await page.evaluate(async () => {
            const { api, clock } = window.__estellaHeadless;
            clock.scale(0);
            await api.step(2, 0.2);
        });
        const zero = await capture('zero-scale', 0.45);
        assert.deepEqual(zero.data, scaled.data, 'zero scale must freeze both rendering paths');
        await page.evaluate(async () => {
            const { api, clock } = window.__estellaHeadless;
            clock.scale(1);
            await api.step(1, 0.1);
        });
        await capture('resumed', 0.55);
        await page.evaluate(async () => {
            const { api, clock } = window.__estellaHeadless;
            clock.pause(true);
            await api.setField(0, 'Camera', 'projectionType', '', 0);
            await api.step(1, 0.1);
        });
        await capture('perspective-paused', 0.55);
        await page.evaluate(async () => {
            const { api, clock } = window.__estellaHeadless;
            api.useEditorView(true);
            clock.pause(false);
            await api.step(1, 0.1);
        });
        await capture('editor-preview', 0.65);
        assert.deepEqual(errors, []);
        report.checks.push({ backend, frames, errors });
        await page.close();
    }
    report.status = 'checks-passed';
    delete report.activeBackend;
    console.log(JSON.stringify(report));
} catch (error) {
    report.error = String(error);
    throw error;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
