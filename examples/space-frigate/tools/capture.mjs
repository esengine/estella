import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { serveHost } from '../../../tools/lib/staticServer.mjs';

const root = path.resolve('output/space-frigate');
const times = (process.argv[2] ?? '0.5,10,19,28,39,48').split(',').map(Number);
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'swiftshader';
await mkdir(path.join(root, 'frames'), { recursive: true });
const server = await serveHost(path.join(root, 'web'));
const browser = await chromium.launch({ headless: true, args: [`--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const problems = [];
try {
    const [width, height] = (process.argv[3] ?? '1600x900').split('x').map(Number);
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text().slice(0, 400)); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__estellaCooked?.facts().ready, null, { timeout: 120000 });
    await page.evaluate(() => window.__estellaCooked.setPaused(true));
    let now = (await page.evaluate(() => window.__estellaCooked.facts())).time;
    for (const at of times) {
        const frames = Math.max(1, Math.round((at - now) * 60));
        await page.evaluate((n) => window.__estellaCooked.step(n), frames);
        const facts = await page.evaluate(() => window.__estellaCooked.facts());
        now = facts.time;
        const file = path.join(root, 'frames', `t${at.toFixed(2)}.png`);
        await page.screenshot({ path: file, timeout: 60000 });
        console.log(JSON.stringify({ file, ...facts }));
    }
} finally {
    await browser.close();
    server.close();
}
console.log(JSON.stringify({ problems: [...new Set(problems)].slice(0, 30) }, null, 1));
if (problems.length > 0) process.exitCode = 1;
