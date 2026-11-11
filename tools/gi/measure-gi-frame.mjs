// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The GPU time of every compute pass of a frame, from the device's own timestamp queries, over a few hundred frames of an exported web game.
 *
 *   node tools/gi/measure-gi-frame.mjs <webDir> [frames=240]            env W, H: the viewport (default 1280 x 720)
 *
 * Headless Chromium on the machine's own GPU (no window). A shim installed before the page loads asks the device for `timestamp-query`
 * and puts a begin/end timestamp on every compute pass the game records; the results are read back a frame later. Passes are told apart
 * by their order in a frame, since the engine does not label them: the lab scenes run the GI's three (cards, probes, apply) and nothing else
 * that computes, so the order is theirs. Prints the median and the 95th percentile of each pass, and of their sum, in milliseconds.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const [webDir, framesArg] = process.argv.slice(2);
const frames = Number(framesArg ?? 240);
const { chromium } = await import(pathToFileURL(path.join(root, 'node_modules/playwright/index.mjs')).href);
const { serveHost } = await import(pathToFileURL(path.join(root, 'tools/lib/staticServer.mjs')).href);

const shim = () => {
    const frames = [];
    window.__gpuFrames = frames;
    const wrapAdapter = (adapter) => {
        if (!adapter || adapter.__wrapped) return adapter;
        adapter.__wrapped = true;
        const request = adapter.requestDevice.bind(adapter);
        adapter.requestDevice = async (desc = {}) => {
            const features = new Set(desc.requiredFeatures ?? []);
            if (adapter.features.has('timestamp-query')) features.add('timestamp-query');
            const device = await request({ ...desc, requiredFeatures: [...features] });
            instrument(device);
            return device;
        };
        return adapter;
    };
    const original = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...a) => wrapAdapter(await original(...a));

    function instrument(device) {
        if (!device.features.has('timestamp-query')) return;
        const state = new WeakMap();
        const proto = GPUCommandEncoder.prototype;
        const begin = proto.beginComputePass, finish = proto.finish;
        proto.beginComputePass = function (desc = {}) {
            let s = state.get(this);
            if (!s) { s = { passes: 0, querySet: device.createQuerySet({ type: 'timestamp', count: 64 }) }; state.set(this, s); }
            if (s.passes >= 32) return begin.call(this, desc);
            const k = s.passes++;
            return begin.call(this, { ...desc, timestampWrites: { querySet: s.querySet, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 } });
        };
        proto.finish = function (desc) {
            const s = state.get(this);
            if (!s || s.passes === 0) return finish.call(this, desc);
            const bytes = 16 * s.passes;
            const resolve = device.createBuffer({ size: bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
            const read = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            this.resolveQuerySet(s.querySet, 0, 2 * s.passes, resolve, 0);
            this.copyBufferToBuffer(resolve, 0, read, 0, bytes);
            const buffer = finish.call(this, desc);
            (buffer.__reads ??= []).push({ read, passes: s.passes });
            return buffer;
        };
        const submit = device.queue.submit.bind(device.queue);
        device.queue.submit = (buffers) => {
            submit(buffers);
            for (const b of buffers) for (const { read, passes } of b.__reads ?? []) {
                read.mapAsync(GPUMapMode.READ).then(() => {
                    const t = new BigUint64Array(read.getMappedRange().slice(0));
                    const ms = [];
                    for (let k = 0; k < passes; k++) ms.push(Number(t[2 * k + 1] - t[2 * k]) / 1e6);
                    frames.push(ms);
                    read.destroy();
                });
            }
        };
    }
};

const server = await serveHost(path.resolve(webDir));
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
    const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: 1 });
    await page.addInitScript(shim);
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    // Let it settle (the scene loads, the cards converge), then take `frames` frames.
    await page.waitForFunction((n) => window.__gpuFrames.length > n, (frames + 120) * Number(process.env.PASSES ?? 3), { timeout: 180000 });
    const all = (await page.evaluate(() => window.__gpuFrames)).flat();
    // The engine records each compute pass in an encoder of its own, so they arrive one at a time, in frame order, a frame being PASSES of them.
    const passes = Number(process.env.PASSES ?? 3);
    const skip = 120 * passes, taken = [];
    for (let i = skip; i + passes <= all.length && taken.length < frames; i += passes) taken.push(all.slice(i, i + passes));
    const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
    const sums = taken.map((f) => f.reduce((a, b) => a + b, 0));
    console.log(`${taken.length} frames, ${passes} compute passes a frame, ${process.env.W ?? 1280}x${process.env.H ?? 720}`);
    for (let k = 0; k < passes; k++) {
        const r = taken.map((f) => f[k]);
        console.log(`  pass ${k}: median ${pct(r, 0.5).toFixed(3)} ms   p95 ${pct(r, 0.95).toFixed(3)} ms`);
    }
    console.log(`  all compute: median ${pct(sums, 0.5).toFixed(3)} ms   p95 ${pct(sums, 0.95).toFixed(3)} ms`);
} finally {
    await browser.close();
    server.close();
}
