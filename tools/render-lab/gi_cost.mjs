// What a GI variant of a lab scene costs a frame and how many frames its light takes to arrive, in headless Chromium (WebGL2).
// usage: node gi_cost.mjs <web_dir> [...]     prints frame ms (median of 20 x 8 frames), GPU ms per pass, and the frame's mean
// luminance after 1, 4, 16, 64 and 240 frames, as a share of the last.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../node_modules/playwright/index.mjs')).href);
const { serveHost } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../lib/staticServer.mjs')).href);

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (const dir of process.argv.slice(2)) {
    const server = await serveHost(path.resolve(dir));
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => window.__estellaCooked?.facts, null, { timeout: 120000 });
      await page.evaluate(() => window.__estellaCooked.setPaused(true));
      const r = await page.evaluate(async () => {
        const c = window.__estellaCooked;
        const lum = () => { const { rgba } = c.capture(); let s = 0; for (let i = 0; i < rgba.length; i += 4) s += rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722; return s / (rgba.length / 4); };
        // Shaders compile on first use: a few frames, then the light is counted from frame 1.
        for (let i = 0; i < 40; i++) { await c.step(1, 1 / 60); if (!(c.render()['render.draws.waitingForProgram'] > 0) && i > 4) break; await new Promise((res) => setTimeout(res, 30)); }
        const curve = [];
        let done = 0;
        for (const n of [1, 4, 16, 64, 240]) { await c.step(n - done, 1 / 60); done = n; curve.push([n, lum()]); }
        c.render(); c.costs();
        const ms = [];
        for (let s = 0; s < 20; s++) { const t0 = performance.now(); await c.step(8, 1 / 60); c.capture(); ms.push((performance.now() - t0) / 8); }
        const gpu = [];
        for (let s = 0; s < 12; s++) { await c.step(4, 1 / 60); c.capture(); await new Promise((res) => setTimeout(res, 40)); gpu.push(c.gpu?.() ?? {}); }
        return { curve, ms, gpu };
      });
      const keys = new Set(r.gpu.flatMap((g) => Object.keys(g)));
      const passes = [...keys].map((k) => [k, median(r.gpu.map((g) => g[k]).filter((v) => typeof v === 'number' && v >= 0))]).filter(([, v]) => v !== undefined && v > 0.02).sort((a, b) => b[1] - a[1]);
      const last = r.curve.at(-1)[1] || 1;
      console.log(`${path.basename(dir)}: frame ${median(r.ms).toFixed(2)} ms | light by frame ${r.curve.map(([n, l]) => `${n}:${(l / last).toFixed(2)}`).join(' ')}`);
      console.log('   gpu ' + passes.slice(0, 10).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
    } finally {
      await page.close();
      server.close();
    }
  }
} finally {
  await browser.close();
}
