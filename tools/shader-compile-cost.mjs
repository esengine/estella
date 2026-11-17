// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  shader-compile-cost.mjs
 * @brief What compiling shaders costs a package between page load and its first frames: how many programs, and how long the page was blocked on them.
 *
 * The page's WebGL context is wrapped before the engine runs, and the calls that wait for the driver are timed: compileShader and linkProgram only
 * queue work, getShaderParameter(COMPILE_STATUS) and getProgramParameter(LINK_STATUS) are where the page stops until it is done. A program that is
 * queried right after each stage waits for each in turn; one queried once, after both, can overlap them.
 *
 *   node tools/shader-compile-cost.mjs [--dir output/tw-export] [--frames 30] [--w 1280] [--h 720]
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { serveHost } from './lib/staticServer.mjs';
import { toolArgs } from './lib/toolArgs.mjs';
import { ROOT } from './lib/repo.mjs';
import { cpuSlowdown, slowCpu, slowdownLabel } from './lib/phoneCpu.mjs';

const ARGS = toolArgs({ dir: null, w: '1280', h: '720', frames: '30', slow: null, async: false });
/** How many times slower than this machine the page's CPU runs: a phone's 5 unless --slow says otherwise (lib/phoneCpu.mjs). */
const SLOW = cpuSlowdown(ARGS.slow);
const DIR = path.resolve(ARGS.dir ?? path.join(ROOT, 'output', 'tw-export'));
const W = Number(ARGS.w);
const H = Number(ARGS.h);
const FRAMES = Number(ARGS.frames);

const wrap = () => {
  const stats = { programs: 0, shaders: 0, statusWaits: 0, waitMs: 0, maxWaitMs: 0, issueMs: 0, ext: false, longest: [] };
  window.__shaderStats = stats;
  const proto = WebGL2RenderingContext.prototype;
  const issue = (ms) => { stats.issueMs += ms; };
  const wait = (ms) => { stats.statusWaits++; stats.waitMs += ms; if (ms > stats.maxWaitMs) stats.maxWaitMs = ms; if (ms > 5) stats.longest.push(+ms.toFixed(1)); };
  const origCompile = proto.compileShader; proto.compileShader = function (s) { const t = performance.now(); origCompile.call(this, s); stats.shaders++; issue(performance.now() - t); };
  const origLink = proto.linkProgram; proto.linkProgram = function (p) { const t = performance.now(); origLink.call(this, p); stats.programs++; issue(performance.now() - t); };
  const sources = new Map();
  const origSource = proto.shaderSource; proto.shaderSource = function (sh, src) { sources.set(sh, src); origSource.call(this, sh, src); };
  const origAttach = proto.attachShader; proto.attachShader = function (p, sh) { (p.__stages ||= []).push(sh); origAttach.call(this, p, sh); };
  stats.log = [];
  const label = (p) => {
    const fs = (p.__stages || []).map((sh) => sources.get(sh) || '').find((src) => src.includes('fragColor') || src.includes('precision')) || '';
    return `${(p.__stages || []).reduce((n, sh) => n + (sources.get(sh) || '').length, 0)}B, fragment ${fs.length}B, ${(p.__stages || []).some((sh) => sh.__asked) ? 'made waiting (sync)' : 'deferred'}`;
  };
  const origShaderParam = proto.getShaderParameter;
  proto.getShaderParameter = function (s, pname) { if (pname === this.COMPILE_STATUS) s.__asked = true; const t = performance.now(); const r = origShaderParam.call(this, s, pname); if (pname === this.COMPILE_STATUS) wait(performance.now() - t); return r; };
  const origProgramParam = proto.getProgramParameter;
  proto.getProgramParameter = function (p, pname) { const t = performance.now(); const r = origProgramParam.call(this, p, pname); if (pname === this.LINK_STATUS) { const ms = performance.now() - t; wait(ms); if (ms > 5) stats.log.push(`${label(p)} ${ms.toFixed(0)}ms @${(t / 1000).toFixed(1)}s`); if (ms > 1500) (stats.dump ||= []).push({ ms: Math.round(ms), vs: sources.get((p.__stages || [])[0]) || '', fs: sources.get((p.__stages || [])[1]) || '' }); if (ms > 1500) (stats.stacks ||= []).push(new Error().stack.split(String.fromCharCode(10)).slice(1, 14).join(' | ')); } return r; };
  const origExt = proto.getExtension;
  proto.getExtension = function (name) { if (name === 'KHR_parallel_shader_compile') stats.ext = true; return origExt.call(this, name); };
};

