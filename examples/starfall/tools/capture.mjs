import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { servePreview } from './preview.mjs';
const out = path.resolve('output/starfall'); await mkdir(out, { recursive: true });
const server = await servePreview(path.join(out, 'web'));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
const errors = [], logs = [];
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__estellaCooked?.facts().ready, null, { timeout: 60000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, 'lobby.png') });
    console.log('lobby', await page.evaluate(() => window.__estellaCooked.facts()));
    await page.mouse.click(1060, 500); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, 'entering.png') });
    await page.waitForTimeout(2000);
    console.log('playing', await page.evaluate(() => window.__estellaCooked.facts()));
    await page.keyboard.down('j'); await page.keyboard.down('d'); await page.waitForTimeout(700); await page.keyboard.up('d');
    await page.keyboard.press('e'); await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(out, 'combat.png') });
    await page.keyboard.up('j');
    await writeFile(path.join(out, 'capture.json'), JSON.stringify({ errors, logs, facts: await page.evaluate(() => window.__estellaCooked.facts()) }, null, 2));
    console.log(JSON.stringify({ errors, logs }));
} catch (e) { console.log(JSON.stringify({ errors, logs })); throw e; }
finally { await browser.close(); server.close(); }
