import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { servePreview } from './preview.mjs';

const [target, reportFile] = process.argv.slice(2);
if (!target || !reportFile) throw Error('Usage: benchmark.mjs <export-dir|url> <report.json>');
const server = /^https?:/.test(target) ? null : await servePreview(path.resolve(target));
const url = server ? 'http://127.0.0.1:' + server.address().port : target;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
    const viewport = { width: 1600, height: 900 };
    const page = await browser.newPage({ viewport, deviceScaleFactor: Number(process.env.WINDRISE_DPR || 1) });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', message => {
        const messageText = message.text();
        if (message.type() === 'error' || /shader\(s\) still compiling|shader warm-up failed/.test(messageText))
            errors.push(messageText);
    });
    page.on('response', res => { if (res.status() >= 400) errors.push(res.status() + ' ' + res.url()); });
    await page.addInitScript(() => {
        let calls = 0, triangles = 0, previous = 0, collecting = false;
        const frames = [];
        const boot = {};
        addEventListener('esengine:bootprogress', ({ detail }) => {
            if (!detail.partial) boot[detail.stage] = Math.round(performance.now());
        });
        for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
            const original = WebGL2RenderingContext.prototype[method];
            WebGL2RenderingContext.prototype[method] = function (...args) {
                if (this.canvas.id === 'canvas') {
                    calls++;
                    const count = method.includes('Arrays') ? args[2] : args[1];
                    const instances = method.endsWith('Instanced') ? args.at(-1) : 1;
                    if (args[0] === this.TRIANGLES) triangles += Math.floor(count / 3) * instances;
                }
                return original.apply(this, args);
            };
        }
        function frame(time) {
            if (collecting && previous) frames.push({ ms: time - previous, calls, triangles });
            if (calls && !document.getElementById('es-splash') && !window.windriseBench.entryMs)
                window.windriseBench.entryMs = Math.round(time);
            previous = time;
            calls = triangles = 0;
            requestAnimationFrame(frame);
        }
        window.windriseBench = {
            entryMs: 0, boot,
            start() { frames.length = 0; collecting = true; },
            stop() { collecting = false; return frames; },
        };
        requestAnimationFrame(frame);
    });
    const stages = [];
    const median = (sorted, q) => sorted[Math.ceil(q * sorted.length) - 1];
    async function sample(name, walking = false) {
        if (walking) await page.keyboard.down('w');
        await page.evaluate(() => window.windriseBench.start());
        await new Promise(resolve => setTimeout(resolve, 5500));
        const frames = await page.evaluate(() => window.windriseBench.stop());
        if (walking) await page.keyboard.up('w');
        if (!frames.length || !frames.some(f => f.calls)) throw Error('No rendered frames during ' + name);
        const series = key => frames.map(f => f[key]).sort((a, b) => a - b);
        const intervals = series('ms'), sum = intervals.reduce((a, b) => a + b, 0);
        stages.push({ name, frames: frames.length, fps: +(1000 * frames.length / sum).toFixed(1),
            medianMs: +median(intervals, .5).toFixed(1), p95Ms: +median(intervals, .95).toFixed(1),
            worstMs: +intervals.at(-1).toFixed(1), over50Ms: intervals.filter(ms => ms > 50).length,
            calls: median(series('calls'), .5), submittedTriangles: median(series('triangles'), .5) });
    }
    const loads = [];
    for (const view of ['', 'oak']) {
        await page.goto(url + (view ? '/?view=' + view : '/'), { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForFunction(() => window.windriseBench.entryMs > 0, null, { timeout: 120000 });
        loads.push(await page.evaluate(() => {
            const gl = document.querySelector('#canvas').getContext('webgl2');
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            const requests = performance.getEntriesByType('resource');
            return { entryMs: window.windriseBench.entryMs, boot: window.windriseBench.boot, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                parallelShaderCompile: !!gl.getExtension('KHR_parallel_shader_compile'),
                bytes: requests.reduce((n, r) => n + r.transferSize, 0), requests: requests.length };
        }));
        await page.waitForTimeout(1500);
        await sample(view || 'spawn');
        if (!view) await sample('walk', true);
    }
    if (errors.length) throw Error(errors.join('\n'));
    const report = { viewport, loads, stages };
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
} finally {
    await browser.close();
    server?.close();
}
