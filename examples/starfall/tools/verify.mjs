import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { servePreview } from './preview.mjs';
const out = path.resolve(process.argv[2] || 'output/starfall'); await mkdir(out, { recursive: true });
const server = await servePreview(path.join(out, 'web'));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
const errors = [], warnings = [], checks = [];
const url = `http://127.0.0.1:${server.address().port}/?headless`;
function listen(page) { page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); }); page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); }); }
async function ready(page) { await page.goto(url); await page.waitForFunction(() => window.__estellaCooked?.facts().ready && window.__estellaCooked.facts().frame > 15 && !document.getElementById('es-splash'), null, { timeout: 60000 }); }
const facts = page => page.evaluate(() => window.__estellaCooked.facts());
const pause = (page, value) => page.evaluate(v => window.__estellaCooked.setPaused(v), value);
const step = (page, n) => page.evaluate(n => window.__estellaCooked.step(n), n);
async function observe(page) { const frame = (await facts(page)).frame; await page.waitForFunction(f => window.__estellaCooked.facts().frame > f + 2, frame); }
async function click(page, x, y) { await pause(page, false); await page.mouse.click(x, y); await observe(page); await pause(page, true); await step(page, 2); }
async function key(page, code, frames = 1) { await pause(page, false); await page.keyboard.down(code); await observe(page); await pause(page, true); if (frames > 1) await step(page, frames); await page.keyboard.up(code); await step(page, 2); }
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); listen(page); await ready(page); await pause(page, true); await step(page, 3);
    assert.equal((await facts(page)).phase, 'lobby'); await page.screenshot({ path: path.join(out, 'lobby.png') });
    await click(page, 1010, 46); assert.equal((await facts(page)).sound, false); await click(page, 1010, 46); assert.equal((await facts(page)).sound, true);
    await click(page, 1150, 46); assert.equal((await facts(page)).reduced, true); assert.equal((await facts(page)).particleCap, 80); await click(page, 1150, 46);
    checks.push('Native lobby, sound toggle and quality toggle respond to real pointer input');
    await click(page, 1060, 500); assert.equal((await facts(page)).phase, 'entering'); await step(page, 25); await page.screenshot({ path: path.join(out, 'entering.png') }); await step(page, 60);
    assert.equal((await facts(page)).phase, 'playing'); checks.push('The gate transitions from lobby to a playable trial without a scene reload');
    const before = (await facts(page)).x; await key(page, 'd', 40); assert.ok((await facts(page)).x > before + 150);
    await key(page, 'Space', 6); assert.ok((await facts(page)).y > -126); await step(page, 80); assert.equal((await facts(page)).y, -126);
    await key(page, 'k', 6); assert.ok((await facts(page)).dashes > 0);
    // A tap whose down/up both occur between render frames must still cast.
    await pause(page, false); await page.keyboard.press('e'); await observe(page); await pause(page, true); assert.equal((await facts(page)).novas, 1);
    await step(page, 10); await page.screenshot({ path: path.join(out, 'combat.png') });
    await key(page, 'j', 70); assert.ok((await facts(page)).attacks > 1); checks.push('Movement, jump/landing, dash, rapid keyboard tap and held attack work');
    await click(page, 1182, 104); const frozen = await facts(page); assert.equal(frozen.phase, 'paused'); await step(page, 180); assert.equal((await facts(page)).remaining, frozen.remaining);
    await click(page, 640, 490); assert.equal((await facts(page)).phase, 'playing');
    await click(page, 1182, 104); await click(page, 640, 575); assert.equal((await facts(page)).phase, 'lobby');
    await click(page, 1060, 500); await step(page, 85); assert.equal((await facts(page)).kills, 0); assert.equal((await facts(page)).health, 100);
    checks.push('Pause freezes the simulation; resume, return and new-round reset work');
    await pause(page, false); await page.keyboard.down('j'); await observe(page); await pause(page, true);
    for (let i = 0; i < 30 && (await facts(page)).phase === 'playing'; i++) {
        const direction = i % 2 ? 'a' : 'd';
        await pause(page, false); await page.keyboard.down(direction); if (i % 3 === 0) await page.keyboard.down('e'); await page.keyboard.down('k'); await observe(page); await pause(page, true);
        await step(page, 120); await page.keyboard.up(direction); await page.keyboard.up('e'); await page.keyboard.up('k'); await step(page, 2);
    }
    await page.keyboard.up('j'); const victory = await facts(page); assert.equal(victory.phase, 'won'); assert.equal(victory.kills, 18); await page.screenshot({ path: path.join(out, 'victory.png') });
    await click(page, 640, 490); assert.equal((await facts(page)).phase, 'entering'); checks.push('A complete round reaches victory using real keys; the result screen can retry');
    const renderer = await page.evaluate(() => ({ drawn: window.__estellaCooked.drawn(), config: window.__estellaCooked.configFacts(), render: window.__estellaCooked.renderFacts() }));
    assert.equal(renderer.config.audio.maxVoices, 8);

    const mobile = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); listen(mobile); await ready(mobile);
    const scale = 390 / 720, dx = (844 - 1280 * scale) / 2;
    const point = (x, y, id) => ({ x: dx + x * scale, y: y * scale, id, radiusX: 4, radiusY: 4, force: 1 });
    await mobile.screenshot({ path: path.join(out, 'mobile-lobby.png') });
    await mobile.touchscreen.tap(dx + 1060 * scale, 500 * scale); await mobile.waitForFunction(() => window.__estellaCooked.facts().phase === 'playing');
    const cdp = await mobile.context().newCDPSession(mobile); const initial = await facts(mobile);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(145, 620, 1), point(1152, 615, 2)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(197, 620, 1), point(1152, 615, 2)] });
    await mobile.waitForTimeout(600); const moved = await facts(mobile); assert.ok(moved.x > initial.x + 80); assert.ok(moved.attacks > initial.attacks);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await mobile.waitForTimeout(100); const released = await facts(mobile); await mobile.waitForTimeout(200); assert.equal((await facts(mobile)).x, released.x);
    await mobile.touchscreen.tap(dx + 1003 * scale, 560 * scale); await mobile.waitForTimeout(180); assert.equal((await facts(mobile)).novas, 1);
    await mobile.screenshot({ path: path.join(out, 'mobile-combat.png') });
    checks.push('844×390 / DPR 2 touch layout, simultaneous joystick + attack, touch cancellation and nova tap');
    assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
    const report = { status: 'passed', checks, errors, warnings, victory, renderer, mobile: await facts(mobile), scope: 'Headless Chromium/WebGL2 desktop and mobile emulation. WeChat package export is checked separately; this is not physical-device acceptance.' };
    await writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ status: report.status, checks, victory }));
} catch (e) { await writeFile(path.join(out, 'verification-failure.json'), JSON.stringify({ error: String(e), checks, errors, warnings }, null, 2)); throw e; }
finally { await browser.close(); server.close(); }
