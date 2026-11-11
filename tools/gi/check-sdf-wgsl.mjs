// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The scene distance field's trace (GLOBAL_SDF_WGSL in sdk/src/gi/globalSdf.ts) run on a real WebGPU device, headless, against the
 * closed-form distance to a sphere: the WGSL has to compile, and its rays have to land where the maths says.
 *
 *   node tools/gi/check-sdf-wgsl.mjs
 *
 * Exits 2 (not 1) when this machine offers no WebGPU adapter, so a caller can tell "could not run" from "ran and failed".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const source = readFileSync(path.join(root, 'sdk/src/gi/globalSdf.ts'), 'utf8');
const wgsl = source.match(/GLOBAL_SDF_WGSL = \/\* wgsl \*\/ `([\s\S]*?)`;/)?.[1];
if (!wgsl) throw new Error('GLOBAL_SDF_WGSL not found');

// Two levels: fine (dim 32, cell 0.25: 8 across) and coarse (dim 32, cell 1: 32 across), both centred on the origin.
const levels = [{ dim: 32, cell: 0.25 }, { dim: 32, cell: 1 }];
const sphere = { c: [3, 0.2, 0.1], r: 1.5 };
const reachOf = (cell) => cell * 6;
const data = [];
const params = new ArrayBuffer(16 + 4 * 32);
const pv = new DataView(params);
pv.setUint32(0, levels.length, true);
levels.forEach((l, i) => {
    const origin = [0, 1, 2].map(() => Math.floor(0 / l.cell) - l.dim / 2);
    const offset = data.length;
    const cells = new Float32Array(l.dim ** 3);
    const mask = l.dim - 1;
    for (let z = origin[2]; z < origin[2] + l.dim; z++) for (let y = origin[1]; y < origin[1] + l.dim; y++) for (let x = origin[0]; x < origin[0] + l.dim; x++) {
        const d = Math.hypot((x + 0.5) * l.cell - sphere.c[0], (y + 0.5) * l.cell - sphere.c[1], (z + 0.5) * l.cell - sphere.c[2]) - sphere.r;
        cells[(x & mask) + (y & mask) * l.dim + (z & mask) * l.dim * l.dim] = Math.min(Math.max(d, -reachOf(l.cell)), reachOf(l.cell));
    }
    data.push(...cells);
    const base = 16 + i * 32;
    origin.forEach((o, k) => pv.setInt32(base + k * 4, o, true));
    pv.setUint32(base + 12, l.dim, true);
    pv.setFloat32(base + 16, l.cell, true);
    pv.setUint32(base + 20, offset, true);
});

// Rays from the origin toward points around the sphere: some hit, some pass.
const rays = [];
const expected = [];
for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 0.5 - 0.2, b = ((i * 7) % 64 / 64) * 0.8 - 0.4;
    const dir = [Math.cos(a) * Math.cos(b), Math.sin(b) * 0.5, Math.sin(a) * Math.cos(b)];
    const len = Math.hypot(...dir);
    const d = dir.map((v) => v / len);
    // Ray/sphere: |o + t d - c|^2 = r^2 with o = 0.
    const oc = [-sphere.c[0], -sphere.c[1], -sphere.c[2]];
    const bq = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2], cq = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - sphere.r ** 2, disc = bq * bq - cq;
    expected.push(disc >= 0 && -bq - Math.sqrt(disc) > 0 ? -bq - Math.sqrt(disc) : -1);
    rays.push(...d, 0);
}

const kernel = `
@group(0) @binding(0) var<storage, read> sdfData : array<f32>;
@group(0) @binding(1) var<uniform> sdfParams : SdfParams;
@group(0) @binding(2) var<storage, read> rays : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> hits : array<f32>;
${wgsl}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
    hits[id.x] = sdfTrace(vec3f(0.0), rays[id.x].xyz, 30.0);
}`;

const { chromium } = await import(pathToFileURL(path.join(root, 'node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
    const page = await browser.newPage();
    // WebGPU exists only in a secure context; a loopback address is one.
    await page.route('http://127.0.0.1:9/', (route) => route.fulfill({ body: '<html></html>', contentType: 'text/html' }));
    await page.goto('http://127.0.0.1:9/');
    const result = await page.evaluate(async ({ kernel, data, params, rays }) => {
        if (!navigator.gpu) return { error: 'no navigator.gpu' };
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { error: 'no adapter' };
        const device = await adapter.requestDevice();
        const module = device.createShaderModule({ code: kernel });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);
        if (errors.length) return { error: 'wgsl: ' + errors.join(' | ') };
        const make = (usage, bytes) => { const b = device.createBuffer({ size: Math.max(bytes.byteLength, 16), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, bytes); return b; };
        const dataBuffer = make(GPUBufferUsage.STORAGE, new Float32Array(data));
        const paramBuffer = make(GPUBufferUsage.UNIFORM, new Uint8Array(params));
        const rayBuffer = make(GPUBufferUsage.STORAGE, new Float32Array(rays));
        const count = rays.length / 4;
        const out = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const read = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [dataBuffer, paramBuffer, rayBuffer, out].map((buffer, binding) => ({ binding, resource: { buffer } })) });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();
        encoder.copyBufferToBuffer(out, 0, read, 0, count * 4);
        device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        return { hits: Array.from(new Float32Array(read.getMappedRange().slice(0))) };
    }, { kernel, data, params: Array.from(new Uint8Array(params)), rays });
    if (result.error) {
        console.error('check-sdf-wgsl:', result.error);
        process.exit(result.error.startsWith('wgsl') ? 1 : 2);
    }
    let worst = 0, hitCount = 0, wrong = 0;
    result.hits.forEach((h, i) => {
        const e = expected[i];
        if (e < 0 && h < 0) return;
        if ((e < 0) !== (h < 0)) { wrong++; return; }
        hitCount++;
        worst = Math.max(worst, Math.abs(h - e));
    });
    console.log(`rays ${result.hits.length}, hits ${hitCount}, hit/miss disagreements ${wrong}, worst distance error ${worst.toFixed(3)}`);
    // A trace stops within a quarter of a cell of the surface: 0.0625 on the fine level, 0.25 on the coarse one.
    if (wrong > 2 || worst > 0.3 || hitCount < 8) { console.error('check-sdf-wgsl: FAILED'); process.exit(1); }
    console.log('check-sdf-wgsl: passed');
} finally {
    await browser.close();
}