// --async turns the package's quality.asyncShaderCompile on for the run (and puts the config back after).
const ASYNC = ARGS.async;
const configPath = path.join(DIR, 'game.config.json');
const { readFile, writeFile } = await import('node:fs/promises');
const originalConfig = await readFile(configPath, 'utf8');
if (ASYNC) {
  const cfg = JSON.parse(originalConfig);
  cfg.quality = { ...cfg.quality, asyncShaderCompile: true };
  await writeFile(configPath, JSON.stringify(cfg));
}
const server = await serveHost(DIR);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-unsafe-swiftshader', '--disable-gpu-shader-disk-cache'] });
try {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await slowCpu(page, SLOW);
  console.log(slowdownLabel(SLOW));
  await page.addInitScript(wrap);
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__estellaCooked?.facts && window.__estellaCooked.bakes, null, { timeout: 120000 });
  const booted = Date.now() - t0;
  const atBoot = await page.evaluate(() => JSON.parse(JSON.stringify(window.__shaderStats)));
  await page.evaluate(() => window.__estellaCooked.setPaused(true));
  // The frames after the page is up, until the world has laid itself out (the example's plants and terrain grow on worker threads): the programs a
  // frame asks for the first time (a material's variant, a pass's) are compiled here, in the middle of play.
  const frameMs = await page.evaluate(async (frames) => {
    const c = window.__estellaCooked;
    const out = [];
    let steady = 0;
    for (let i = 0; i < 600 && out.length < frames + 600; i++) {
      const t = performance.now();
      await c.step(1, 1 / 60);
      c.capture();
      out.push(+(performance.now() - t).toFixed(1));
      const k = c.render();
      const settledNow = c.bakes().length === 0 && i > 20 && !(k['render.draws.waitingForProgram'] > 0);
      if (settledNow && !window.__settledAt) window.__settledAt = Math.round(performance.now());
      if (settledNow && ++steady > frames) break;
      await new Promise((r) => setTimeout(r, 16));
    }
    return out;
  }, FRAMES);
  const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.__shaderStats)));
  const counters = await page.evaluate(async () => { const c = window.__estellaCooked; c.render(); await c.step(2, 1 / 60); return c.render(); });
  console.log(`the world laid out and nothing waiting on a program at ${await page.evaluate(() => window.__settledAt)} ms of page time (the page started its clock ${await page.evaluate(() => Math.round(performance.now()))} ms ago)`);
  console.log(`counters: waitingForProgram ${counters['render.draws.waitingForProgram'] ?? 'unset (policy off)'}, pending ${counters['render.programs.pending'] ?? 'unset'}`);
  const sorted = [...frameMs].sort((a, b) => a - b);
  console.log(`boot ${booted} ms to the engine up`);
  console.log(`  by then: ${atBoot.programs} programs (${atBoot.shaders} stages), page blocked ${atBoot.waitMs.toFixed(0)} ms on ${atBoot.statusWaits} status reads, longest ${atBoot.maxWaitMs.toFixed(0)} ms, ${atBoot.issueMs.toFixed(0)} ms issuing; parallel-compile extension asked for: ${atBoot.ext}`);
  console.log(`the ${frameMs.length} frames after it (to the world laid out): ${after.programs - atBoot.programs} more programs, blocked ${(after.waitMs - atBoot.waitMs).toFixed(0)} ms`);
  console.log(`  frames over 50 ms: ${frameMs.filter((x) => x > 50).length}; first ${frameMs.slice(0, 4).join(' ')} ... median ${sorted[Math.floor(sorted.length / 2)]}, worst ${sorted[sorted.length - 1]}`);
  console.log(`  waits over 5 ms (ms): ${after.longest.slice(0, 24).join(' ')}`);
  if (process.env.DUMP_SLOW && after.dump) { const { writeFile, mkdir } = await import('node:fs/promises'); await mkdir('output/slow-shaders', { recursive: true }); for (const [i, d] of after.dump.entries()) { await writeFile(`output/slow-shaders/${i}-${d.ms}ms.vert`, d.vs); await writeFile(`output/slow-shaders/${i}-${d.ms}ms.frag`, d.fs); } console.log(`dumped ${after.dump.length} programs`); }
  if (after.stacks) console.log(['  stacks of the long waits:', ...after.stacks].join(String.fromCharCode(10) + '    '));
  console.log(['  link waits over 5 ms:', ...after.log].join(String.fromCharCode(10) + '    '));
} finally {
  await writeFile(configPath, originalConfig);
  await browser.close();
  server.close();
}
