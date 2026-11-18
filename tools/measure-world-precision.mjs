// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    measure-world-precision.mjs
 * @brief   How far from the origin a 3D world stays precise: the same probe scene exported at each distance and measured in a
 *          package in headless Chromium.
 *
 * @details At each distance (world units; the default 3D scale is 100 to a metre) it measures a child's world position under a
 *          moving, turning parent against the exact value; a frictionless box pushed at 300 units/s, whose every step should be
 *          exactly 5; and a route round a wall across a baked navmesh, its length and corners against the origin's.
 *
 *          node tools/measure-world-precision.mjs [0,100000,1000000,5000000,10000000]
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
const HERE = path.join(ROOT, 'tools/fixtures/world-precision');
const require = createRequire(path.join(ROOT, 'pipeline/package.json'));
const { chromium } = require('playwright');
const { serveDir } = await import('./lib/serveDir.mjs');

const tf = (x, y, z, extra = {}) => ({ type: 'Transform', data: { position: { x, y, z }, ...extra } });
function scene(O) {
    const e = (id, name, components, parent = null, children = []) => ({ id, name, parent, children, visible: true, components });
    return { version: 4, name: 'main', entities: [
        e(1, 'Floor', [tf(O, -50, O), { type: 'RigidBody3D', data: { bodyType: 0 } }, { type: 'BoxCollider3D', data: { halfExtents: { x: 2000, y: 50, z: 2000 } } },
            { type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: true, opaque: true } }]),
        e(2, 'Box', [tf(O, 100, O), { type: 'RigidBody3D', data: { bodyType: 2 } }, { type: 'BoxCollider3D', data: { halfExtents: { x: 50, y: 50, z: 50 } } },
            { type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: true, opaque: true } }]),
        e(3, 'Arm', [tf(O, 300, O)], null, [4]),
        e(8, 'Slider', [tf(O - 1000, 50, O + 800), { type: 'RigidBody3D', data: { bodyType: 2, linearDamping: 0, fixedRotation: true } },
            { type: 'BoxCollider3D', data: { halfExtents: { x: 50, y: 50, z: 50 }, friction: 0 } }]),
        e(9, 'Wall', [tf(O, 100, O), { type: 'RigidBody3D', data: { bodyType: 0 } }, { type: 'BoxCollider3D', data: { halfExtents: { x: 40, y: 100, z: 300 } } }]),
        e(4, 'Hand', [tf(50, 0, 0)], 3),
        e(5, 'NavVolume', [tf(O, 0, O), { type: 'NavVolume', data: { halfExtents: { x: 1500, y: 200, z: 1500 }, cellSize: 10, cellHeight: 5,
            agentRadius: 20, agentHeight: 150, stepHeight: 30 } }]),
        e(6, 'Camera', [tf(O, 600, O + 1500, { rotation: { x: -0.2, y: 0, z: 0, w: 0.98 } }), { type: 'Camera', data: { isActive: true, projectionType: 0, fov: 60, nearPlane: 1, farPlane: 10000 } }]),
        e(7, 'Sun', [tf(0, 0, 0, { rotation: { x: -0.38, y: 0, z: 0, w: 0.92 } }), { type: 'Light', data: { type: 1, intensity: 2 } }]),
    ] };
}

function build(O) {
    const dir = path.join(ROOT, 'output/precision', String(O));
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    const project = path.join(dir, 'project');
    mkdirSync(path.join(project, 'assets/scenes'), { recursive: true });
    mkdirSync(path.join(project, 'src'), { recursive: true });
    writeFileSync(path.join(project, 'project.esproject'), JSON.stringify({ formatVersion: '1', name: 'Precision', defaultScene: 'assets/scenes/main.esscene',
        designResolution: { width: 640, height: 360 } }));
    writeFileSync(path.join(project, 'assets/scenes/main.esscene'), JSON.stringify(scene(O)));
    writeFileSync(path.join(project, 'assets/scenes/main.esscene.meta'), JSON.stringify({ uuid: '7a1c4e2b-0d3f-4b5a-9c8e-1f2a3b4c5d6e', version: '2.0', type: 'scene', importer: {} }));
    writeFileSync(path.join(project, 'src/main.ts'), readFileSync(path.join(HERE, 'probe.ts')));
    writeFileSync(path.join(project, 'tsconfig.json'), readFileSync(path.join(ROOT, 'examples/world-streaming-3d/tsconfig.json')));
    const out = path.join(dir, 'web');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'pipeline/bin/estella.mjs'), 'export', project, '--platform', 'web', '--out', out], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error(`export at ${O} failed\n${(r.stdout + r.stderr).slice(-1500)}`);
    return out;
}

const stats = (xs) => {
    if (xs.length === 0) return null;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { mean, max: Math.max(...xs), sd: Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) };
};
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
const rows = [];
for (const O of (process.argv[2] ?? '0,100000,1000000,5000000,10000000').split(',').map(Number)) {
    const server = await serveDir(build(O));
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`);
    for (let i = 0; i < 900; i++) {
        if (await page.evaluate(() => !!window.__estellaCooked?.step && !!window.__precision).catch(() => false)) break;
        await new Promise((d) => setTimeout(d, 100));
    }
    await page.evaluate(() => window.__estellaCooked.setPaused(true));
    for (let i = 0; i < 10; i++) await page.evaluate(() => window.__estellaCooked.step(60, 1 / 60));
    const p = await page.evaluate(() => window.__precision);
    const ys = p.box.map((b) => b.y), xs = p.box.map((b) => b.x - O), zs = p.box.map((b) => b.z - O);
    const row = {
        metres: O / 100,
        restY: stats(ys), driftXZ: p.box.length ? Math.hypot(xs.at(-1) - xs[0], zs.at(-1) - zs[0]) : null,
        jitterY: stats(ys) ? stats(ys).max - Math.min(...ys) : null,
        hierarchy: stats(p.hierarchyError), route: p.route, frames: p.frame, errors,
        sliderStep: p.slider.length > 2 ? stats(p.slider.slice(1).map((q, i) => Math.abs((q.x - p.slider[i].x) - 5))) : null,
        sliderY: p.slider.length ? Math.max(...p.slider.map((q) => q.y)) - Math.min(...p.slider.map((q) => q.y)) : null,
        sliderZ: p.slider.length ? Math.max(...p.slider.map((q) => Math.abs(q.z - O - 800))) : null,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    await page.close(); server.close();
}
await browser.close();
writeFileSync(path.join(ROOT, 'output/precision/results.json'), JSON.stringify(rows, null, 1));
