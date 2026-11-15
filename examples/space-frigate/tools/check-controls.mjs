import { chromium } from 'playwright';
import path from 'node:path';
import { serveHost } from '../../../tools/lib/staticServer.mjs';

const root = path.resolve('output/space-frigate');
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'swiftshader';
const server = await serveHost(path.join(root, 'web'));
const browser = await chromium.launch({ headless: true, args: [`--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const problems = [];
const findings = [];
const expect = (what, ok, detail) => { findings.push({ what, ok, detail }); if (!ok) problems.push(`${what}: ${JSON.stringify(detail)}`); };
try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 400)); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__estellaCooked?.facts().ready, null, { timeout: 120000 });
    await page.evaluate(() => window.__estellaCooked.setPaused(true));
    const step = (n) => page.evaluate((frames) => window.__estellaCooked.step(frames), n);
    const facts = () => page.evaluate(() => window.__estellaCooked.facts());
    const tap = async (key) => { await page.keyboard.down(key); await step(1); await page.keyboard.up(key); await step(1); };
    const camera = () => page.evaluate(() => { const f = window.__estellaCooked.facts(); return [f.eyeX, f.eyeY, f.eyeZ]; });
    await page.mouse.move(400, 225);

    await step(30);
    const idle = await facts();
    expect('the tour runs untouched', idle.tour === true && Math.abs(idle.throttle - 0.65) < 0.02, idle);

    await page.keyboard.down('KeyS');
    await step(150);
    await page.keyboard.up('KeyS');
    const slow = await facts();
    expect('S eases the throttle down', slow.throttle < 0.1, slow.throttle);
    expect('the throttle alone leaves the tour running', slow.tour === true, slow.tour);

    await page.keyboard.down('KeyW');
    await step(240);
    await page.keyboard.up('KeyW');
    const fast = await facts();
    expect('W pushes it to full', fast.throttle > 0.9, fast.throttle);

    const before = await camera();
    await page.keyboard.down('KeyD');
    await step(60);
    await page.keyboard.up('KeyD');
    const turned = await facts();
    const after = await camera();
    expect('D takes the camera by hand', turned.tour === false, turned.tour);
    expect('and turns it round the ship', Math.hypot(after[0] - before[0], after[2] - before[2]) > 20, { before, after });

    await tap('Digit5');
    const near = await camera();
    expect('5 jumps to the close shot', Math.abs(Math.hypot(near[0], near[1] - 7, near[2] + 15) - 36) < 0.5, near);

    await page.mouse.down();
    for (let x = 420; x <= 520; x += 20) {
        await page.mouse.move(x, 225);
        await step(1);
    }
    await page.mouse.up();
    const dragged = await camera();
    expect('a drag orbits', Math.hypot(dragged[0] - near[0], dragged[2] - near[2]) > 3, { near, dragged });

    await tap('Space');
    const back = await facts();
    expect('Space hands the camera back to the tour', back.tour === true, back);
} finally {
    await browser.close();
    server.close();
}
console.log(JSON.stringify({ findings, problems: [...new Set(problems)] }, null, 1));
if (problems.length > 0) process.exitCode = 1;
