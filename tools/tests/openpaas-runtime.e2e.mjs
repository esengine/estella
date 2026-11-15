// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Real exported engine and WebGL frames in a headless contract host. This does
// not emulate SUD's native renderer, audio or device-specific WebAssembly.
import fs from 'node:fs/promises';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { HOST_PAGE } from '../launchers/minigameHost.mjs';
import { runTool } from '../lib/runTool.mjs';
import { toolArgs } from '../lib/toolArgs.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARGS = toolArgs({ wasm: 'build/wasm/quickgame', out: 'output/openpaas-runtime', packer: null, 'project-2d': null, 'project-3d': null });
const wasm = path.resolve(ARGS.wasm);
const out = path.resolve(ARGS.out);
const packer = ARGS.packer;
await fs.mkdir(out, { recursive: true });
const project = await fs.mkdtemp(path.join(out, 'fixture-'));
const report = { status: 'failed', mode: 'headless-contract-host', deviceAcceptance: 'pending', scenes: [], packages: [], errors: [] };
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const { PNG } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('pngjs');
const entity = (id, name, components) => ({ id, name, parent: null, children: [], visible: true, components });
const component = (type, data) => ({ type, data });
let browser;
let secretDir;
try {
    let packageConfig;
    let encryptionKey;
    if (packer) {
        secretDir = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), 'estella-sud-test-keys-'));
        const pair = crypto.generateKeyPairSync('ed25519');
        await fs.writeFile(path.join(secretDir, 'private.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
        encryptionKey = crypto.randomBytes(16).toString('hex');
        await fs.writeFile(path.join(secretDir, 'encryption.hex'), encryptionKey, { mode: 0o600 });
        packageConfig = path.join(secretDir, 'package.json');
        await fs.writeFile(packageConfig, JSON.stringify({ mode: 'development', toolPath: path.resolve(packer),
            gameId: 'estella-local-test', version: '0.1.0', privateKeyPath: 'private.pem', encryptionKeyPath: 'encryption.hex' }));
    }
    await fs.mkdir(path.join(project, 'assets/scenes'), { recursive: true });
    await fs.mkdir(path.join(project, '.esengine/platforms'), { recursive: true });
    await fs.copyFile(path.join(repo, 'pipeline/platforms/openpaas.mjs'), path.join(project, '.esengine/platforms/openpaas.mjs'));
    await fs.writeFile(path.join(project, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'OpenPaaS contract fixture', defaultScene: 'assets/scenes/2d.esscene',
        designResolution: { width: 640, height: 360 },
    }));
    for (const dimension of ['2d', '3d']) {
        const scene = { version: 4, name: dimension, entities: [
            entity(0, 'Camera', [component('Transform', { position: { x: 0, y: 0, z: 5 } }),
                component('Camera', { projectionType: dimension === '2d' ? 1 : 0, orthoSize: 180, fov: 60,
                    nearPlane: 0.1, farPlane: 100, isActive: true, priority: 0 })]),
            entity(1, dimension === '2d' ? 'Sprite' : 'Cube', [component('Transform', dimension === '3d'
                ? { scale: { x: 0.01, y: 0.01, z: 0.01 } } : {}),
                component(dimension === '2d' ? 'Sprite' : 'MeshRenderer', dimension === '2d'
                    ? { size: { x: 160, y: 120 }, color: { r: 1, g: 0.3, b: 0.1, a: 1 } }
                    : { mesh: 'builtin:cube', enabled: true, lit: false, opaque: true,
                        color: { r: 0.1, g: 0.7, b: 1, a: 1 } })]),
        ] };
        const sceneFile = path.join(project, `assets/scenes/${dimension}.esscene`);
        await fs.writeFile(sceneFile, JSON.stringify(scene));
        await fs.writeFile(sceneFile + '.meta', JSON.stringify({ version: '2.0', type: 'scene', importer: {},
            uuid: dimension === '2d' ? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }));
    }
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'] });
    for (const dimension of ['2d', '3d']) {
        const authoredProject = ARGS[`project-${dimension}`];
        let exportProject = project;
        let sceneArgs = ['--scene', `assets/scenes/${dimension}.esscene`];
        if (authoredProject) {
            const original = path.resolve(authoredProject);
            exportProject = path.join(project, `authored-${dimension}`);
            await fs.cp(original, exportProject, { recursive: true,
                filter: file => !path.relative(original, file).split(path.sep).some(part => ['node_modules', '.esengine', 'dist'].includes(part)) });
            await fs.mkdir(path.join(exportProject, '.esengine/platforms'), { recursive: true });
            await fs.copyFile(path.join(repo, 'pipeline/platforms/openpaas.mjs'), path.join(exportProject, '.esengine/platforms/openpaas.mjs'));
            sceneArgs = [];
        }
        const dir = path.join(out, dimension);
        const exported = runTool(process.execPath, [path.join(repo, 'pipeline/bin/estella.mjs'), 'export', exportProject,
            '--platform', 'openpaas', '--wasm', wasm, ...sceneArgs,
            '--out', dir, '--json', dir + '.json'], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        assert.equal(exported.status, 0, `${dimension} export failed: ${exported.stderr ?? exported.stdout}`);
        let servedDir = dir;
        if (packageConfig) {
            const file = path.join(out, dimension + '.sp');
            const packaged = runTool(process.execPath, [path.join(repo, 'pipeline/bin/estella.mjs'), 'package-openpaas', dir,
                '--config', packageConfig, '--out', file], { cwd: repo, encoding: 'utf8' });
            assert.equal(packaged.status, 0, `${dimension} package creation failed: ${packaged.stderr}`);
            const result = JSON.parse(packaged.stdout);
            assert.equal(result.signatureAndFilesVerified, true);
            servedDir = path.join(out, dimension + '-unpacked');
            const decrypted = runTool(path.resolve(packer), ['--decrypt', file, '--decrypt-all', '--global-key', encryptionKey,
                '--decrypt-output-dir', servedDir], { cwd: repo, encoding: 'utf8' });
            assert.equal(decrypted.status, 0, `${dimension} official package decryption failed`);
            const files = async root => {
                const walk = async (under = '') => (await Promise.all((await fs.readdir(path.join(root, under), { withFileTypes: true }))
                    .map(entry => entry.isDirectory() ? walk(path.join(under, entry.name)) : path.join(under, entry.name)))).flat();
                return (await walk()).sort();
            };
            const originalFiles = await files(dir);
            assert.deepEqual(await files(servedDir), originalFiles, 'signed package file list differs from export');
            for (const relative of originalFiles.filter(name => name !== 'manifest.json')) {
                assert.equal(sha(await fs.readFile(path.join(servedDir, relative))), sha(await fs.readFile(path.join(dir, relative))), relative);
            }
            report.packages.push({ ...result, file: path.basename(file), payloadMatchesExport: true });
        }
        let html = HOST_PAGE('main.js');
        const marker = "  try {\n    log('booting";
        assert.ok(html.includes(marker), 'contract host hook changed');
        html = html.replace(marker, `
  // SUD uses standard XHR / WebSocket / localStorage, not wx.request/storage.
  globalThis.sud = { ...wx };
  for (const key of ['request', 'connectSocket', 'getStorageSync', 'setStorageSync',
    'removeStorageSync', 'getStorageInfoSync', 'loadSubpackage']) delete sud[key];
  WebAssembly.instantiateFromFile = async (path, imports) => {
    if (path.startsWith('./') || path.includes('..')) throw Error('Invalid SUD package path');
    const response = await fetch('/' + path);
    if (!response.ok) throw Error('Missing wasm ' + path);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
    return { instance }; // iOS contract: module is absent.
  };
  globalThis.wx = undefined; globalThis.tt = undefined; globalThis.WXWebAssembly = undefined;
  globalThis.__draws = 0;
  for (const key of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const original = WebGL2RenderingContext.prototype[key];
    WebGL2RenderingContext.prototype[key] = function (...args) { __draws++; return original.apply(this, args); };
  }
` + marker);
        html = html.replace('dirOf(file), wx, globalThis);', 'dirOf(file), undefined, globalThis);');
        // Match the documented SUD loader: paths relative to the game entry,
        // scripts execute globally and require need not return module exports.
        // DOM script insertion is only the headless harness's execution seam.
        const loaderStart = html.indexOf('  function requireFrom(dir, spec) {');
        const loaderEnd = html.indexOf("  // SUD uses standard XHR", loaderStart);
        assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'script host hook changed');
        html = html.slice(0, loaderStart) + `
  const loadedScripts = new Set();
  function requireFrom(_dir, spec) {
    const file = normalize(spec);
    if (loadedScripts.has(file)) return;
    const script = document.createElement('script');
    script.textContent = readAsText('/' + file) + '\\n//# sourceURL=' + file;
    loadedScripts.add(file);
    document.head.appendChild(script);
    script.remove();
  }
  globalThis.require = spec => requireFrom('', spec);
` + html.slice(loaderEnd);
        const root = realpathSync(servedDir);
        const server = http.createServer((req, res) => {
            try {
                const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
                if (!rel) { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
                const file = realpathSync(path.resolve(root, rel));
                if (!file.startsWith(root + path.sep) || !statSync(file).isFile()) throw Error('Outside export');
                res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' })[path.extname(file)] ?? 'application/octet-stream');
                res.end(readFileSync(file));
            } catch { res.writeHead(404).end(); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const context = await browser.newContext({ viewport: { width: 640, height: 360 }, hasTouch: true });
        try {
            const page = await context.newPage();
            page.on('pageerror', error => report.errors.push(`${dimension}: ${error}`));
            page.on('console', message => { if (message.type() === 'error') report.errors.push(`${dimension}: ${message.text()}`); });
            const origin = `http://127.0.0.1:${server.address().port}`;
            await context.route('**/*', route => route.request().url().startsWith(origin + '/')
                ? route.continue() : route.abort());
            await page.goto(origin + '/');
            await page.waitForFunction(() => globalThis.__estellaLoading === null && globalThis.__draws >= 3, {}, { timeout: 30000 });
            const frame = await page.screenshot({ path: path.join(out, `${dimension}.png`) });
            const image = PNG.sync.read(frame);
            let different = 0;
            for (let i = 0; i < image.data.length; i += 4) {
                if (Math.abs(image.data[i] - image.data[0]) + Math.abs(image.data[i + 1] - image.data[1])
                    + Math.abs(image.data[i + 2] - image.data[2]) > 40) different++;
            }
            assert.ok(different > 200, `${dimension} frame is flat (${different} distinct pixels)`);
            report.scenes.push({ dimension, project: authoredProject, draws: await page.evaluate(() => __draws), differentPixels: different,
                screenshotSha256: sha(frame), engineSha256: sha(await fs.readFile(path.join(dir, 'wasm/esengine.wxgame.wasm'))) });
        } finally {
            await context.close();
            await new Promise(resolve => server.close(resolve));
        }
    }
    assert.deepEqual(report.errors, []);
    report.status = 'checks-passed';
} finally {
    await browser?.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    const resolved = path.resolve(project);
    if (!resolved.startsWith(out + path.sep)) throw Error('Unexpected fixture cleanup path');
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    if (secretDir) {
        if (path.dirname(path.resolve(secretDir)) !== await fs.realpath(tmpdir())
            || !path.basename(secretDir).startsWith('estella-sud-test-keys-')) throw Error('Unexpected key cleanup path');
        await fs.rm(secretDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
}
console.log(`OpenPaaS: 2D and 3D ${packer ? 'officially packaged, verified and decrypted payloads' : 'exports'} rendered in headless contract host; device acceptance pending.`);
