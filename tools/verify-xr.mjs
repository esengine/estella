// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-xr.mjs — a web build with VR on enters a headset, draws both eyes into its framebuffer, and leaves again.
 *
 * There is no headset here, so the page is given one: an `navigator.xr` that supports immersive VR, a session whose frames
 * are the page's animation frames, two eyes 6.4 cm apart with their own projections, and an `XRWebGLLayer` whose framebuffer
 * is an ordinary one this script can read back. What a real headset adds (an opaque framebuffer, its compositor, its frame
 * rate) is not checked here; that the engine draws what a headset asks for, where it asks, is.
 *
 * Checks, after clicking the page's Enter VR button:
 *  - the session's framebuffer has the scene in both halves (each eye drew into its own viewport);
 *  - the cube in front of the camera sits further right in the left eye than in the right (the eyes see in stereo, and the
 *    right way round);
 *  - the shadows are planned once for both eyes: the atlas is kept from eye to eye and frame to frame, never redrawn or
 *    recollected per eye (planned per eye, each eye's cascades were the other's stale ones);
 *  - every frame was drawn inside its session callback (none late), and the page's own canvas drew nothing meanwhile;
 *  - a right controller's grip pose places the entity with XRController (right, grip) where the rig puts it, and its trigger,
 *    held for ten frames, reaches a game system as one press, ten frames down and one release;
 *  - Exit VR gives the frames back to the page.
 *
 *   node tools/verify-xr.mjs            (uses build/wasm/web; build it with `node build-tools/cli.js build -t web`)
 *   node tools/verify-xr.mjs --save eyes.png   (also writes the headset's framebuffer, both eyes, as a picture)
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'pipeline/package.json'));
const { chromium } = require('playwright');
const { serveDir } = await import('./lib/serveDir.mjs');

const tf = (x, y, z, extra = {}) => ({ type: 'Transform', data: { position: { x, y, z }, ...extra } });
const e = (id, name, components) => ({ id, name, parent: null, children: [], visible: true, components });
const SCENE = { version: 4, name: 'main', entities: [
    // One cube on black, a metre in front of the camera and a little below its eye: both eyes see it near their middle, and
    // nothing else in the picture is as bright, so where it sits in each eye is read without telling it from a floor.
    e(2, 'Cube', [tf(0, 130, 400, { scale: { x: 0.6, y: 0.6, z: 0.6 } }), { type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: true, opaque: true, castShadows: true } }]),
    // Looking down a little: the rig takes its heading only, so the eyes look level (the cube stays in view).
    e(3, 'Camera', [tf(0, 150, 500, { rotation: { x: -0.17, y: 0, z: 0, w: 0.985 } }),
        { type: 'Camera', data: { isActive: true, projectionType: 0, fov: 60, nearPlane: 1, farPlane: 10000 } }]),
    // Follows the right controller's grip: a small cube the player holds.
    e(5, 'RightHand', [tf(0, 0, 0, { scale: { x: 0.1, y: 0.1, z: 0.1 } }), { type: 'XRController', data: { hand: 1, pose: 0 } },
        { type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: true, opaque: true } }]),
    e(4, 'Sun', [tf(0, 0, 0, { rotation: { x: -0.38, y: 0.2, z: 0, w: 0.9 } }), { type: 'Light', data: { type: 1, intensity: 3, meshShadows: true } }]),
] };

const work = mkdtempSync(path.join(tmpdir(), 'estella-xr-'));
const project = path.join(work, 'project');
mkdirSync(path.join(project, 'assets/scenes'), { recursive: true });
mkdirSync(path.join(project, 'src'), { recursive: true });
writeFileSync(path.join(project, 'project.esproject'), JSON.stringify({
    formatVersion: '1', name: 'XR probe', defaultScene: 'assets/scenes/main.esscene',
    designResolution: { width: 640, height: 360 }, features: { rendering: { vr: true } },
}));
writeFileSync(path.join(project, 'assets/scenes/main.esscene'), JSON.stringify(SCENE));
writeFileSync(path.join(project, 'assets/scenes/main.esscene.meta'),
    JSON.stringify({ uuid: '3d1f0c2a-9b8e-4c7d-a6f5-e4d3c2b1a0f9', version: '2.0', type: 'scene', importer: {} }));
