import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { servePreview } from './preview.mjs';
const out = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'output/starfall'); await mkdir(out, { recursive: true });
const server = await servePreview(path.join(out, 'web'));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
const errors = [], runs = [];
const percentile = (values, q) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)];
const rounded = x => Math.round(x * 100) / 100;
try {
    for (const throttle of [1, 4]) {
        const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
        page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
        const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
        await page.addInitScript(() => {
            let draws = 0, triangles = 0, last = 0, collect = false, first = 0;
            const frames = [], rawRAF = window.requestAnimationFrame.bind(window);
            for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
                const native = WebGL2RenderingContext.prototype[name];
                WebGL2RenderingContext.prototype[name] = function (...args) {
                    if (this.canvas.id === 'canvas') { draws++; if (args[0] === this.TRIANGLES) triangles += (name.includes('Arrays') ? args[2] : args[1]) / 3 * (name.endsWith('Instanced') ? args.at(-1) : 1); }
                    return native.apply(this, args);
                };
            }
            function sample(t) {
                if (draws && !document.getElementById('es-splash') && !first) first = t;
                if (collect && last) frames.push({ ms: t - last, draws, triangles });
                last = t; draws = triangles = 0; rawRAF(sample);
            }
            window.starfallBench = { start() { frames.length = 0; collect = true; }, stop() { collect = false; return frames; }, first: () => first };
            rawRAF(sample);
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.starfallBench.first() > 0, null, { timeout: 60000 });
        const device = await page.evaluate(() => { const gl = document.getElementById('canvas').getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), surface: [gl.drawingBufferWidth, gl.drawingBufferHeight], firstFrameMs: Math.round(window.starfallBench.first()), transferBytes: performance.getEntriesByType('resource').reduce((sum, r) => sum + r.transferSize, 0) }; });
        const stages = [];
        async function sample(name, duration, action) {
            await page.evaluate(() => window.starfallBench.start());
            if (action) await action();
            await page.waitForTimeout(duration);
            const frames = await page.evaluate(() => window.starfallBench.stop());
            if (!frames.length || !frames.some(f => f.draws > 0)) throw new Error('No rendered frames in ' + name);
            const ms = frames.map(f => f.ms), draws = frames.map(f => f.draws);
            const stage = { name, frames: frames.length, fps: rounded(1000 * frames.length / ms.reduce((a, b) => a + b, 0)), medianMs: rounded(percentile(ms, .5)), p95Ms: rounded(percentile(ms, .95)), p99Ms: rounded(percentile(ms, .99)), worstMs: rounded(Math.max(...ms)), over25Ms: ms.filter(x => x > 25).length, over50Ms: ms.filter(x => x > 50).length,
                drawCallsP95: percentile(draws, .95), trianglesP95: percentile(frames.map(f => f.triangles), .95) };
            stage.targetMet = stage.fps >= 58 && stage.p95Ms <= 20 && stage.over50Ms === 0 && stage.drawCallsP95 <= 32;
            stages.push(stage); console.log(JSON.stringify({ throttle, ...stage }));
        }
        await page.waitForTimeout(800); await sample('lobby', 7000);
        await sample('first-entry', 2500, () => page.keyboard.press('Enter'));
        await page.keyboard.down('j'); await page.keyboard.down('d');
        await sample('combat-and-nova', 6500, async () => { await page.keyboard.press('e'); await page.keyboard.press('k'); });
        await page.keyboard.up('d'); await page.keyboard.down('a');
        await sample('combat-return', 6500, async () => { await page.keyboard.press('e'); await page.keyboard.press('k'); });
        await page.keyboard.up('a'); await page.keyboard.up('j');
        const scale = 390 / 720, dx = (844 - 1280 * scale) / 2;
        await page.touchscreen.tap(dx + 1150 * scale, 46 * scale); await page.waitForTimeout(700);
        await page.keyboard.down('j'); await sample('economy', 6000, () => page.keyboard.press('e')); await page.keyboard.up('j');
        runs.push({ throttle, device, stages, targetMet: stages.every(s => s.targetMet) });
        await page.close();
    }
    if (errors.length) throw new Error(errors.join('\n'));
    const report = { scope: 'Real rAF cadence in the shipping WebGL2 build, headless Chromium, 844×390 CSS / DPR 2. CDP CPU throttling is a synthetic stress test; the GPU remains the desktop GPU. Not a WeChat or physical midrange phone acceptance result.',
        machine: { platform: os.platform(), cpu: os.cpus()[0]?.model, browser: browser.version() }, limits: { fps: 58, p95Ms: 20, over50Ms: 0, drawCallsP95: 32 }, errors, runs };
    await writeFile(path.join(out, 'performance.json'), JSON.stringify(report, null, 2) + '\n');
    if (process.argv.includes('--enforce') && runs.some(r => !r.targetMet)) process.exitCode = 1;
} finally { await browser.close(); server.close(); }
