import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../node_modules/playwright/index.mjs')).href);
const { serveHost } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../lib/staticServer.mjs')).href);
const out = process.argv[2];
const web = process.argv[3];
const view = process.argv[4] ?? 'front';
const server = await serveHost(path.resolve(web));
const gpu = process.env.BACKEND === 'webgpu';
const browser = await chromium.launch({ ...(process.env.HEADLESS_GPU === '1' ? { channel: 'chromium' } : {}), headless: (gpu && process.env.HEADLESS_GPU === '1') || (!gpu && process.env.HEADED !== '1'), args: gpu ? (process.env.HEADLESS_GPU === '1' ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] : ['--enable-unsafe-webgpu', '--disable-gpu-sandbox', '--ignore-gpu-blocklist']) : ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const logs = [];
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) }, deviceScaleFactor: 1 });
  page.on('response', (r) => { if (r.status() >= 400) logs.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', (e) => logs.push('pageerror ' + String(e)));
  page.on('console', (m) => { if (process.env.DEBUG_LOGS === '1' || m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ' ' + m.text().slice(0, 700)); });
  await page.goto(`http://127.0.0.1:${server.address().port}/${gpu ? "" : "?headless"}`, { waitUntil: 'load' });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: out + `/lab-${view}.png`, timeout: 120000 }).catch((e) => logs.push('screenshot ' + String(e).slice(0, 160)));
  console.log('context:', await page.evaluate(() => { const c = document.querySelector('canvas'); return c ? (c.getContext('webgpu') ? 'webgpu' : c.getContext('webgl2') ? 'webgl2' : 'unknown') : 'no canvas'; }).catch((e) => String(e)));
  const facts = await page.evaluate(() => (window.__estellaCooked ? window.__estellaCooked.facts() : 'no hook')).catch((e) => String(e));
  console.log(JSON.stringify(facts).slice(0, 400));
} finally {
  await browser.close();
  server.close();
}
console.log(logs.slice(0, 60).join('\n'));
