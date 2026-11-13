// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  render-submit-cost.mjs — what the renderer's CPU costs a frame to collect and submit draws, measured headless.
 *
 * The CPU side of drawing - walking the scene into a draw list, sorting and merging it, and issuing it to the device -
 * is where an engine built on an ECS should be cheapest. This plays a scene in a headless Chromium (no window, no
 * editor), steps it by the game's own clock until it has settled, and reads the engine's own CPU scopes for the
 * frames that follow: `render.collect`, `render.submit` and the rest, with the draw counts beside them.
 *
 *   node tools/render-submit-cost.mjs                                   # the synthetic scene, every material spread
 *   node tools/render-submit-cost.mjs --scene bistro                    # the Bistro example
 *   node tools/render-submit-cost.mjs --only unique --count 8192        # one spread, more entities
 *   node tools/render-submit-cost.mjs --profile --top 40                # also sample the CPU, by function
 *   node tools/render-submit-cost.mjs --no-export --dir <package>       # an already exported package (A/B builds)
 *
 * The synthetic scene is `--count` static entities in a grid, all in view, cycling the six closed built-in meshes, in
 * one of three material spreads: `shared` (one material, what an engine should merge), `mats64` (64 materials, a game),
 * `unique` (a material each, the worst case). A function-level profile names wasm functions only from a names build
 * (see the wasm-size notes: ESTELLA_WASM_NAMES=1 with --profiling-funcs).
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveHost } from './lib/staticServer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const SCENE = flag('scene', 'synthetic');
const COUNT = Number(flag('count', '4096'));
const FRAMES = Number(flag('frames', '30'));
const SAMPLES = Number(flag('samples', '5'));
const W = Number(flag('w', '1920'));
const H = Number(flag('h', '1080'));
const TOP = Number(flag('top', '30'));
/** Function names (substrings, comma separated) whose INCLUSIVE time a profile also reports: every sample with one on its stack. */
const INCL = flag('incl', '') ? flag('incl', '').split(',') : [];
const PROFILE = argv.includes('--profile');
/** Count every WebGL call per frame: the CPU work a frame hands the browser, which no GPU stall can hide. */
const GLCALLS = argv.includes('--glcalls');
/** Time frames with the engine's profiler left off: what a frame costs a player, not a profiled one. No scopes are read. */
const WALL = argv.includes('--wall');
// --audit: after the scene settles, turn on the engine's change audit, play two seconds, and list the component types written
// without a change stamp (World.setChangeAudit) - the census of what a consumer of changes would not see.
const AUDIT = argv.includes('--audit');
const NO_EXPORT = argv.includes('--no-export');
const ONLY = flag('only', '') ? new Set(flag('only', '').split(',')) : null;
/** A png of the last measured frame, to compare two builds' pictures. */
const SHOT = flag('shot', '');
const OUT = flag('out', path.join(ROOT, 'output', 'perf', `render-submit-${SCENE}.json`));
const MESHES = ['cube', 'sphere', 'capsule', 'cylinder', 'cone', 'plane'];
const SPREADS = SCENE === 'synthetic' ? ['shared', 'mats64', 'unique'] : ['scene'];

/** What the exporter cooks an asset by: a uuid and its type, beside it. */
const meta = (file, type) => writeFile(`${file}.meta`, JSON.stringify({ uuid: randomUUID(), version: '2.0', type, importer: {} }));

