// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Run against the built threaded SDK. Checks actual WebGL2 or WebGPU pixels on an isolated origin.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const dir = path.resolve(process.argv[2] ?? 'build/wasm/web');
const gpu = process.argv[3] === 'webgpu';
const server = http.createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<link rel="icon" href="data:,"><canvas id="canvas" width="32" height="32"></canvas>');
        return;
    }
    if (!['/esengine-threaded.js', '/esengine-threaded.wasm'].includes(req.url)) {
        res.writeHead(404).end();
        return;
    }
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'application/wasm');
    try { res.end(await readFile(path.join(dir, req.url.slice(1)))); }
    catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    // The full headless browser composites transferred OffscreenCanvas frames. The headless shell
    // can lose the GPU device when presenting the first WebGPU frame from a worker.
    const args = gpu ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] : [];
    const adapter = process.env.ESTELLA_VERIFY_WEBGPU_ADAPTER;
    if (!gpu || adapter === 'swiftshader') args.push('--enable-unsafe-swiftshader', '--use-angle=swiftshader');
    if (gpu && adapter) args.push(`--use-webgpu-adapter=${adapter}`);
    browser = await chromium.launch({ channel: 'chromium', headless: true, executablePath: process.env.ESTELLA_CHROMIUM,
        args });
    const page = await browser.newPage();
    let workers = 0;
    const errors = [];
    page.on('worker', () => workers++);
    page.on('pageerror', error => { errors.push(error.message); console.error(error); });
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    // A stalled main-thread rendezvous cannot run a page timer. Keep the watchdog in Node.
    const result = await Promise.race([page.evaluate(async gpu => {
        const { default: factory } = await import('/esengine-threaded.js');
        const canvas = document.querySelector('#canvas');
        const glCalls = [];
        const original = canvas.getContext.bind(canvas);
        canvas.getContext = (type, ...args) => { glCalls.push(type); return original(type, ...args); };
        const m = await factory({ canvas });
        if (!m.initRendererThreaded(gpu, '', true) || !m.renderThread_enabled()) throw Error('render thread did not start');
        while (m.renderThread_bootStatus() === 0) await new Promise(resolve => setTimeout(resolve, 1));
        if (m.renderThread_bootStatus() !== (gpu ? 2 : 1)) throw Error('Unexpected worker backend ' + m.renderThread_bootStatus());
        m.renderer_init(32, 32);
        const matrix = m._malloc(64);
        const pixels = m._malloc(48 * 32 * 4);
        const target = m.renderer_createTarget(32, 32, 1);
        const registry = new m.Registry();
        const resources = m.getResourceManager();
        const seen = [];
        const screen = [];
        const pixel = async (ticket, surface, width = 32, height = 32) => {
            const deadline = performance.now() + 5000;
            while (m.renderer_pollFrameCapture(ticket) === 0 && performance.now() < deadline)
                await new Promise(r => setTimeout(r, 4));
            const ok = surface ? m.renderer_takeFrameCapture(ticket, pixels, width * height * 4)
                : m.renderer_takeTargetCapture(ticket, pixels, width * height * 4);
            if (!ok) throw Error('pixel readback failed for ' + (surface ? 'surface' : 'target'));
            const last = pixels + (width * height - 1) * 4;
            return Array.from(m.HEAPU8.subarray(last, last + 4));
        };
        try {
            for (let i = 0; i < 5; i++) {
                m.HEAPF32.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], matrix / 4);
                m.postprocess_setMsaaSamples(i % 2 ? 4 : 1);
                m.renderer_beginFrame(i / 60);
                m.renderer_setViewport(0, 0, 32, 32);
                m.renderer_begin(matrix, target, 3, i % 2, 1 - i % 2, 0, 1, 0, 0, 32, 32);
                m.renderer_submitAll(registry, 0, 0, 32, 32);
                m.renderer_flush();
                m.renderer_end();
                // Mutate game-owned input as soon as the pass has been queued.
                m.HEAPF32.fill(NaN, matrix / 4, matrix / 4 + 16);
                const entity = registry.create();
                registry.destroy(entity);
                const ticket = m.renderer_captureTarget(target, 32, 32);
                let frame = gpu ? m.renderer_captureFrame(32, 32) : 0;
                m.HEAPF32.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], matrix / 4);
                m.renderer_begin(matrix, 0, 3, 0, i % 2, 1 - i % 2, 1, 0, 0, 32, 32);
                m.renderer_submitAll(registry, 0, 0, 32, 32);
                // Force different browser tasks for drawing and presenting the same canvas texture.
                await new Promise(r => setTimeout(r, 10));
                m.renderer_flush();
                m.renderer_end();
                if (!gpu) frame = m.renderer_captureFrame(32, 32);
                m.renderer_endFrame();
                const fence = m.renderThread_fence();
                m.renderThread_flush();
                if (!m.renderThread_complete(fence) || m.renderThread_complete(-1)) throw Error('CPU fence');
                seen.push(await pixel(ticket, false));
                screen.push(await pixel(frame, true));
            }
            const before = m.renderer_getLiveObjects().textures;
            m.HEAPU8.set([191, 72, 1, 255], pixels);
            const texture = resources.createTexture(1, 1, pixels, 4, 0, false, 0);
            if (!texture || m.renderer_getLiveObjects().textures <= before) throw Error('texture creation');
            resources.releaseTexture(texture);
            m.renderThread_flush();
            if (m.renderer_getLiveObjects().textures !== before) throw Error('deferred release');
            m.renderThread_resizeSurface(48, 24);
            m.renderer_beginFrame(1);
            m.renderer_setViewport(0, 0, 48, 24);
            let resized = gpu ? m.renderer_captureFrame(48, 24) : 0;
            m.renderer_begin(matrix, 0, 3, 1, 0, 1, 1, 0, 0, 48, 24);
            m.renderer_submitAll(registry, 0, 0, 48, 24);
            m.renderer_flush();
            m.renderer_end();
            if (!gpu) resized = m.renderer_captureFrame(48, 24);
            m.renderer_endFrame();
            return { seen, screen, corner: await pixel(resized, true, 48, 24), glCalls, fence: m.renderThread_fence() };
        } finally {
            m.renderer_releaseTarget(target);
            registry.delete();
            m._free(matrix);
            m._free(pixels);
            m.shutdownRenderer();
        }
    }, gpu), new Promise((_, reject) => {
        const timer = setTimeout(() => reject(Error('render-thread browser watchdog expired')), 45000);
        timer.unref();
    })]);
    assert.ok(workers >= 1 && result.fence > 0);
    assert.deepEqual(result.glCalls.filter(type => /webgl|webgpu/i.test(type)), []);
    assert.deepEqual(result.seen, [[0,255,0,255],[255,0,0,255],[0,255,0,255],[255,0,0,255],[0,255,0,255]]);
    assert.deepEqual(result.screen, [[0,0,255,255],[0,255,0,255],[0,0,255,255],[0,255,0,255],[0,0,255,255]]);
    assert.deepEqual(result.corner, [255,0,255,255]);
    assert.deepEqual(errors, []);
    console.log('Threaded ' + (gpu ? 'WebGPU' : 'WebGL2') + ': five surface and target readbacks, CPU fences, resource release and shutdown passed.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
