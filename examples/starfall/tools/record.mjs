import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { servePreview } from './preview.mjs';

// Real input and wall-clock playback. This video illustrates the actions;
// benchmark.mjs, without video capture, measures the shipping frame cadence.
const out = path.resolve(process.argv[2] || 'output/starfall');
await mkdir(path.join(out, 'recording'), { recursive: true });
const server = await servePreview(path.join(out, 'web'));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
const errors = [];
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: path.join(out, 'recording'), size: { width: 1280, height: 720 } } });
    const page = await context.newPage(), video = page.video();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`);
    await page.waitForFunction(() => window.__estellaCooked?.facts().ready && window.__estellaCooked.facts().frame > 20 && !document.getElementById('es-splash'), null, { timeout: 60000 });
    const shots = [];
    const wait = ms => page.waitForTimeout(ms);
    async function shot(name) { const facts = await page.evaluate(() => window.__estellaCooked.facts()); shots.push({ name, facts }); await page.screenshot({ path: path.join(out, 'recording', name + '.png') }); }
    async function hold(key, ms) { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); }
    await wait(900); await page.mouse.click(1060, 500); await wait(1650);
    await hold('d', 700); await hold('a', 400); await wait(180);
    await page.keyboard.down('d'); await page.keyboard.press('Space'); await wait(270); await shot('jump'); await wait(430); await page.keyboard.up('d');
    await page.keyboard.press('k'); await wait(80); await shot('dash'); await wait(280);
    await page.keyboard.down('a'); await page.keyboard.down('j'); await wait(1250); await page.keyboard.up('a'); await shot('combo'); await wait(1100);
    await page.keyboard.up('j'); await page.keyboard.press('e'); await wait(230); await shot('charge'); await wait(340); await shot('nova'); await wait(800);
    await page.keyboard.down('d'); await page.keyboard.down('j'); await wait(1750); await page.keyboard.press('k'); await wait(350); await page.keyboard.up('d');
    await hold('a', 1600); await page.keyboard.up('j'); await wait(180);
    await page.keyboard.press('e'); await wait(650); await shot('final'); await wait(900);
    const final = await page.evaluate(() => window.__estellaCooked.facts());
    await context.close(); await video.saveAs(path.join(out, 'starfall-gameplay.webm'));
    if (errors.length) throw new Error(errors.join('\n'));
    await writeFile(path.join(out, 'recording.json'), JSON.stringify({ errors, shots, final, video: 'starfall-gameplay.webm', scope: 'Real-time headless browser input capture; not the performance benchmark.' }, null, 2) + '\n');
    console.log(JSON.stringify({ video: path.join(out, 'starfall-gameplay.webm'), final }));
} finally { await browser.close(); server.close(); }