// What a game reads of the controller, written where this script can see it.
writeFileSync(path.join(project, 'src/main.ts'), [
    "import { addSystemToSchedule, Schedule, defineSystem, Query, Res, Input, Transform, XRController, XRButton } from 'esengine';",
    'const seen = { pressed: 0, released: 0, down: 0, hand: null as null | { x: number; y: number; z: number } };',
    '(globalThis as { __xrProbe?: typeof seen }).__xrProbe = seen;',
    'addSystemToSchedule(Schedule.Update, defineSystem([Res(Input), Query(Transform, XRController)], (input, hands) => {',
    "    if (input.isXRButtonPressed(XRButton.Trigger, 'right')) seen.pressed++;",
    "    if (input.isXRButtonReleased(XRButton.Trigger, 'right')) seen.released++;",
    "    if (input.isXRButtonDown(XRButton.Trigger, 'right')) seen.down++;",
    '    for (const [, t] of hands) seen.hand = { ...t.worldPosition };',
    "}, { name: 'XRProbe' }));",
    '',
].join('\n'));

const out = path.join(work, 'web');
const built = spawnSync(process.execPath, [path.join(ROOT, 'pipeline/bin/estella.mjs'), 'export', project, '--platform', 'web', '--out', out],
    { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 << 20 });
if (built.status !== 0) {
    console.error(`verify-xr: the export failed\n${(built.stdout + built.stderr).slice(-2000)}`);
    process.exit(1);
}

/** The headset the page is given, before any of its scripts run. */
function fakeHeadset() {
    const W = 1024, H = 512;
    const state = { counters: [], frames: 0, depthNear: 0.1, depthFar: 1000, active: false, ended: false, pageFramesDuring: 0 };
    window.__xr = state;
    // The page's own frames, counted while the headset presents: the App should ask the session's, not these.
    const pageRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => pageRaf((t) => { if (state.active) state.pageFramesDuring++; cb(t); });
    const projection = (near, far) => {
        // 90 degrees across, square: each eye's half of the framebuffer is 512 x 512.
        const f = 1, nf = 1 / (near - far);
        return new Float32Array([f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    };
    class FakeLayer {
        constructor(session, gl) {
            this.gl = gl; this.framebufferWidth = W; this.framebufferHeight = H;
            const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING), prevRb = gl.getParameter(gl.RENDERBUFFER_BINDING);
            const fb = gl.createFramebuffer(), color = gl.createRenderbuffer(), depth = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, color); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H);
            gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, W, H);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
            gl.bindFramebuffer(gl.FRAMEBUFFER, prev); gl.bindRenderbuffer(gl.RENDERBUFFER, prevRb);
            this.framebuffer = fb;
            state.layer = this;
        }
        getViewport(view) { return view.eye === 'left' ? { x: 0, y: 0, width: W / 2, height: H } : { x: W / 2, y: 0, width: W / 2, height: H }; }
    }
    window.XRWebGLLayer = FakeLayer;
    // A browser with a headset makes the context compatible (or already has); this one, with no XR device, would refuse.
    WebGL2RenderingContext.prototype.makeXRCompatible = async function () {};
    const listeners = [];
    // A right controller held a little right, below and ahead of the head; its trigger held from frame 10 to frame 19.
    const pose = (x, y, z) => ({ transform: { position: { x, y, z }, orientation: { x: 0, y: 0, z: 0, w: 1 } } });
    const button = () => ({ value: 0, pressed: false, touched: false });
    const rightPad = { buttons: [button(), button(), button(), button(), button(), button()], axes: [0, 0, 0, 0] };
    const grip = { space: 'grip' }, aim = { space: 'aim' };
    const right = { handedness: 'right', gripSpace: grip, targetRaySpace: aim, gamepad: rightPad, profiles: ['generic-trigger-squeeze-thumbstick'] };
    const session = {
        inputSources: [right],
        requestAnimationFrame(cb) {
            return pageRaf((t) => {
                if (state.ended) return;
                // What the engine did for the frame before this one: one shadow plan for both eyes, kept frame to frame.
                const probe = globalThis.__estellaCooked;
                if (probe && state.frames >= 15 && state.frames < 30) state.counters.push(probe.counters());
                state.frames++;
                const held = state.frames >= 10 && state.frames < 20;
                rightPad.buttons[0] = { value: held ? 1 : 0, pressed: held, touched: held };
                const view = (eye, x) => ({ eye, projectionMatrix: projection(state.depthNear, state.depthFar),
                    transform: { position: { x, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } });
                cb(t, { getPose: (space) => (space === grip || space === aim ? pose(0.15, -0.15, -0.4) : null), getViewerPose: () => ({ transform: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
                    views: [view('left', -0.032), view('right', 0.032)] }) });
            });
        },
        cancelAnimationFrame(id) { cancelAnimationFrame(id); },
        updateRenderState(s) {
            if (s.depthNear !== undefined) state.depthNear = s.depthNear;
            if (s.depthFar !== undefined) state.depthFar = s.depthFar;
        },
        async requestReferenceSpace() { return {}; },
        async end() { state.ended = true; state.active = false; for (const l of listeners) l(); },
        addEventListener(type, cb) { if (type === 'end') listeners.push(cb); },
    };
    Object.defineProperty(navigator, 'xr', { value: {
        isSessionSupported: async (mode) => mode === 'immersive-vr',
        requestSession: async () => { state.active = true; return session; },
    } });
}