/** The synthetic project: a camera over a grid of static meshes, a sun and a sky, in one material spread. */
async function writeSynthetic(dir, spread) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'assets/scenes'), { recursive: true });
  await mkdir(path.join(dir, 'assets/materials'), { recursive: true });
  await writeFile(path.join(dir, 'project.esproject'), JSON.stringify({ name: 'RenderSubmitCost', version: '1.0', defaultScene: 'assets/scenes/main.esscene' }));
  const materials = spread === 'shared' ? 1 : spread === 'mats64' ? 64 : COUNT;
  for (let m = 0; m < materials; m++) {
    await writeFile(path.join(dir, `assets/materials/m${m}.esmaterial`), JSON.stringify({
      version: '1.0', type: 'material', shader: 'builtin:model', blendMode: 0, depthTest: true, depthWrite: true, cull: 0,
      properties: { u_metallic: (m % 7) / 7, u_roughness: 0.2 + (m % 11) / 14 },
    }));
    await meta(path.join(dir, `assets/materials/m${m}.esmaterial`), 'material');
  }
  const side = Math.ceil(Math.sqrt(COUNT));
  const spacing = 140;
  const entities = [
    { id: 0, name: 'Camera', parent: null, children: [], visible: true, components: [
      { type: 'Transform', data: { position: { x: 0, y: side * spacing * 0.75, z: side * spacing * 0.75 }, rotation: { x: -0.3826834, y: 0, z: 0, w: 0.9238795 } } },
      { type: 'Camera', data: { projectionType: 0, fov: 65, nearPlane: 10, farPlane: 100000, isActive: true } }] },
    { id: 1, name: 'Sun', parent: null, children: [], visible: true, components: [
      { type: 'Transform', data: { rotation: { x: -0.42, y: 0.38, z: 0, w: 0.82 } } },
      { type: 'Light', data: { type: 1, intensity: 0.8, enabled: true, color: { r: 1, g: 1, b: 1, a: 1 } } }] },
    { id: 2, name: 'Sky', parent: null, children: [], visible: true, components: [
      { type: 'Transform', data: {} }, { type: 'Light', data: { type: 2, intensity: 0.4, enabled: true, color: { r: 1, g: 1, b: 1, a: 1 } } }] },
  ];
  for (let i = 0; i < COUNT; i++) {
    const x = (i % side) - side / 2, z = Math.floor(i / side) - side / 2;
    const turn = (i * 0.6180339) % 1 * Math.PI;
    entities.push({ id: 10 + i, name: `E${i}`, parent: null, children: [], visible: true, components: [
      { type: 'Transform', data: { position: { x: x * spacing, y: 0, z: z * spacing }, rotation: { x: 0, y: Math.sin(turn / 2), z: 0, w: Math.cos(turn / 2) } } },
      { type: 'MeshRenderer', data: { mesh: `builtin:${MESHES[i % MESHES.length]}`, material: `assets/materials/m${i % materials}.esmaterial`, lit: true, opaque: true, cullBackfaces: true, color: { r: 1, g: 1, b: 1, a: 1 } } },
    ] });
  }
  await writeFile(path.join(dir, 'assets/scenes/main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities }));
  await meta(path.join(dir, 'assets/scenes/main.esscene'), 'scene');
}

function exportProject(project, out) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'pipeline/bin/estella.mjs'), 'export', project, '--out', out, '--platform', 'web'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`export of ${project} failed`);
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function measure(browser, dir) {
  const server = await serveHost(dir);
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  if (GLCALLS) {
    await page.addInitScript(() => {
      const counts = (window.__glCalls = {});
      for (const proto of [WebGL2RenderingContext.prototype]) {
        for (const name of Object.getOwnPropertyNames(proto)) {
          const d = Object.getOwnPropertyDescriptor(proto, name);
          if (!d || typeof d.value !== 'function' || name === 'constructor') continue;
          const f = d.value;
          proto[name] = function (...a) { counts[name] = (counts[name] ?? 0) + 1; return f.apply(this, a); };
        }
      }
    });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const audit = [];
  if (AUDIT) page.on('console', (m) => { if (m.text().includes('change audit:')) audit.push(m.text().replace(/^.*change audit: /, '')); });
  if (argv.includes('--logs')) {
    page.on('console', (m) => { if (['warning', 'error'].includes(m.type())) console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 300)}`));
    page.on('response', (r) => { if (r.status() >= 400) console.log(`  [http ${r.status()}] ${r.url()}`); });
  }
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__estellaCooked?.facts, null, { timeout: Number(flag('wait', '180000')) });
    await page.evaluate(() => window.__estellaCooked.setPaused(true));
    const settled = await page.evaluate(async () => {
      const c = window.__estellaCooked;
      // Settled: nothing baking, no draw waiting on a program, something drawn, and the same draws for twenty checks running -
      // a scene whose meshes and textures are still arriving draws fewer each frame than it will.
      let last = -1, same = 0;
      for (let i = 0; i < 1200; i++) {
        await c.step(2, 1 / 60);
        const r = c.render();
        const draws = (r['batch.draws'] ?? 0) + (r['render.shadow.draws'] ?? 0);
        const busy = (c.bakes?.() ?? []).length > 0 || r['render.draws.waitingForProgram'] > 0;
        same = !busy && draws > 0 && draws === last ? same + 1 : 0;
        last = draws;
        if (same >= 20) return i;
        await new Promise((r) => setTimeout(r, 30));
      }
      return -1;
    });
    let auditTotal = null;
    if (AUDIT) {
      auditTotal = await page.evaluate(async () => {
        const c = window.__estellaCooked;
        if (!c.changeAudit) throw new Error('this package has no change audit (no changeAudit()): re-export it');
        c.changeAudit(true);
        for (let i = 0; i < 12; i++) { await c.step(10, 1 / 60); await new Promise((r) => setTimeout(r, 10)); }
        const total = c.changeAuditTotal();
        c.changeAudit(false);
        return total;
      });
    }
    let cdp = null;
    if (PROFILE) {
      cdp = await context.newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    }
    const result = await page.evaluate(async ({ frames, samples, profile, wall }) => {
      const c = window.__estellaCooked;
      const sync = () => c.capture().rgba[0];
      if (!wall) { c.render(); c.costs(); } else if (!c.quiet) throw new Error('this package cannot turn its profiler off (no quiet()): re-export it'); else c.quiet();
      await c.step(frames, 1 / 60); sync();
      const ms = [];
      const scopes = [];
      if (profile) await new Promise((r) => setTimeout(r, 0));
      for (let s = 0; s < samples; s++) {
        const t0 = performance.now();
        await c.step(frames, 1 / 60);
        sync();
        ms.push((performance.now() - t0) / frames);
        scopes.push(wall ? {} : c.costs().native);
      }
      let gl = null;
      if (window.__glCalls) {
        for (const k of Object.keys(window.__glCalls)) delete window.__glCalls[k];
        await c.step(frames, 1 / 60);
        gl = Object.fromEntries(Object.entries(window.__glCalls).map(([k, v]) => [k, v / frames]));
      }
      const costs = wall ? { systems: [] } : c.costs();
      return { ms, scopes, counters: wall ? {} : c.render(), systems: costs.systems, gl };
    }, { frames: FRAMES, samples: SAMPLES, profile: PROFILE, wall: WALL });
    let profile = null;
    if (cdp) {
      await cdp.send('Profiler.start');
      await page.evaluate(async ({ frames }) => { const c = window.__estellaCooked; for (let i = 0; i < 4; i++) await c.step(frames, 1 / 60); }, { frames: FRAMES });
      profile = (await cdp.send('Profiler.stop')).profile;
    }
    if (SHOT) { await mkdir(path.dirname(path.resolve(SHOT)), { recursive: true }); await page.locator('canvas').first().screenshot({ path: path.resolve(SHOT) }); }
    const keys = new Set(result.scopes.flatMap((s) => Object.keys(s ?? {})));
    const native = {};
    for (const k of keys) native[k] = median(result.scopes.map((s) => s?.[k] ?? 0));
    return { ms: median(result.ms), native, counters: result.counters, systems: result.systems, settled, errors, profile, gl: result.gl,
             audit: AUDIT ? { total: auditTotal, lines: audit } : null };
  } finally {
    await context.close();
    await new Promise((r) => server.close(r));
  }
}

/** Self time by function, from a CDP profile: what the CPU was doing, not who asked. */
function bySelf(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anonymous)'}  ${cf.url ? path.basename(cf.url) : ''}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const inclusive = {};
  for (const name of INCL) inclusive[name] = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const hit = new Set();
    for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
      const fn = byId.get(id).callFrame.functionName;
      for (const name of INCL) if (fn.includes(name)) hit.add(name);
    }
    for (const name of hit) inclusive[name] += (dt[i] ?? 0) / 1000;
  }
  return { total, rows: [...self.entries()].sort((a, b) => b[1] - a[1]), inclusive };
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-unsafe-swiftshader'],
});
const table = {};
try {
  for (const spread of SPREADS) {
    if (ONLY && !ONLY.has(spread)) continue;
    const dir = path.resolve(flag('dir', path.join(ROOT, 'output', 'perf', `submit-${SCENE}-${spread}`)));
    if (!NO_EXPORT) {
      if (SCENE === 'synthetic') {
        const project = path.join(ROOT, 'output', 'perf', `submit-project-${spread}`);
        await writeSynthetic(project, spread);
        exportProject(project, dir);
      } else {
        exportProject(path.join(ROOT, 'examples', SCENE), dir);
      }
    }
    const r = await measure(browser, dir);
    const n = r.native, c = r.counters;
    const renderCpu = (n['render.collect'] ?? 0) + (n['render.finalize'] ?? 0) + (n['render.submit'] ?? 0) + (n['render.graph'] ?? 0);
    table[spread] = { ms: r.ms, renderCpu, native: n, counters: c, settled: r.settled, errors: r.errors, gl: r.gl, audit: r.audit };
    console.log(`${spread.padEnd(8)} frame ${r.ms.toFixed(2)} ms   collect ${(n['render.collect'] ?? 0).toFixed(2)}  finalize ${(n['render.finalize'] ?? 0).toFixed(2)}  submit ${(n['render.submit'] ?? 0).toFixed(2)}  graph ${(n['render.graph'] ?? 0).toFixed(2)}  -> render CPU ${renderCpu.toFixed(2)} ms   draws ${c['batch.draws'] ?? '?'} (gpu ${c['render.gpu.draws'] ?? '?'}, merged ${c['batch.merged'] ?? '?'}, shadow ${c['render.shadow.draws'] ?? '?'})  tris ${((c['render.triangles'] ?? 0) / 1e6).toFixed(2)}M  settled ${r.settled}${r.errors.length ? '  ERRORS ' + r.errors[0] : ''}`);
    const breaks = Object.entries(c).filter(([k]) => k.startsWith('batch.break.')).map(([k, v]) => `${k.slice(12)}=${v}`).join(' ');
    if (breaks) console.log(`         merge breaks: ${breaks}`);
    const sys = (r.systems ?? []).slice().sort((a, b) => b.ms - a.ms).slice(0, 6).map((s) => `${s.name} ${s.ms.toFixed(2)}`).join(', ');
    if (sys) console.log(`         top systems: ${sys}`);
    if (r.audit) {
      console.log(`         change audit: ${r.audit.total} unstamped write(s) in 120 frames`);
      for (const line of r.audit.lines) console.log(`           ${line}`);
    }
    if (r.gl) {
      const rows = Object.entries(r.gl).sort((a, b) => b[1] - a[1]);
      const total = rows.reduce((t, [, v]) => t + v, 0);
      console.log(`         GL calls a frame: ${total.toFixed(0)}  -  ` + rows.slice(0, 14).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
    }
    if (r.profile) {
      const p = bySelf(r.profile);
      console.log(`         profile: ${p.total.toFixed(0)} ms sampled`);
      for (const [name, ms] of Object.entries(p.inclusive)) console.log(`         inclusive ${name}: ${ms.toFixed(1)} ms (${(100 * ms / p.total).toFixed(1)}%)`);
      for (const [k, v] of p.rows.slice(0, TOP)) console.log(`           ${v.toFixed(1).padStart(8)} ms  ${(100 * v / p.total).toFixed(1).padStart(5)}%  ${k}`);
      table[spread].profile = p.rows.slice(0, 200);
    }
  }
} finally {
  await browser.close();
}
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ scene: SCENE, count: COUNT, size: [W, H], frames: FRAMES, samples: SAMPLES, table }, null, 1));
console.log(`\nwritten ${path.relative(ROOT, OUT)}`);
