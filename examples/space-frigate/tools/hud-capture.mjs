import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { serveHost } from '../../../tools/lib/staticServer.mjs';

const root = path.resolve('output/space-frigate');
const out = path.join(root, 'hud');
const only = process.argv[2] ? process.argv[2].split(',') : null;
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'swiftshader';
await mkdir(out, { recursive: true });
const server = await serveHost(path.join(root, 'web'));
const browser = await chromium.launch({ headless: true, args: [`--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const problems = [];
const shots = [];
let loading = null;
try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text().slice(0, 400)); });
    const began = Date.now();
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__estellaCooked?.facts().ready, null, { timeout: 120000 });
    const sceneMs = Date.now() - began;
    await page.waitForFunction(() => window.__spaceHud?.ready || window.__spaceHud?.error, null, { timeout: 120000 }).catch(() => {});
    const state = await page.evaluate(() => window.__spaceHud ?? null);
    if (!state?.ready) throw new Error(`the HUD did not come up: ${JSON.stringify(state)}`);
    loading = { sceneMs, hudReadyMs: Date.now() - began, hudLoadMs: await page.evaluate(() => window.__spaceHud.loadMs), recipes: await page.evaluate(() => window.__estellaCooked.recipes()) };
    await page.evaluate(() => window.__estellaCooked.setPaused(true));
    await page.mouse.move(960, 540);
    const step = (n) => page.evaluate((frames) => window.__estellaCooked.step(frames), n);
    const facts = () => page.evaluate(() => window.__estellaCooked.facts());
    const until = async (time) => { const now = (await facts()).time; if (time > now) await step(Math.round((time - now) * 60)); };
    const hold = async (key, frames) => { await page.keyboard.down(key); await step(frames); await page.keyboard.up(key); };
    const tap = async (key) => { await hold(key, 2); await step(1); };
    const byHand = async (key) => { for (let tries = 0; tries < 5 && (await facts()).tour; tries++) await tap(key); if ((await facts()).tour) throw new Error(`${key} did not take the camera`); };
    const eye = async () => { const f = await facts(); return Math.hypot(f.eyeX, f.eyeY, f.eyeZ); };
    const bracketed = () => page.evaluate(() => !window.__spaceHud.waypointClamped);
    const shoot = async (name, size = [1920, 1080]) => {
        if (only && !only.includes(name)) return;
        await page.setViewportSize({ width: size[0], height: size[1] });
        await step(3);
        const file = path.join(out, `${name}.png`);
        await page.screenshot({ path: file, timeout: 60000 });
        const f = await facts();
        shots.push({ name, size: size.join('x'), time: f.time, throttle: f.throttle, tour: f.tour, shot: f.shot });
        await page.setViewportSize({ width: 1920, height: 1080 });
        await step(2);
    };

    await until(4);
    await shoot('front-quarter');
    await shoot('front-quarter-720', [1280, 720]);
    await shoot('front-quarter-ultrawide', [2560, 1080]);
    await hold('KeyW', 30);
    await step(8);
    await shoot('throttle-rising');
    await hold('KeyW', 60);
    await until(31);
    await shoot('throttle-full');
    await hold('KeyS', 150);
    await until(66);
    await shoot('throttle-zero');
    await hold('KeyW', 68);
    await step(200);
    await byHand('Digit4');
    await hold('KeyE', 26);
    for (let turns = 0; turns < 40 && !(await bracketed()); turns++) await hold('KeyA', 2);
    await hold('KeyA', 6);
    await step(4);
    await shoot('cruise-far');
    await shoot('cruise-far-720', [1280, 720]);
    const from = await eye();
    for (let tries = 0; tries < 8 && Math.abs(await eye() - from) < 1; tries++) await tap('Digit2');
    await page.mouse.move(960, 540);
    for (let tries = 0; tries < 12 && await eye() > 60; tries++) {
        const before = await eye();
        await page.mouse.wheel(0, -160);
        await step(2);
        if (await eye() > before + 0.5) { await page.mouse.wheel(0, 320); await step(2); }
    }
    await step(20);
    await shoot('engines-close');
} catch (err) {
    problems.push(String(err));
} finally {
    await browser.close();
    server.close();
}
console.log(JSON.stringify({ loading, shots, problems: [...new Set(problems)].slice(0, 30) }, null, 1));
if (problems.length > 0) process.exitCode = 1;