const saveAt = process.argv.indexOf('--save');
const SAVE = saveAt >= 0 ? path.resolve(process.argv[saveAt + 1]) : null;

const failures = [];
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`); if (!ok) failures.push(what); };

const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
const server = await serveDir(out);
try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
    await page.addInitScript(fakeHeadset);
    if (SAVE) await page.addInitScript(() => { window.__xrSave = true; });
    // ?headless: the build's probe hook (counters) is installed, and WebGL2 is pinned, which is what a headset takes anyway.
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`);
    // Profiling on before the headset is: turning it on mid-session costs the frame it happens in.
    await page.waitForFunction(() => !!globalThis.__estellaCooked, null, { timeout: 60_000, polling: 100 });
    await page.evaluate(() => globalThis.__estellaCooked.counters());
    const button = page.getByRole('button', { name: 'Enter VR' });
    await button.waitFor({ state: 'visible', timeout: 60_000 });
    check(true, 'the page offers Enter VR where the browser can present');
    await button.click();
    // Polled on a timer: the default polls on animation frames, which would be counted as the page's own.
    await page.waitForFunction(() => window.__xr.frames >= 30, null, { timeout: 30_000, polling: 100 }).catch(async (err) => {
        const st = await page.evaluate(() => ({ frames: window.__xr.frames, active: window.__xr.active, ended: window.__xr.ended })).catch(() => null);
        console.error(`verify-xr: the session did not run its frames (${JSON.stringify(st)}). Page said:`);
        for (const line of logs.slice(-25)) console.error(`  ${line}`);
        throw err;
    });
    const read = await page.evaluate(() => {
        const { layer } = window.__xr;
        const gl = layer.gl, W = layer.framebufferWidth, H = layer.framebufferHeight;
        const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
        // Per half: how much is lit, and where the brightest pixels (the cube, nearest the light) sit across it.
        const half = (x0) => {
            let lit = 0, max = 0;
            for (let y = 0; y < H; y++) for (let x = x0; x < x0 + W / 2; x++) {
                const i = (y * W + x) * 4, v = px[i] + px[i + 1] + px[i + 2];
                if (v > 30) lit++;
                if (v > max) max = v;
            }
            let sx = 0, n = 0;
            for (let y = 0; y < H; y++) for (let x = x0; x < x0 + W / 2; x++) {
                const i = (y * W + x) * 4, v = px[i] + px[i + 1] + px[i + 2];
                if (v >= max * 0.9 && v > 30) { sx += x - x0; n++; }
            }
            return { lit: lit / (W / 2 * H), brightX: n ? sx / n / (W / 2) : null };
        };
        let picture = null;
        if (window.__xrSave) {
            // Rows bottom-up as GL reads them; a picture's go top-down.
            const c = document.createElement('canvas'); c.width = W; c.height = H;
            const img = c.getContext('2d').createImageData(W, H);
            for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
            c.getContext('2d').putImageData(img, 0, 0);
            picture = c.toDataURL('image/png');
        }
        return { picture, left: half(0), right: half(W / 2), pageFramesDuring: window.__xr.pageFramesDuring, frames: window.__xr.frames,
            depthNear: window.__xr.depthNear, depthFar: window.__xr.depthFar };
    });
    if (SAVE && read.picture) {
        writeFileSync(SAVE, Buffer.from(read.picture.split(',')[1], 'base64'));
        console.log(`wrote ${SAVE}`);
    }
    check(read.left.lit > 0.05 && read.right.lit > 0.05, 'both eyes drew the scene into their half of the framebuffer',
        `lit left ${(read.left.lit * 100).toFixed(1)}%, right ${(read.right.lit * 100).toFixed(1)}%`);
    check(read.left.brightX !== null && read.right.brightX !== null && read.left.brightX > read.right.brightX,
        'the cube sits further right in the left eye than in the right (stereo, the right way round)',
        `left eye x ${read.left.brightX?.toFixed(3)}, right eye x ${read.right.brightX?.toFixed(3)}`);
    check(read.depthNear === 1 && read.depthFar === 10000, 'the session builds its projections for the camera\'s clip planes',
        `near ${read.depthNear}, far ${read.depthFar}`);
    const probe = await page.evaluate(() => globalThis.__xrProbe);
    const hand = probe?.hand;
    check(!!hand && Math.abs(hand.x - 15) < 0.5 && Math.abs(hand.y - 135) < 0.5 && Math.abs(hand.z - 460) < 0.5,
        "the right hand entity sits at the controller's grip, through the rig",
        hand ? `at (${hand.x.toFixed(2)}, ${hand.y.toFixed(2)}, ${hand.z.toFixed(2)}), want (15, 135, 460)` : 'never placed');
    check(probe?.pressed === 1 && probe?.released === 1 && probe?.down === 10,
        'the trigger held ten frames reaches a game system as one press, ten frames down, one release',
        JSON.stringify({ pressed: probe?.pressed, down: probe?.down, released: probe?.released }));
    const counters = await page.evaluate(() => window.__xr.counters);
    const planned = counters.filter((c) => (c['render.shadow.collects'] ?? 0) > 0 || c['render.shadow.reused'] === 1).length;
    const kept = counters.filter((c) => c['render.shadow.reused'] === 1 && c['render.shadow.collectSkipped'] === 1 && !c['render.shadow.tiles']).length;
    check(counters.length > 0 && planned === counters.length && kept === counters.length,
        'both eyes read one shadow atlas, kept from frame to frame (no eye redraws or recollects it)',
        `${kept} of ${counters.length} frames kept it` + (counters[0] ? `; last: reused ${counters.at(-1)['render.shadow.reused']}, skipped ${counters.at(-1)['render.shadow.collectSkipped']}, tiles ${counters.at(-1)['render.shadow.tiles']}` : ''));
    check(read.pageFramesDuring === 0, 'the page\'s own frames stopped while the headset presented', `${read.pageFramesDuring} page frame(s)`);

    await page.getByRole('button', { name: 'Exit VR' }).click();
    await page.waitForFunction(() => window.__xr.ended, null, { timeout: 10_000, polling: 100 });
    const left = await page.waitForFunction((n) => {
        const l = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Enter VR');
        return l && l.style.display !== 'none';
    }, null, { timeout: 10_000, polling: 100 }).then(() => true, () => false);
    check(left, 'Exit VR leaves the headset and offers Enter VR again');
    const summary = logs.find((l) => /left VR: \d+ frame\(s\) shown, \d+ drawn too late/.test(l)) ?? '';
    const late = Number(/(\d+) drawn too late/.exec(summary)?.[1] ?? NaN);
    const shown = Number(/left VR: (\d+) frame/.exec(summary)?.[1] ?? NaN);
    check(shown >= 30 && late === 0, 'every frame was drawn inside its session callback', summary || 'no summary logged');
    // The page's frames again: the App asks requestAnimationFrame once more.
    const resumed = await page.evaluate(async () => {
        const before = performance.now();
        await new Promise((r) => requestAnimationFrame(r));
        return performance.now() - before < 1000;
    });
    check(resumed, 'the page draws its own frames again after leaving');
    const errors = logs.filter((l) => /pageerror|could not enter VR|\[error\]|Uncaught/i.test(l));
    check(errors.length === 0, 'no errors on the page', errors.slice(0, 3).join(' | '));
} finally {
    server.close();
    await browser.close();
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

if (failures.length) {
    console.error(`\nverify-xr: ${failures.length} check(s) failed.`);
    process.exit(1);
}
console.log('\nverify-xr: VR enters, draws both eyes and leaves.');
