// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    composite-batch.e2e.mjs
 * @brief   Exercise mixed batching, root motion, local edits and shadow-state changes.
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serveHost } from '../lib/staticServer.mjs';
import { requireCurrentEngine } from '../lib/engineBuild.mjs';
import { compositeShip } from '../lib/compositeShip.mjs';

const { PNG } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('pngjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const host = path.join(root, 'build/render-host');
const out = path.join(root, 'output/composite-batch');
assert.ok(!(process.argv.includes('--webgl-only') && process.argv.includes('--webgpu-only')), 'Choose one backend filter');
const backends = process.argv.includes('--webgl-only') ? ['webgl2']
    : process.argv.includes('--webgpu-only') ? ['webgpu'] : ['webgl2', 'webgpu'];
requireCurrentEngine(root, path.join(host, 'wasm'));
await mkdir(out, { recursive: true });
const base = JSON.parse(await readFile(path.join(root, 'examples/device-quality/assets/scenes/main.esscene'), 'utf8'));
const furniture = base.entities.filter(entity => ['Camera', 'Lamp', 'Ambient', 'Floor'].includes(entity.name));
assert.equal(furniture.find(entity => entity.name === 'Lamp').components.find(c => c.type === 'Light').data.meshShadows, true);
const camera = furniture.find(entity => entity.name === 'Camera');
const authoredCamera = structuredClone(camera.components);
const yaw = Math.atan2(5, 7), pitch = -Math.atan2(4.5, Math.hypot(5, 7));
Object.assign(camera.components.find(c => c.type === 'Transform').data, {
    position: { x: 5, y: 4.5, z: 7 },
    rotation: { x: Math.sin(pitch / 2) * Math.cos(yaw / 2), y: Math.cos(pitch / 2) * Math.sin(yaw / 2),
        z: -Math.sin(pitch / 2) * Math.sin(yaw / 2), w: Math.cos(pitch / 2) * Math.cos(yaw / 2) },
});
Object.assign(camera.components.find(c => c.type === 'Camera').data, { fov: 48, farPlane: 40 });
if (process.argv.includes('--authored-camera')) camera.components = authoredCamera;
const ship = compositeShip();
const extra = structuredClone(ship.find(entity => entity.name === 'Barrel'));
extra.id = 2000; extra.name = 'Extra barrel'; extra.parent = null;
extra.components.find(c => c.type === 'Transform').data.position.z = 0.4;
extra.components.find(c => c.type === 'MeshRenderer').data.enabled = false;
const scene = { ...base, entities: [...furniture, ...ship, extra] };
const partIds = ship.filter(entity => entity.id !== 1000).map(entity => entity.id);
const nonCasters = [...ship.filter(entity => (/^(Plank|Post)/.test(entity.name) && entity.id % 2 === 0)
    || ['Barrel', 'Funnel'].includes(entity.name)).map(entity => entity.id), 2000];
const server = await serveHost(host);
const browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
const report = { status: 'failed', checks: [], backends: [] };
try {
    for (const backend of backends) {
        const page = await browser.newPage({ viewport: { width: 512, height: 384 } });
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.route('**/scenes/composite-ship.esscene', route => route.fulfill({ json: scene }));
        await page.goto(`http://127.0.0.1:${server.address().port}/?w=512&h=384&backend=${backend}`);
        await page.evaluate(async () => { await window.__estellaHeadless.ready; });
        const loaded = await page.evaluate(() => window.__estellaHeadless.api.loadScene('/scenes/composite-ship.esscene'));
        assert.deepEqual(loaded.missing, []);
        await page.evaluate(() => { const { api } = window.__estellaHeadless; api.setRunMode(true); api.setCpuProfiling(true); });
        const settle = async (parts, sets = null) => page.evaluate(async ({ parts, sets }) => {
            const { api } = window.__estellaHeadless;
            for (let i = 0; i < 90; i++) {
                await api.step(2);
                const state = api.compositeBatchReport(1000);
                if (!state.busy && (parts === 0 ? state.report === null : state.report?.parts === parts)
                    && (sets === null || state.report?.sets === sets)) return state;
            }
            throw new Error(`Composite did not settle: ${JSON.stringify(api.compositeBatchReport(1000))}`);
        }, { parts, sets });
        const toggle = async (on, parts = 108) => {
            await page.evaluate(on => window.__estellaHeadless.api.setComponent(1000, 'CompositeBatch', on ? { instanceMin: 4, cellSize: 2 } : null), on);
            return settle(on ? parts : 0);
        };
        const capture = async label => {
            const raw = await page.evaluate(async () => {
                const { api } = window.__estellaHeadless;
                await api.step(3);
                if (!await api.waitForShaders()) throw new Error('Shader compilation did not finish');
                await api.step(2);
                const pixels = await api.captureViewportPixels();
                return { width: pixels.width, height: pixels.height, rgba: Array.from(pixels.rgba), counters: api.getCounters() };
            });
            const image = new PNG({ width: raw.width, height: raw.height });
            const bytes = Buffer.from(raw.rgba), stride = raw.width * 4;
            for (let y = 0; y < raw.height; y++) bytes.copy(image.data, y * stride, (raw.height - y - 1) * stride, (raw.height - y) * stride);
            await writeFile(path.join(out, `${backend}-${label}.png`), PNG.sync.write(image));
            return { image, counters: raw.counters };
        };
        const compare = (name, a, b) => {
            let changed = 0, maxChannel = 0, sum = 0;
            for (let i = 0; i < a.image.data.length; i += 4) {
                const differences = [0, 1, 2].map(c => Math.abs(a.image.data[i + c] - b.image.data[i + c]));
                const delta = Math.max(...differences);
                if (delta > 4) changed++;
                maxChannel = Math.max(maxChannel, delta);
                sum += differences.reduce((x, y) => x + y, 0);
            }
            const row = { backend, name, changed, fraction: changed / (a.image.width * a.image.height), maxChannel,
                meanChannel: sum / (a.image.width * a.image.height * 3) };
            report.checks.push(row); console.log(JSON.stringify(row));
        };
        await settle(0);
        const plain = await capture('plain');
        const colours = new Set();
        for (let i = 0; i < plain.image.data.length; i += 12) {
            colours.add((plain.image.data[i] >> 4) << 8 | (plain.image.data[i + 1] >> 4) << 4 | (plain.image.data[i + 2] >> 4));
        }
        assert.ok(colours.size > 40, 'The reference must show the shaded model rather than a flat frame');
        const initial = await toggle(true);
        const batched = await capture('batched');
        compare('initial', plain, batched);
        assert.equal(initial.report.sets, 2);
        assert.equal(initial.report.chunks, 2);
        assert.equal(initial.component.instanced, 104);
        assert.ok(plain.counters['render.meshes'] > 40 && batched.counters['render.meshes'] < plain.counters['render.meshes'] / 10);

        await page.evaluate(() => {
            const { api } = window.__estellaHeadless;
            api.setField(1000, 'Transform', 'position', '', { x: 1.5, y: 0, z: 0 }); api.refreshComposite(1000);
        });
        const moved = await settle(108);
        assert.equal(moved.counts.merges, initial.counts.merges);
        assert.deepEqual(moved.holders, initial.holders);
        const movedBatch = await capture('moved-batched');
        await toggle(false);
        compare('moved', await capture('moved-plain'), movedBatch);

        const beforeEdit = await toggle(true);
        await page.evaluate(() => {
            const { api } = window.__estellaHeadless;
            api.setParent(2000, 1000); api.setField(2000, 'MeshRenderer', 'enabled', '', true); api.refreshComposite(1000);
        });
        const edited = await settle(109);
        assert.equal(edited.counts.merges - beforeEdit.counts.merges, 1);
        const chunks = state => state.holders.filter(holder => /chunk/.test(holder.name)).map(holder => holder.mesh);
        assert.equal(chunks(edited).filter(mesh => chunks(beforeEdit).includes(mesh)).length, 1);
        const editedBatch = await capture('edited-batched');
        const restored = await toggle(false);
        assert.equal(restored.visibleParts, 109); assert.equal(restored.holders.length, 0);
        const editedPlain = await capture('edited-plain');
        compare('edited', editedPlain, editedBatch);

        await toggle(true, 109);
        await page.evaluate(ids => {
            const { api } = window.__estellaHeadless;
            for (const id of ids) api.setField(id, 'MeshRenderer', 'castShadows', '', false);
        }, nonCasters);
        const mixed = await settle(109, 4);
        assert.equal(mixed.holders.filter(holder => /chunk/.test(holder.name) && !holder.castShadows).length, 1);
        assert.equal(mixed.holders.filter(holder => /chunk/.test(holder.name) && holder.castShadows).length, 1);
        const mixedBatch = await capture('mixed-batched');
        await toggle(false);
        const mixedPlain = await capture('mixed-plain');
        compare('mixed-shadow-state', mixedPlain, mixedBatch);

        await toggle(true, 109);
        await page.evaluate(ids => {
            const { api } = window.__estellaHeadless;
            for (const id of ids) api.setField(id, 'MeshRenderer', 'castShadows', '', true);
        }, nonCasters);
        const shadowRestored = await settle(109, 2);
        assert.equal(shadowRestored.report.sets, 2);
        compare('restored-shadow-state', editedPlain, await capture('shadow-restored'));
        await toggle(false);
        await page.evaluate(ids => {
            for (const id of ids) window.__estellaHeadless.api.setField(id, 'MeshRenderer', 'castShadows', '', false);
        }, nonCasters);

        await page.evaluate(ids => { for (const id of ids) window.__estellaHeadless.api.setComponent(id, 'StaticBatch', {}); }, [...partIds, 2000]);
        const staticBatch = await page.evaluate(async () => {
            const { api } = window.__estellaHeadless;
            for (let i = 0; i < 100; i++) {
                await api.step(2);
                const state = api.staticBatchReport();
                if (state && state.groups.reduce((sum, group) => sum + group.partCount, 0) >= 100) return state;
            }
            throw new Error(`Static batch did not settle: ${JSON.stringify(api.staticBatchReport())}`);
        });
        assert.deepEqual(staticBatch.refused, []);
        assert.equal(new Set(staticBatch.groups.flatMap(group => group.parts)).size, 109);
        compare('static-mixed-shadow-state', mixedPlain, await capture('static-batched'));
        report.backends.push({ backend, initial, moved, edited, mixed, shadowRestored, staticBatch,
            visibleColours: colours.size, plainMeshes: plain.counters['render.meshes'], batchedMeshes: batched.counters['render.meshes'],
            shadowStateSeparated: mixed.report.sets === 4 && staticBatch.groups.every(group => group.partCastShadows.every(value => value === group.holderCastShadows)) });
        assert.deepEqual(errors, []);
        await page.close();
    }
    assert.ok(report.backends.every(row => row.shadowStateSeparated), 'Batching must preserve each part shadow policy');
    assert.ok(report.checks.every(row => row.fraction <= 0.001), 'Batching must preserve the visible geometry and shadows');
    report.status = 'checks-passed';
} catch (error) {
    report.error = String(error); throw error;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
