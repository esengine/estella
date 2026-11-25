// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { HOST_PAGE } from '../launchers/minigameHost.mjs';
import { ROOT } from '../lib/repo.mjs';
import { serveDir } from '../lib/staticServer.mjs';

const scenePath = 'assets/scenes/main.esscene';
const dimensions = ['2D', '3D'];

async function writeScene(project) {
    const entities = dimensions.map((dim, id) => ({
        id, name: dim, parent: null, children: [], visible: true,
        components: [
            { type: 'Transform', data: { position: { x: 0, y: 50, z: 0 } } },
            { type: 'RigidBody' + dim, data: { bodyType: 2, gravityScale: 1 } },
            { type: 'BoxCollider' + dim, data: { halfExtents: dim === '2D' ? { x: 5, y: 5 } : { x: 5, y: 5, z: 5 } } },
        ],
    }));
    const scene = path.join(project, scenePath);
    await fs.mkdir(path.dirname(scene), { recursive: true });
    await fs.writeFile(scene, JSON.stringify({ version: 4, name: 'Main', entities }));
    await fs.writeFile(scene + '.meta', JSON.stringify({
        version: '2.0', uuid: 'bfcceac6-6388-4e05-8484-e53de7022056', type: 'scene', importer: {},
    }));
    await fs.mkdir(path.join(project, 'src'));
    await fs.writeFile(path.join(project, 'src/main.ts'), `
import { addPlugin, Transform } from 'esengine';
addPlugin({ name: 'ReadPhysicsPositions', build({ world }) {
    globalThis.readBodyHeight = (name) => {
        const id = world.findEntityByName(name);
        return id == null ? null : world.get(id, Transform).position.y;
    };
}});
`);
}

async function checkPackage(browser, dir, platform, solver) {
    const wechat = platform === 'wechat';
    const suffix = wechat ? '.wasm.br' : '.wasm';
    const modules = ['physics', solver === 'physx' ? 'physics3d-physx' : 'physics3d'];
    const files = (await fs.readdir(path.join(dir, 'wasm'))).filter(name => name.startsWith('physics'));
    assert.deepEqual(files.sort(), modules.flatMap(file => [file + '.js', file]).sort());
    const { subPackages } = JSON.parse(await fs.readFile(path.join(dir, 'game.json'), 'utf8'));
    for (const file of modules) {
        assert.ok(subPackages.some(pkg => pkg.root === 'wasm/' + file));
        assert.deepEqual((await fs.readdir(path.join(dir, 'wasm', file))).sort(), ['game.js', file + suffix]);
    }

    const shell = HOST_PAGE('game.js', null, { hostGlobal: wechat ? 'wx' : 'tt', subpackages: subPackages });
    const server = await serveDir(dir, {
        route: rel => rel === '' ? { body: shell } : null,
        shape: ({ rel }) => rel.endsWith('.br') ? { headers: { 'content-encoding': 'br' } } : null,
    });
    const page = await browser.newPage();
    try {
        const requests = new Set();
        const errors = [];
        page.on('request', r => requests.add(new URL(r.url()).pathname));
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => {
            if (msg.type() === 'error' && !msg.location().url.endsWith('/favicon.ico')) errors.push(msg.text());
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const first = await page.waitForFunction(names => {
            const ys = names.map(name => globalThis.readBodyHeight?.(name));
            return ys.every(Number.isFinite) && ys;
        }, dimensions, { timeout: 30_000 });
        const initial = await first.jsonValue();
        const fallen = await page.waitForFunction(({ names, initial }) => {
            const ys = names.map(name => globalThis.readBodyHeight(name));
            return ys.every((y, i) => Number.isFinite(y) && y < Math.min(48, initial[i] - 1)) && ys;
        }, { names: dimensions, initial }, { timeout: 30_000 });
        for (const file of modules) assert.ok(requests.has(`/wasm/${file}/${file}${suffix}`), file);
        assert.deepEqual(errors, []);
        console.log(`${platform} ${solver}: Box2D and ${solver} heights ${initial} → ${await fallen.jsonValue()}`);
    } finally {
        await page.close();
        await new Promise(resolve => server.close(resolve));
    }
}

const root = await fs.mkdtemp(path.join(tmpdir(), 'estella-minigame-physics-'));
let browser;
try {
    const project = path.join(root, 'project');
    await writeScene(project);
    browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-swiftshader'] });
    for (const platform of ['wechat', 'douyin']) {
        const dir = path.join(root, platform);
        for (const solver of ['jolt', 'physx']) {
            await fs.writeFile(path.join(project, 'project.esproject'), JSON.stringify({
                formatVersion: '1', name: 'Mini-game physics', defaultScene: scenePath,
                features: solver === 'physx' ? { physics: { backend3d: solver } } : {},
                packaging: { engineSubpackage: true, compressWasm: true },
            }));
            // Re-export into the same directory to catch a stale solver after switching.
            const report = path.join(root, 'export.json');
            execFileSync(process.execPath, ['pipeline/bin/estella.mjs', 'export', project,
                '--platform', platform, '--out', dir, '--no-aot', '--enforce-budget', '--json', report],
                { cwd: ROOT, windowsHide: true });
            const { size } = JSON.parse(await fs.readFile(report, 'utf8'));
            console.log(`${platform} ${solver} main package: ${size.initialBytes} bytes`);
            await checkPackage(browser, dir, platform, solver);
        }
    }
} finally {
    await browser?.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
