// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    placement-shadows.e2e.mjs
 * @brief   Compare shadow coverage before and after native mesh instancing.
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serveHost } from '../lib/staticServer.mjs';
import { requireCurrentEngine } from '../lib/engineBuild.mjs';

const { PNG } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('pngjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const host = path.join(root, 'build/render-host');
const out = path.join(root, 'output/placement-shadows');
requireCurrentEngine(root, path.join(host, 'wasm'));
await mkdir(out, { recursive: true });
const server = await serveHost(host);
const browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
const report = { status: 'failed', checks: [] };
try {
    for (const backend of process.argv.includes('--webgl-only') ? ['webgl2'] : ['webgl2', 'webgpu']) {
        const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        for (const scene of ['mesh-shadow', 'mesh-shadow-perspective', 'mesh-shadow-cascade', 'mesh-shadow-caster-behind',
            'mesh-shadow-tilt-sun', 'point-shadow-pair', 'spot-shadow', 'placement-shadow-bend']) {
            // Scene loading appends entities, so each independent fixture gets a fresh world.
            await page.goto(`http://127.0.0.1:${server.address().port}/?w=256&h=256&backend=${backend}`);
            await page.evaluate(async () => { await window.__estellaHeadless.ready; });
            const document = JSON.parse(await readFile(path.join(root, 'fixtures/scenes', `${scene}.esscene`), 'utf8'));
            const meshes = document.entities.filter(entity => entity.components.some(c => c.type === 'MeshRenderer'));
            assert.ok(meshes.every(entity => entity.parent == null), 'The fixture conversion requires unparented meshes');
            const loaded = await page.evaluate(scene => window.__estellaHeadless.api.loadScene(`/scenes/${scene}.esscene`), scene);
            assert.deepEqual(loaded.missing, []);
            const capture = async suffix => {
                const raw = await page.evaluate(async () => {
                    const { api } = window.__estellaHeadless;
                    await api.step(2);
                    if (!await api.waitForShaders()) throw new Error('Shader compilation did not finish');
                    await api.step(2);
                    const image = await api.captureViewportPixels();
                    return { width: image.width, height: image.height, rgba: Array.from(image.rgba) };
                });
                const image = new PNG({ width: raw.width, height: raw.height });
                const bytes = Buffer.from(raw.rgba), stride = raw.width * 4;
                for (let y = 0; y < raw.height; y++) bytes.copy(image.data, y * stride, (raw.height - y - 1) * stride, (raw.height - y) * stride);
                await writeFile(path.join(out, `${backend}-${scene}-${suffix}.png`), PNG.sync.write(image));
                return image.data;
            };
            const reference = await capture('individual');
            const shadowPresent = scene === 'placement-shadow-bend' ? reference[(128 * 256 + 128) * 4] < 20 : undefined;
            await page.evaluate(async meshes => {
                const { api } = window.__estellaHeadless;
                for (const entity of meshes) {
                    const transform = entity.components.find(c => c.type === 'Transform')?.data ?? {};
                    const p = transform.position ?? { x: 0, y: 0, z: 0 };
                    const s = transform.scale ?? { x: 1, y: 1, z: 1 };
                    const q = transform.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
                    const { x, y, z, w } = q;
                    api.setMeshPlacements(entity.id, [
                        (1 - 2 * (y * y + z * z)) * s.x, 2 * (x * y - w * z) * s.y, 2 * (x * z + w * y) * s.z, p.x,
                        2 * (x * y + w * z) * s.x, (1 - 2 * (x * x + z * z)) * s.y, 2 * (y * z - w * x) * s.z, p.y,
                        2 * (x * z - w * y) * s.x, 2 * (y * z + w * x) * s.y, (1 - 2 * (x * x + y * y)) * s.z, p.z,
                        1, 1, 1, 1,
                    ]);
                    await api.setField(entity.id, 'Transform', 'position', '', { x: 0, y: 0, z: 0 });
                    await api.setField(entity.id, 'Transform', 'rotation', '', { x: 0, y: 0, z: 0, w: 1 });
                    await api.setField(entity.id, 'Transform', 'scale', '', { x: 1, y: 1, z: 1 });
                }
            }, meshes);
            const instances = await capture('instances');
            let changed = 0, maxChannel = 0, litPixels = 0;
            for (let i = 0; i < reference.length; i += 4) {
                const delta = Math.max(...[0, 1, 2].map(c => Math.abs(reference[i + c] - instances[i + c])));
                maxChannel = Math.max(maxChannel, delta);
                if (delta > 2) changed++;
                if (reference[i] > 100 && reference[i + 1] > 100 && reference[i + 2] > 100) litPixels++;
            }
            assert.ok(litPixels > 1000, 'The reference must contain a visible lit receiver');
            report.checks.push({ backend, scene, changed, maxChannel, shadowPresent });
            console.log(JSON.stringify(report.checks.at(-1)));
        }
        assert.deepEqual(errors, []);
        await page.close();
    }
    assert.ok(report.checks.every(row => row.changed === 0 && row.shadowPresent !== false),
        'Instancing must preserve shadow coverage, including deformed casters behind the camera');
    report.status = 'checks-passed';
} catch (error) {
    report.error = String(error);
    throw error;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
