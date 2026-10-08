// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import '/host.js';
import { checkNineSliceCorners } from './lib/nineSliceProbe.mjs';

const result = document.querySelector('#result');
const button = document.querySelector('#run');
const backend = new URL(location.href).searchParams.get('backend') ?? 'webgl2';
const scene = '/scenes/sprite-nine-slice.esscene';
const manifest = '/scenes/sprite-nine-slice.textures.json';
const summary = document.querySelector('#summary');
const preview = document.querySelector('#preview');
const checks = [];
function check(name, condition, detail) {
    checks.push({ name, pass: !!condition, detail });
    if (!condition) throw Error(`${name}: ${JSON.stringify(detail)}`);
}
function block(px, x, y) {
    const out = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        // GPU readback is bottom-up.
        const k = ((px.height - 1 - y - j) * px.width + x + i) * 4;
        out.push(...px.rgba.slice(k, k + 4));
    }
    return out;
}
function corners(px, left, top, width) {
    return [[left, top], [left + width - 8, top], [left, top + 24], [left + width - 8, top + 24]]
        .map(([x, y]) => block(px, x, y));
}
function same(a, b) { return a.every((corner, c) => corner.every((v, i) => v === b[c][i])); }
function show(px) {
    preview.width = px.width; preview.height = px.height;
    const ctx = preview.getContext('2d');
    const data = new Uint8ClampedArray(px.rgba.length);
    for (let y = 0; y < px.height; y++) data.set(px.rgba.slice((px.height - 1 - y) * px.width * 4, (px.height - y) * px.width * 4), y * px.width * 4);
    ctx.putImageData(new ImageData(data, px.width, px.height), 0, 0);
}
button.disabled = true;
try { await window.__estellaHeadless.ready; summary.textContent = `Ready: ${backend}`; button.disabled = false; }
catch (error) {
    summary.textContent = `Unavailable: ${backend} — ${error.message}`;
    const report = { backend, available: false, error: error.stack, passed: 0, failed: 0 };
    result.textContent = JSON.stringify(report, null, 2);
    await fetch('/report', { method: 'POST', body: JSON.stringify(report) });
}
button.onclick = async () => {
    button.disabled = true; checks.length = 0; summary.textContent = 'Checking…';
    try {
        const api = window.__estellaHeadless.api;
        const loaded = await api.loadScene(scene, manifest);
        check('All fixture assets loaded', loaded.missing.length === 0, loaded);
        await api.step(3);
        let px = await api.captureViewportPixels();
        check('GPU readback', px?.width === 320 && px?.height === 128, { width: px?.width, height: px?.height });
        const native = corners(px, 48, 24, 32), wide = corners(px, 120, 24, 160);
        check('Corners contain the authored pattern', new Set(native.flat()).size > 12, new Set(native.flat()).size);
        check('Five times wider preserves every corner pixel', same(native, wide));
        check('UIVisual uses identical corner pixels', same(native, corners(px, 120, 80, 160)));
        const fullComparison = checkNineSliceCorners(px.rgba, px.width, px.height, [[48,24,32,32],[120,24,160,32],[120,80,160,32]]);
        check('CI corner predicate', fullComparison.ok, fullComparison);
        const slicedBatch = await api.frameDebug();
        check('Frame capture matches replay', slicedBatch?.matches, slicedBatch);
        api.setField(2, 'Sprite', 'drawMode', 'enum', 1);
        await api.step(2); px = await api.captureViewportPixels();
        check('Simple negative control deforms corners', !same(native, corners(px, 120, 24, 160)));
        const plainBatch = await api.frameDebug();
        check('Nine-slice adds no draw calls or state breaks', slicedBatch.draws === plainBatch.draws && JSON.stringify(slicedBatch.breaks) === JSON.stringify(plainBatch.breaks), { slicedBatch, plainBatch });
        api.setField(2, 'Sprite', 'drawMode', 'enum', 0);
        await api.step(2); px = await api.captureViewportPixels();
        check('Legacy Auto still infers texture borders', same(native, corners(px, 120, 24, 160)));
        api.setField(2, 'Sprite', 'drawMode', 'enum', 3);
        await api.step(2); show(await api.captureViewportPixels());
    } catch (error) { checks.push({ name: 'Probe error', pass: false, detail: error.stack }); }
    const report = { backend, userAgent: navigator.userAgent, checks, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length };
    result.textContent = JSON.stringify(report, null, 2);
    summary.textContent = `${backend}: ${report.passed} passed, ${report.failed} failed. Reload to repeat.`;
    const saved = await fetch('/report', { method: 'POST', body: JSON.stringify(report) });
    if (!saved.ok) result.textContent += '\nReport could not be saved';
};
