// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Shipped training example with explicit local SDK mocks; no visible browser. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { toolArgs } from '../lib/toolArgs.mjs';
import { MIME as mime } from '../lib/staticServer.mjs';

const ARGS = toolArgs({ dir: null, standalone: null, out: null });
if (!ARGS.dir || !ARGS.standalone) throw new Error('Expected --dir <Poki export> --standalone <ordinary Web export>');
const out = path.resolve(ARGS.out ?? 'output/poki-training-check');
fs.mkdirSync(out, { recursive: true });
const roots = { poki: fs.realpathSync(ARGS.dir), standalone: fs.realpathSync(ARGS.standalone) };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const filesOf = (root, under = '') => fs.readdirSync(path.join(root, under), { withFileTypes: true }).flatMap(entry => {
    const file = under ? `${under}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return filesOf(root, file);
    if (!entry.isFile()) throw new Error(`Unsupported export entry: ${file}`);
    return [file];
});
const identities = Object.fromEntries(Object.entries(roots).map(([name, root]) => [name,
    Object.fromEntries(filesOf(root).map(file => [file, sha(path.join(root, file))])),
]));
const server = http.createServer((req, res) => {
    try {
        const parts = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).split('/');
        const root = roots[parts[1]];
        if (!root) throw new Error('Unknown export');
        const file = fs.realpathSync(path.resolve(root, parts.slice(2).join('/') || 'index.html'));
        if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error('Outside export');
        res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
        res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'] });
const cases = [];
const result = { mode: 'local-mock', headless: true, status: 'failed', identities,
    verifierSha256: sha(new URL(import.meta.url)), cases,
    pending: ['Official SDK and Poki Inspector acceptance', 'Physical devices and real background transitions', 'Audible quality', 'Other channels and cloud saves'] };
const position = page => page.evaluate(() => window.__estellaCooked.probe(['Player']).at.Player);
const status = page => page.evaluate(() => window.__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus?.text ?? '');

try {
    for (const viewport of [{ width: 800, height: 450 }, { width: 360, height: 640 }]) {
        for (const mode of ['normal', 'init-failed', 'sdk-missing', 'standalone']) {
            const context = await browser.newContext({ viewport, hasTouch: viewport.height > viewport.width });
            const page = await context.newPage();
            const observation = { viewport, mode, status: 'failed', errors: [], unexpectedRequests: [], events: [], screenshots: [] };
            cases.push(observation);
            page.on('pageerror', error => observation.errors.push(String(error)));
            await page.addInitScript(() => {
                window.__audioContexts = [];
                window.__audioOperations = [];
                const Original = window.AudioContext;
                if (Original) window.AudioContext = class extends Original {
                    constructor(...args) { super(...args); window.__audioContexts.push(this); }
                    resume() {
                        window.__audioOperations.push({ kind: 'resume', state: this.state, stack: new Error().stack });
                        return super.resume();
                    }
                    suspend() {
                        window.__audioOperations.push({ kind: 'suspend', state: this.state, stack: new Error().stack });
                        return super.suspend();
                    }
                };
            });
            await context.route('**/*', async route => {
                const url = route.request().url();
                if (url.startsWith(origin + '/')) return route.continue();
                if (url === 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js' && mode !== 'standalone') {
                    return route.fulfill({ contentType: 'text/javascript', body: mode === 'sdk-missing' ? '' : `
                        window.__events=[];
                        const record=event=>__events.push({event,active:navigator.userActivation.isActive});
                        window.PokiSDK={
                            init(){record('init');return ${mode === 'init-failed' ? 'Promise.reject(new Error("blocked"))' : 'Promise.resolve()'}},
                            gameLoadingFinished(){record('loaded')},gameplayStart(){record('start')},gameplayStop(){record('stop')},
                            rewardedBreak(){record('rewarded');return new Promise((resolve,reject)=>{window.__close=value=>value==='error'?reject(new Error('no fill')):resolve(value)})},
                            commercialBreak(){record('commercial');return new Promise((resolve,reject)=>{window.__close=value=>value==='error'?reject(new Error('no fill')):resolve()})}
                        };` });
                }
                observation.unexpectedRequests.push(url); return route.abort();
            });
            try {
                await page.goto(`${origin}/${mode === 'standalone' ? 'standalone' : 'poki'}/?headless`);
                await page.waitForFunction(() => window.__estellaCooked?.probe(['DeviceStatus', 'Player']).at.DeviceStatus?.text, {}, { timeout: 30000 });
                if (mode !== 'sdk-missing' && mode !== 'standalone') {
                    await page.waitForFunction(() => window.__events?.some(e => e.event === 'loaded'));
                }
                let surface = viewport;
                const click = async name => {
                    observation.lastClick = name;
                    const box = await page.evaluate(n => window.__estellaCooked.probe([n]).at[n], name);
                    assert(box, `Missing button ${name}`);
                    const scale = Math.min(surface.width / 800, surface.height / 450);
                    await page.mouse.move(surface.width / 2 + box.x * scale, surface.height / 2 - box.y * scale);
                    await page.mouse.down();
                    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                    await page.mouse.up();
                    await page.waitForTimeout(100);
                };
                const phase = expected => page.waitForFunction(prefix => window.__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text.startsWith(prefix), expected.toUpperCase(), { timeout: 5000 });
                const snapshot = async label => {
                    const file = `${mode}-${viewport.width}x${viewport.height}-${label}.png`;
                    await page.screenshot({ path: path.join(out, file) });
                    observation.screenshots.push({ file, sha256: sha(path.join(out, file)) });
                };
                const expected = mode === 'sdk-missing' || mode === 'standalone' ? [] : ['init', 'loaded'];
                const trace = async () => assert.deepEqual(await page.evaluate(() => (window.__events ?? []).map(e => e.event)), expected);
                if (viewport.height > viewport.width) {
                    assert.equal(await page.evaluate(() => document.getElementById('rotate-hint')), null);
                    assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('canvas')).display), 'none');
                    await snapshot('portrait'); await trace();
                    surface = { width: viewport.height, height: viewport.width };
                    observation.rotatedViewport = surface;
                    await page.setViewportSize(surface);
                    await page.waitForTimeout(100); await trace();
                }
                if (mode === 'standalone') {
                    assert.equal(await page.evaluate(() => !!window.__estellaCooked.probe(['TrainingStart']).at.TrainingStart), false);
                    const before = await position(page);
                    await page.keyboard.down('KeyD'); await page.waitForTimeout(180); await page.keyboard.up('KeyD');
                    assert.notDeepEqual(await position(page), before, 'Standalone controls retain their original behavior');
                    await snapshot('playing');
                } else {
                    await phase('menu'); await trace();
                    const before = await position(page);
                    await page.keyboard.down('KeyD'); await page.waitForTimeout(150); await page.keyboard.up('KeyD');
                    assert.deepEqual(await position(page), before, 'Menu input must not move the player');
                    await click('Keep awake'); await trace();
                    await snapshot('menu'); await click('TrainingStart'); await phase('playing');
                    if (mode !== 'sdk-missing') expected.push('start'); await trace();
                    if (mode !== 'normal') {
                        await click('TrainingReward'); await trace(); assert.match(await status(page), /Credits: 0/);
                        await click('TrainingPause'); await phase('paused');
                        if (mode !== 'sdk-missing') expected.push('stop'); await trace();
                        await click('TrainingStart'); await phase('playing');
                        if (mode !== 'sdk-missing') expected.push('start'); await trace();
                    } else {
                        assert.equal((await page.evaluate(() => __events.find(e => e.event === 'start'))).active, true);
                        await page.waitForFunction(() => __audioContexts.length > 0 && __audioContexts.every(c => c.state === 'running'));
                        await click('TrainingStart'); await trace();
                        await click('TrainingPause'); expected.push('stop'); await phase('paused'); await trace();
                        const frozen = await position(page);
                        await page.keyboard.down('KeyD'); await page.waitForTimeout(150); await page.keyboard.up('KeyD'); assert.deepEqual(await position(page), frozen);
                        await click('TrainingStart'); expected.push('commercial'); await phase('ad'); await trace();
                        assert.equal((await page.evaluate(() => __events.find(e => e.event === 'commercial'))).active, true);
                        await click('TrainingReward'); await click('TrainingStart'); await trace();
                        await page.waitForFunction(() => __audioContexts.every(c => c.state === 'suspended'));
                        await page.evaluate(() => __close(true)); expected.push('start'); await phase('playing'); await trace();
                        for (const [outcome, credits] of [[false, 0], [true, 1], ['error', 1]]) {
                            await click('TrainingReward'); expected.push('stop', 'rewarded'); await phase('ad'); await trace();
                            const at = await position(page);
                            await page.keyboard.down('KeyD'); await page.waitForTimeout(150); await page.keyboard.up('KeyD'); assert.deepEqual(await position(page), at);
                            await page.waitForFunction(() => __audioContexts.every(c => c.state === 'suspended'));
                            await page.evaluate(value => __close(value), outcome); expected.push('start'); await phase('playing'); await trace();
                            await page.waitForFunction(() => __audioContexts.every(c => c.state === 'running'));
                            assert.match(await status(page), new RegExp(`Credits: ${credits}`));
                        }
                        const at = await page.evaluate(() => window.__estellaCooked.probe(['Player', 'Target']).at);
                        const vertical = at.Target.y > at.Player.y ? 'KeyW' : 'KeyS';
                        if (Math.abs(at.Target.y - at.Player.y) > 15) {
                            await page.keyboard.down(vertical);
                            await page.waitForFunction(() => { const p=__estellaCooked.probe(['Player','Target']).at;return Math.abs(p.Player.y-p.Target.y)<15; }, {}, { timeout: 5000 });
                            await page.keyboard.up(vertical);
                        }
                        const current = await page.evaluate(() => window.__estellaCooked.probe(['Player', 'Target']).at);
                        const horizontal = current.Target.x > current.Player.x ? 'KeyD' : 'KeyA';
                        await page.keyboard.down(horizontal);
                        await page.waitForFunction(() => { const p=__estellaCooked.probe(['Player','Target']).at;return Math.hypot(p.Player.x-p.Target.x,p.Player.y-p.Target.y)<60; }, {}, { timeout: 6000 });
                        await page.keyboard.up(horizontal);
                        for (let hit=0;hit<3;hit++) {
                            await page.keyboard.press('Space', { delay: 80 });
                            await page.waitForFunction(expected => __estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text.includes(`Round: ${expected} / 3 hits`), hit + 1, { timeout: 5000 });
                        }
                        expected.push('stop'); await phase('finished'); await trace(); assert.match(await status(page), /Round: 3 \/ 3 hits/);
                        await snapshot('finished');
                        await click('TrainingReward'); expected.push('rewarded'); await phase('ad'); await trace();
                        await page.evaluate(() => __close(true)); await phase('finished'); await trace(); assert.match(await status(page), /Credits: 2/);
                        await click('TrainingStart'); expected.push('commercial'); await phase('ad'); await trace();
                        await page.evaluate(() => __close('error')); expected.push('start'); await phase('playing'); await trace(); assert.match(await status(page), /Round: 0 \/ 3 hits/);
                        // This checks the authored guard, not physical device backgrounding.
                        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
                        expected.push('stop'); await phase('paused'); await trace();
                        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
                        await trace(); await phase('paused'); await snapshot('paused');
                    }
                }
                if (mode !== 'standalone') {
                    const wasPlaying = (await status(page)).startsWith('PLAYING');
                    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
                    if (wasPlaying && mode !== 'sdk-missing') expected.push('stop');
                    await phase('paused'); await trace();
                    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
                    await phase('paused'); await trace();
                }
                await trace(); observation.events = await page.evaluate(() => window.__events ?? []);
                observation.audioOperations = await page.evaluate(() => __audioOperations.map(({ kind, state }) => ({ kind, state })));
                assert.deepEqual(observation.errors, []); assert.deepEqual(observation.unexpectedRequests, []);
                observation.status = 'passed';
            } catch (error) {
                observation.failure = String(error);
                observation.diagnostics = await page.evaluate(() => ({
                    events: window.__events ?? [], audioStates: (window.__audioContexts ?? []).map(c => c.state),
                    audioOperations: window.__audioOperations ?? [],
                    status: window.__estellaCooked?.probe(['DeviceStatus']).at.DeviceStatus?.text,
                    probe: window.__estellaCooked?.probe(['DeviceStatus', 'Player', 'Target']),
                    visibility: document.visibilityState,
                })).catch(diagnosticError => ({ unavailable: String(diagnosticError) }));
                const file = `${mode}-${viewport.width}x${viewport.height}-failed.png`;
                await page.screenshot({ path: path.join(out, file), timeout: 5000 }).then(() => {
                    observation.screenshots.push({ file, sha256: sha(path.join(out, file)) });
                }).catch(captureError => { observation.captureError = String(captureError); });
                throw error;
            }
            finally { await context.close(); }
        }
    }
    for (const [name, root] of Object.entries(roots)) {
        assert.deepEqual(filesOf(root).sort(), Object.keys(identities[name]).sort(), 'Export file set changed during verification');
        for (const [file, hash] of Object.entries(identities[name])) assert.equal(sha(path.join(root, file)), hash, 'Export changed during verification');
    }
    result.status = 'checks-passed';
    console.log(`Poki training: ${cases.length} headless cases passed (SDK mocks; official/device acceptance pending)`);
} finally {
    fs.writeFileSync(path.join(out, 'runtime-check.json'), JSON.stringify(result, null, 2));
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
