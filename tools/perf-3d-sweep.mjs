// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { serveHost } from './lib/staticServer.mjs';
import { toolArgs } from './lib/toolArgs.mjs';
import { ROOT } from './lib/repo.mjs';
import { cpuSlowdown, slowCpu, slowdownLabel } from './lib/phoneCpu.mjs';

const USAGE = `node tools/perf-3d-sweep.mjs [--scenes a,b] [--rounds 1] [--slow 5] [--quality low] [--frames 300]
    [--w 844] [--h 390] [--dpr 2.5] [--memory 3] [--warm 3] [--profile-frames 120] [--no-export] [--root output/perf3d]
    [--shots <dir>] [--out <file.json>] [--settle 300000] [--project name=path,...]

Plays each 3D example as an exported web package in a headless Chromium at a phone's size and CPU speed and reports
the main thread's time a frame, what it went on (systems, the renderer's native scopes, wasm against script), the
GPU's time a frame, the draws, triangles, passes and shadow tiles, and the frame rate.`;

const DEFAULT_SCENES = ['third-person-3d', 'physics-3d', 'lighting-3d', 'world-streaming-3d', 'enemy-ai-3d', 'terrain-water',
  'planar-reflection', 'model-import', 'character-rig', 'cyber-rooftop', 'dusk-fort', 'bistro'];

const ARGS = toolArgs({
  scenes: '', rounds: '1', slow: null, quality: ['low', 'medium', 'high', 'scene'], frames: '300', w: '844', h: '390', dpr: '2.5',
  memory: '3', warm: '3', 'profile-frames': '120', 'cpu-profile-ms': '3000', root: null, shots: null, out: null, settle: '300000',
  project: '', 'box-gflops': '12740', 'phone-gflops': '96', 'phone-gpix': '4', overdraw: '2', 'quiet-cpu': '25', 'quiet-gpu': '10', 'quiet-wait': '900', 'quiet-for': '20', 'worker-quiet': '5', 'no-export': false, logs: false, help: false,
});
if (ARGS.help) { console.log(USAGE); process.exit(0); }

const SLOW = cpuSlowdown(ARGS.slow);
const SCENES = ARGS.scenes ? ARGS.scenes.split(',').filter(Boolean) : DEFAULT_SCENES;
const ROUNDS = Math.max(1, Number(ARGS.rounds));
const FRAMES = Number(ARGS.frames);
const PROFILE_FRAMES = Number(ARGS['profile-frames']);
const CPU_PROFILE_MS = Number(ARGS['cpu-profile-ms']);
const VIEW = { width: Number(ARGS.w), height: Number(ARGS.h) };
const DPR = Number(ARGS.dpr);
const MEMORY_GB = Number(ARGS.memory);
const WARM_MS = Number(ARGS.warm) * 1000;
const SETTLE_MS = Number(ARGS.settle);
const QUALITY = ARGS.quality;
const OUTROOT = path.resolve(ARGS.root ?? path.join(ROOT, 'output', 'perf3d'));
const OUT = path.resolve(ARGS.out ?? path.join(OUTROOT, `sweep-x${SLOW}-${QUALITY}.json`));
const SHOTS = ARGS.shots ? path.resolve(ARGS.shots) : path.join(OUTROOT, 'shots');
const QUIET = { cpu: Number(ARGS['quiet-cpu']), gpu: Number(ARGS['quiet-gpu']) };
const WORKER_QUIET_MS = Number(ARGS['worker-quiet']) * 1000;
const QUIET_SAMPLES = Math.max(1, Math.round(Number(ARGS['quiet-for']) * 2));
const QUIET_WAIT_MS = Number(ARGS['quiet-wait']) * 1000;
const ESTIMATE = { boxGflops: Number(ARGS['box-gflops']), phoneGflops: Number(ARGS['phone-gflops']), phoneGpix: Number(ARGS['phone-gpix']), overdraw: Number(ARGS.overdraw) };
const PROJECTS = Object.fromEntries(ARGS.project.split(',').filter(Boolean).map((kv) => kv.split('=')));
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const CHROME_ARGS = ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-unsafe-swiftshader'];

const STORAGE = {
};
const projectDir = (scene) => path.resolve(PROJECTS[scene] ?? path.join(ROOT, 'examples', scene));
const packageDir = (scene) => path.join(OUTROOT, 'pkg', scene);

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

function png(width, height, rgba) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, (height - 1 - y) * width * 4, (height - y) * width * 4);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function boxLoad() {
  const t = cpus().map((c) => c.times);
  return () => {
    const now = cpus().map((c) => c.times);
    let busy = 0, all = 0;
    now.forEach((c, i) => {
      const d = (k) => c[k] - t[i][k];
      const total = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
      busy += total - d('idle');
      all += total;
    });
    return all > 0 ? (100 * busy) / all : null;
  };
}

function gpuBusy() {
  const r = spawnSync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const v = Number(String(r.stdout).trim().split(/\s+/)[0]);
  return Number.isFinite(v) ? v : null;
}

async function waitQuiet() {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < QUIET_WAIT_MS) {
    const load = boxLoad();
    const gpus = [];
    for (let i = 0; i < QUIET_SAMPLES; i++) { await new Promise((r) => setTimeout(r, 500)); gpus.push(gpuBusy()); }
    const cpu = load();
    const known = gpus.filter((g) => g !== null);
    const gpu = known.length ? Math.max(...known) : null;
    last = { cpu: r2(cpu), gpu, waitedMs: Date.now() - t0 };
    if (cpu < QUIET.cpu && (gpu === null || gpu <= QUIET.gpu)) return last;
    console.log(`  box busy (cpu ${fmt(cpu, 0)}%, gpu ${gpu ?? '-'}%), waiting`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  return { ...last, gaveUp: true };
}

function pageHooks({ memoryGB }) {
  try { Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => memoryGB, configurable: true }); } catch {}
  const raf = window.requestAnimationFrame.bind(window);
  const log = { on: false, frames: [], after: null };
  window.__perfFrames = log;
  window.requestAnimationFrame = (cb) => raf((t) => {
    const start = performance.now();
    const done = () => {
      const end = performance.now();
      if (log.on) {
        const last = log.frames[log.frames.length - 1];
        if (last && last.t === t) last.cpu += end - start;
        else log.frames.push({ t, cpu: end - start });
      }
      if (log.after) { try { log.after(t); } catch (e) { log.afterError = String(e); } }
    };
    let result;
    try { result = cb(t); } catch (e) { done(); throw e; }
    if (result && typeof result.then === 'function') result.then(done, done);
    else done();
    return result;
  });
  const workers = { last: 0, live: 0 };
  window.__perfWorkers = workers;
  const NativeWorker = window.Worker;
  if (NativeWorker) {
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        workers.live++;
        workers.last = performance.now();
        this.addEventListener('message', () => { workers.last = performance.now(); });
      }
      terminate() { workers.live--; return super.terminate(); }
    };
  }
  const draws = { on: false, n: 0 };
  window.__perfDraws = draws;
  const trace = { on: false, events: [] };
  window.__perfTrace = trace;
  const proto = WebGL2RenderingContext.prototype;
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => { if (!o) return 0; let id = ids.get(o); if (!id) { id = nextId++; ids.set(o, id); } return id; };
  const triangles = (mode, count) => (mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0);
  const drawArgs = {
    drawArrays: (a) => [a[0], a[2], 1, true],
    drawElements: (a) => [a[0], a[1], 1, false],
    drawArraysInstanced: (a) => [a[0], a[2], a[3], true],
    drawElementsInstanced: (a) => [a[0], a[1], a[4], false],
    drawRangeElements: (a) => [a[0], a[3], 1, false],
  };
  for (const [name, read] of Object.entries(drawArgs)) {
    const f = proto[name];
    proto[name] = function (...a) {
      if (draws.on) { draws.n++; draws.calls = (draws.calls ?? 0) + 1; }
      if (trace.on) { const [mode, count, inst, arrays] = read(a); trace.events.push({ k: 'draw', count, inst, arrays, tris: triangles(mode, count) * inst }); }
      return f.apply(this, a);
    };
  }
  const multi = {
    multiDrawArraysWEBGL: (a) => ({ mode: a[0], counts: a[3], co: a[4], inst: null, n: a[5], arrays: true }),
    multiDrawElementsWEBGL: (a) => ({ mode: a[0], counts: a[1], co: a[2], inst: null, n: a[6], arrays: false }),
    multiDrawArraysInstancedWEBGL: (a) => ({ mode: a[0], counts: a[3], co: a[4], inst: a[5], io: a[6], n: a[7], arrays: true }),
    multiDrawElementsInstancedWEBGL: (a) => ({ mode: a[0], counts: a[1], co: a[2], inst: a[6], io: a[7], n: a[8], arrays: false }),
  };
  const getExtension = proto.getExtension;
  proto.getExtension = function (name) {
    const ext = getExtension.call(this, name);
    if (ext && name === 'WEBGL_multi_draw' && !ext.__perf) {
      ext.__perf = true;
      for (const [fn, read] of Object.entries(multi)) {
        const f = ext[fn];
        if (typeof f !== 'function') continue;
        ext[fn] = function (...a) {
          if (draws.on || trace.on) {
            const m = read(a);
            if (draws.on) { draws.n += m.n; draws.calls = (draws.calls ?? 0) + 1; }
            if (trace.on) for (let i = 0; i < m.n; i++) {
              const count = m.counts[m.co + i];
              const inst = m.inst ? m.inst[m.io + i] : 1;
              trace.events.push({ k: 'draw', count, inst, arrays: m.arrays, tris: triangles(m.mode, count) * inst });
            }
          }
          return f.apply(this, a);
        };
      }
    }
    return ext;
  };
  const bindFb = proto.bindFramebuffer;
  proto.bindFramebuffer = function (target, fb) { if (trace.on && target !== 0x8CA8) trace.events.push({ k: 'fb', id: idOf(fb) }); return bindFb.call(this, target, fb); };
  const viewport = proto.viewport;
  proto.viewport = function (x, y, w, h) { if (trace.on) trace.events.push({ k: 'vp', w, h }); return viewport.call(this, x, y, w, h); };

  const BPP = { 0x8058: 4, 0x8C43: 4, 0x881A: 8, 0x8814: 16, 0x8C3A: 4, 0x822F: 4, 0x822D: 2, 0x822E: 4, 0x8229: 1, 0x822B: 2, 0x81A6: 4, 0x88F0: 4,
    0x8CAC: 4, 0x8CAD: 8, 0x81A5: 2, 0x8051: 4, 0x1908: 4, 0x1907: 4, 0x8230: 8, 0x8D7C: 4, 0x8D70: 16, 0x8D76: 8, 0x8C3D: 4, 0x8059: 4, 0x8815: 12, 0x881B: 6,
    0x83F0: 0.5, 0x83F1: 0.5, 0x83F2: 1, 0x83F3: 1, 0x8E8C: 1, 0x8E8D: 1, 0x8C4C: 0.5, 0x8C4D: 0.5, 0x8C4E: 1, 0x8C4F: 1, 0x9274: 0.5, 0x9275: 0.5, 0x9278: 1, 0x9279: 1,
    0x8DBB: 0.5, 0x8DBD: 1, 0x93B0: 1, 0x93D0: 1, 0x8D64: 0.5 };
  const mem = { textures: new Map(), renderbuffers: new Map(), buffers: new Map() };
  window.__perfMem = () => {
    const sum = (m) => { let s = 0; for (const v of m.values()) s += typeof v === 'number' ? v : [...v.values()].reduce((a, b) => a + b, 0); return s; };
    return { textures: sum(mem.textures), renderbuffers: sum(mem.renderbuffers), buffers: sum(mem.buffers), textureCount: mem.textures.size };
  };
  const TEX_BINDING = { 0x0DE1: 0x8069, 0x8513: 0x8514, 0x8C1A: 0x8C1D, 0x806F: 0x806A };
  const BUF_BINDING = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8A11: 0x8A28, 0x8F36: 0x8F36, 0x8F37: 0x8F37, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8C8E: 0x8C8F };
  const faceTarget = (target) => (target >= 0x8515 && target <= 0x851A ? 0x8513 : target);
  const bound = (gl, target) => { const b = TEX_BINDING[faceTarget(target)]; return b ? gl.getParameter(b) : null; };
  const setLevel = (gl, target, key, bytes) => {
    const t = bound(gl, target);
    if (!t) return;
    let levels = mem.textures.get(t);
    if (!(levels instanceof Map)) { levels = new Map(); mem.textures.set(t, levels); }
    levels.set(key, bytes);
  };
  const texStorage2D = proto.texStorage2D;
  proto.texStorage2D = function (target, levels, fmt, w, h) {
    let bytes = 0;
    for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * (BPP[fmt] ?? 4);
    if (target === 0x8513) bytes *= 6;
    const t = bound(this, target);
    if (t) mem.textures.set(t, bytes);
    return texStorage2D.call(this, target, levels, fmt, w, h);
  };
  const texStorage3D = proto.texStorage3D;
  proto.texStorage3D = function (target, levels, fmt, w, h, d) {
    let bytes = 0;
    for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * (target === 0x806F ? Math.max(1, d >> l) : d) * (BPP[fmt] ?? 4);
    const t = bound(this, target);
    if (t) mem.textures.set(t, bytes);
    return texStorage3D.call(this, target, levels, fmt, w, h, d);
  };
  const texImage2D = proto.texImage2D;
  proto.texImage2D = function (...a) {
    const [target, level, fmt] = a;
    let w, h, type;
    if (a.length >= 8) { w = a[3]; h = a[4]; type = a[7]; } else { const src = a[5]; w = src?.width ?? src?.videoWidth ?? 0; h = src?.height ?? src?.videoHeight ?? 0; type = a[4]; }
    const bpp = BPP[fmt] && fmt !== 0x1908 && fmt !== 0x1907 ? BPP[fmt] : type === 0x1406 ? 16 : type === 0x140B ? 8 : 4;
    setLevel(this, target, `${target}:${level}`, w * h * bpp);
    return texImage2D.apply(this, a);
  };
  const compressed = proto.compressedTexImage2D;
  proto.compressedTexImage2D = function (...a) {
    const [target, level, fmt, w, h] = a;
    const data = a[6];
    const bytes = typeof data === 'number' ? data : a.length >= 9 && a[8] > 0 ? a[8] : a.length >= 8 && data?.length ? data.length - a[7] : data?.byteLength ?? w * h * (BPP[fmt] ?? 1);
    setLevel(this, target, `${target}:${level}`, bytes);
    return compressed.apply(this, a);
  };
  const deleteTexture = proto.deleteTexture;
  proto.deleteTexture = function (t) { mem.textures.delete(t); return deleteTexture.call(this, t); };
  const rbStorage = proto.renderbufferStorage;
  proto.renderbufferStorage = function (target, fmt, w, h) { const rb = this.getParameter(0x8CA7); if (rb) mem.renderbuffers.set(rb, w * h * (BPP[fmt] ?? 4)); return rbStorage.call(this, target, fmt, w, h); };
  const rbStorageMs = proto.renderbufferStorageMultisample;
  proto.renderbufferStorageMultisample = function (target, samples, fmt, w, h) { const rb = this.getParameter(0x8CA7); if (rb) mem.renderbuffers.set(rb, w * h * (BPP[fmt] ?? 4) * Math.max(1, samples)); return rbStorageMs.call(this, target, samples, fmt, w, h); };
  const deleteRenderbuffer = proto.deleteRenderbuffer;
  proto.deleteRenderbuffer = function (r) { mem.renderbuffers.delete(r); return deleteRenderbuffer.call(this, r); };
  const bufferData = proto.bufferData;
  proto.bufferData = function (...a) {
    const b = BUF_BINDING[a[0]] ? this.getParameter(BUF_BINDING[a[0]]) : null;
    const src = a[1];
    const bytes = typeof src === 'number' ? src : !src ? 0 : a.length >= 5 && a[4] > 0 ? a[4] * (src.BYTES_PER_ELEMENT ?? 1)
      : a.length >= 4 && src.BYTES_PER_ELEMENT ? (src.length - a[3]) * src.BYTES_PER_ELEMENT : src.byteLength ?? 0;
    if (b) mem.buffers.set(b, bytes);
    return bufferData.apply(this, a);
  };
  const deleteBuffer = proto.deleteBuffer;
  proto.deleteBuffer = function (b) { mem.buffers.delete(b); return deleteBuffer.call(this, b); };
}

function passesOf(events) {
  const segments = [];
  let fb = 0, vp = null, seg = null;
  for (const e of events) {
    if (e.k === 'fb') { fb = e.id; seg = null; continue; }
    if (e.k === 'vp') { vp = [e.w, e.h]; seg = null; continue; }
    if (!seg) { seg = { fb, size: vp, draws: 0, tris: 0, fullscreen: 0 }; segments.push(seg); }
    seg.draws++;
    seg.tris += e.tris;
    if (e.arrays && e.inst <= 1 && e.count <= 6) seg.fullscreen++;
  }
  const merged = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && last.fb === s.fb && last.size?.[0] === s.size?.[0] && last.size?.[1] === s.size?.[1]) { last.draws += s.draws; last.tris += s.tris; last.fullscreen += s.fullscreen; }
    else merged.push({ ...s });
  }
  return merged;
}

async function exportScene(scene) {
  const dir = packageDir(scene);
  if (ARGS['no-export'] && existsSync(path.join(dir, 'index.html'))) return dir;
  const project = projectDir(scene);
  if (!existsSync(path.join(project, 'project.esproject'))) throw new Error(`no project at ${project}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'pipeline/bin/estella.mjs'), 'export', project, '--out', dir, '--platform', 'web'], { stdio: ARGS.logs ? 'inherit' : 'pipe', encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`export failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`);
  return dir;
}

async function withQuality(dir, fn) {
  const file = path.join(dir, 'game.config.json');
  const original = await readFile(file, 'utf8');
  const cfg = JSON.parse(original);
  if (QUALITY !== 'scene') cfg.quality = { ...(cfg.quality ?? {}), mode: QUALITY };
  await writeFile(file, JSON.stringify(cfg));
  try { return await fn(cfg); } finally { await writeFile(file, original); }
}

async function settle(page) {
  const t0 = Date.now();
  let calm = 0;
  let last = null;
  while (Date.now() - t0 < SETTLE_MS) {
    last = await page.evaluate(() => {
      const c = window.__estellaCooked;
      if (!c?.facts) return { up: false };
      const r = c.render();
      return {
        up: true,
        bakes: (c.bakes?.() ?? []).length,
        waiting: r['render.draws.waitingForProgram'] ?? 0,
        pending: r['render.programs.pending'] ?? 0,
        draws: r['render.gpu.draws'] ?? r['batch.draws'] ?? 0,
        splash: !!document.getElementById('es-splash'),
        workerQuietMs: Math.round(performance.now() - (window.__perfWorkers?.last ?? 0)),
      };
    }).catch(() => ({ up: false }));
    const ok = last.up && last.bakes === 0 && last.waiting === 0 && last.pending === 0 && last.draws > 0 && !last.splash && last.workerQuietMs > WORKER_QUIET_MS;
    calm = ok ? calm + 1 : 0;
    if (calm >= 4) return { ms: Date.now() - t0, ...last };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ms: -1, timedOut: true, ...last };
}

async function freeRun(page, frames) {
  return page.evaluate(async (n) => {
    const log = window.__perfFrames;
    log.frames = [];
    log.on = true;
    const t0 = performance.now();
    while (log.frames.length < n + 1 && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 100));
    log.on = false;
    return log.frames.slice(1, n + 1);
  }, frames);
}

async function profiledRun(page, frames) {
  return page.evaluate(async (n) => {
    const c = window.__estellaCooked;
    c.costs();
    c.render();
    c.gpu();
    const log = window.__perfFrames;
    const draws = window.__perfDraws;
    const out = { frames: [], gpu: [], native: {}, systems: {}, counters: [], glDraws: [] };
    let lastRead = -1;
    let seen = 0;
    log.frames = [];
    const trace = window.__perfTrace;
    log.after = () => {
      if (trace.on) { trace.on = false; out.trace = trace.events; }
      if (seen === 12) { trace.events = []; trace.on = true; }
      if (seen++ < 2) { draws.n = 0; draws.on = true; return; }
      const k = c.costs();
      for (const s of k.systems) (out.systems[s.name] ??= { domain: s.domain, ms: [] }).ms.push(s.ms);
      for (const [name, ms] of Object.entries(k.native ?? {})) (out.native[name] ??= []).push(ms);
      const counters = c.render();
      out.counters.push(counters);
      out.glDraws.push(draws.n);
      (out.glCalls ??= []).push(draws.calls ?? 0);
      draws.n = 0;
      draws.calls = 0;
      const read = counters['render.gpuTimer.read'] ?? -1;
      if (read !== lastRead) {
        const g = c.gpu();
        if (read > 3 && Object.keys(g).some((x) => x.startsWith('pass/'))) out.gpu.push(g);
        lastRead = read;
      }
    };
    log.on = true;
    const t0 = performance.now();
    while (out.counters.length < n && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 100));
    log.on = false;
    log.after = null;
    draws.on = false;
    out.frames = log.frames.slice(3, 3 + out.counters.length);
    return out;
  }, frames);
}

function classify(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const buckets = { wasm: 0, script: 0, gc: 0, program: 0, idle: 0 };
  const wasmSelf = new Map();
  const jsSelf = new Map();
  profile.samples.forEach((id, i) => {
    const cf = byId.get(id).callFrame;
    const ms = (profile.timeDeltas[i] ?? 0) / 1000;
    const fn = cf.functionName || '(anonymous)';
    if (fn === '(idle)') buckets.idle += ms;
    else if (fn === '(garbage collector)') buckets.gc += ms;
    else if (fn === '(program)' || fn === '(root)') buckets.program += ms;
    else if ((cf.url ?? '').startsWith('wasm://') || /^wasm-function|^js-to-wasm|^wasm-to-js/.test(fn)) { buckets.wasm += ms; wasmSelf.set(fn, (wasmSelf.get(fn) ?? 0) + ms); }
    else { buckets.script += ms; const key = `${fn} ${cf.url ? path.basename(cf.url) : ''}:${cf.lineNumber}`; jsSelf.set(key, (jsSelf.get(key) ?? 0) + ms); }
  });
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const callers = new Map();
  profile.samples.forEach((id, i) => {
    const leaf = byId.get(id).callFrame.functionName;
    if (!CALLERS.some((c) => leaf === c)) return;
    const chain = [leaf];
    for (let p = parent.get(id); p !== undefined && chain.length < 9; p = parent.get(p)) {
      const cf = byId.get(p).callFrame;
      chain.push(`${cf.functionName || '(anonymous)'}${cf.url && !cf.url.startsWith('wasm') ? '@' + path.basename(cf.url) + ':' + cf.lineNumber : ''}`);
    }
    const key = chain.join(' < ');
    callers.set(key, (callers.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  const top = (m, n = 25) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { buckets, wasmTop: top(wasmSelf), jsTop: top(jsSelf), callers: top(callers, 20) };
}

async function cpuProfile(page, ms) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await page.evaluate(() => { const l = window.__perfFrames; l.frames = []; l.on = true; });
  await cdp.send('Profiler.start');
  await new Promise((r) => setTimeout(r, ms));
  const { profile } = await cdp.send('Profiler.stop');
  const frames = await page.evaluate(() => { const l = window.__perfFrames; l.on = false; return l.frames.length; });
  await cdp.detach();
  const c = classify(profile);
  const per = (x) => (frames > 0 ? x / frames : null);
  return {
    frames,
    perFrame: Object.fromEntries(Object.entries(c.buckets).map(([k, v]) => [k, r2(per(v))])),
    wasmTop: c.wasmTop.map(([k, v]) => [k, r2(per(v))]),
    jsTop: c.jsTop.map(([k, v]) => [k, r2(per(v))]),
    callers: c.callers.map(([k, v]) => [k, r2(per(v))]),
  };
}

async function taskMetrics(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const read = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  return { read, close: () => cdp.detach() };
}

const CALLERS = ['toWireType', 'bufferSubData', 'texSubImage2D', 'bindTexture', 'bindBufferRange', 'uniform4fv', 'uniformMatrix4fv'];
const GEOMETRY = /^(scene|shadow|planar|prepass|depth|motion|cover|rain-cover|probe|screen-ui|reflection|decal|particles)/i;

function summarize(scene, measured) {
  const { settled, free, prof, cpuProf, tasks, canvas, errors, load, mem } = measured;
  const passes = passesOf(prof.trace ?? []);
  const aspect = canvas[0] / canvas[1];
  const scenePass = passes.filter((p) => p.size && Math.abs(p.size[0] / p.size[1] - aspect) < 0.05 * aspect && p.fullscreen < p.draws)
    .reduce((best, p) => (!best || p.tris > best.tris ? p : best), null);
  const area = (p) => (p.size ? p.size[0] * p.size[1] : 0);
  const fullscreen = passes.filter((p) => p.draws > 0 && p.fullscreen === p.draws);
  const geometry = passes.filter((p) => p !== scenePass && p.fullscreen < p.draws);
  const cpuFrame = free.map((f) => f.cpu);
  const intervals = free.slice(1).map((f, i) => f.t - free[i].t);
  const span = free.length > 1 ? free[free.length - 1].t - free[0].t : 0;
  const nativeMean = Object.fromEntries(Object.entries(prof.native).map(([k, v]) => [k, mean(v)]));
  const systems = Object.entries(prof.systems)
    .map(([name, s]) => ({ name, domain: s.domain, ms: r2(s.ms.reduce((a, b) => a + b, 0) / Math.max(1, prof.counters.length)) }))
    .sort((a, b) => b.ms - a.ms);
  const systemsSum = systems.reduce((a, s) => a + s.ms, 0);
  const counterMedian = (k) => median(prof.counters.map((c) => c[k]).filter((x) => typeof x === 'number'));
  const passNames = new Set(prof.gpu.flatMap((g) => Object.keys(g).filter((k) => k.startsWith('pass/'))));
  const passMean = Object.fromEntries([...passNames].map((k) => [k.slice(5), median(prof.gpu.map((g) => g[k] ?? 0))]));
  const gpuGraph = median(prof.gpu.map((g) => g.graph).filter((x) => typeof x === 'number' && x >= 0));
  const post = Object.entries(passMean).filter(([k]) => !GEOMETRY.test(k)).reduce((a, [, v]) => a + v, 0);
  const render = ['render.collect', 'render.finalize', 'render.submit', 'render.graph'];
  const profFrameCpu = prof.frames.map((f) => f.cpu);
  return {
    scene,
    canvas,
    settledMs: settled.ms,
    settledTimedOut: !!settled.timedOut,
    boxLoad: r2(load),
    cpu: { median: r2(median(cpuFrame)), p95: r2(quantile(cpuFrame, 0.95)), mean: r2(mean(cpuFrame)), frames: cpuFrame.length },
    mainThreadTaskPerFrame: r2(tasks),
    fps: r2(span > 0 ? (1000 * (free.length - 1)) / span : null),
    intervalMedian: r2(median(intervals)),
    intervalP95: r2(quantile(intervals, 0.95)),
    profiled: { cpuMedian: r2(median(profFrameCpu)), frames: profFrameCpu.length, systemsSum: r2(systemsSum) },
    systems,
    native: Object.fromEntries(Object.entries(nativeMean).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r2(v)])),
    renderCpu: r2(render.reduce((a, k) => a + (nativeMean[k] ?? 0), 0)),
    split: cpuProf,
    gpu: { frames: prof.gpu.length, graph: r2(gpuGraph), passes: passNames.size, post: r2(post), perPass: Object.fromEntries(Object.entries(passMean).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r2(v)])) },
    draws: { engine: counterMedian('render.gpu.draws'), batch: counterMedian('batch.draws'), gl: median(prof.glDraws), glCalls: median(prof.glCalls ?? []), shadow: counterMedian('render.shadow.draws'), prepass: counterMedian('render.prepass.draws') },
    counters: Object.fromEntries([...new Set(prof.counters.flatMap((c) => Object.keys(c)))].sort().map((k) => [k, counterMedian(k)])),
    triangles: counterMedian('render.triangles'),
    glTriangles: passes.reduce((a, p) => a + p.tris, 0),
    fill: {
      scene: scenePass?.size ?? null,
      scenePixels: scenePass ? area(scenePass) : null,
      fullscreenPasses: fullscreen.length,
      fullscreenDraws: fullscreen.reduce((a, p) => a + p.draws, 0),
      fullscreenPixels: fullscreen.reduce((a, p) => a + area(p) * p.draws, 0),
      fullscreenSizes: fullscreen.map((p) => `${p.size?.join('x')}${p.draws > 1 ? ' x' + p.draws : ''}`),
      geometryPasses: geometry.map((p) => ({ size: p.size, draws: p.draws, tris: p.tris })),
      geometryPixels: geometry.reduce((a, p) => a + area(p), 0),
      passes: passes.map((p) => ({ size: p.size, draws: p.draws, tris: p.tris, fullscreen: p.fullscreen })),
    },
    memory: mem,
    phoneGpu: {
      byCompute: r2(gpuGraph === null ? null : (gpuGraph * ESTIMATE.boxGflops) / ESTIMATE.phoneGflops),
      shadedPixels: scenePass ? Math.round(area(scenePass) * ESTIMATE.overdraw + fullscreen.reduce((a, p) => a + area(p) * p.draws, 0) + geometry.reduce((a, p) => a + area(p), 0)) : null,
      byFill: r2(scenePass ? (area(scenePass) * ESTIMATE.overdraw + fullscreen.reduce((a, p) => a + area(p) * p.draws, 0) + geometry.reduce((a, p) => a + area(p), 0)) / (ESTIMATE.phoneGpix * 1e6) : null),
    },
    meshes: counterMedian('render.meshes'),
    shadowTiles: counterMedian('render.shadow.tiles'),
    shadowAtlas: counterMedian('render.shadow.atlasSize'),
    errors,
  };
}

async function measureScene(browser, scene) {
  const dir = packageDir(scene);
  return withQuality(dir, async () => {
    const server = await serveHost(dir);
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, userAgent: PHONE_UA });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    if (ARGS.logs) page.on('console', (m) => { if (['warning', 'error'].includes(m.type())) console.log(`    [${m.type()}] ${m.text().slice(0, 200)}`); });
    await page.addInitScript(pageHooks, { memoryGB: MEMORY_GB });
    const storage = QUALITY === 'scene' ? {} : Object.entries(STORAGE).find(([k]) => scene === k || scene.startsWith(`${k}-`))?.[1](QUALITY) ?? {};
    if (Object.keys(storage).length) await page.addInitScript((entries) => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, storage);
    await slowCpu(page, SLOW);
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: SETTLE_MS });
      const settled = await settle(page);
      await page.evaluate(() => window.__estellaCooked?.quiet?.());
      await new Promise((r) => setTimeout(r, WARM_MS));
      const metrics = await taskMetrics(page);
      const load = boxLoad();
      const before = await metrics.read();
      const free = await freeRun(page, FRAMES);
      const after = await metrics.read();
      const boxBusy = load();
      await metrics.close();
      const tasks = free.length ? (1000 * (after.TaskDuration - before.TaskDuration)) / free.length : null;
      const prof = await profiledRun(page, PROFILE_FRAMES);
      await page.evaluate(() => window.__estellaCooked.quiet());
      const cpuProf = await cpuProfile(page, CPU_PROFILE_MS);
      const canvas = await page.evaluate(() => { const c = document.querySelector('canvas'); return [c.width, c.height]; });
      const mem = await page.evaluate(() => window.__perfMem());
      const covered = await page.evaluate(() => ['rotate-hint', 'es-splash'].filter((id) => { const e = document.getElementById(id); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && r.width * r.height > innerWidth * innerHeight * 0.25; }));
      if (covered.length) errors.push(`covered by ${covered.join(', ')}`);
      await mkdir(SHOTS, { recursive: true });
      const tag = `${scene}-x${SLOW}-${QUALITY}`;
      await page.screenshot({ path: path.join(SHOTS, `${tag}-page.png`) });
      const shot = await page.evaluate(() => {
        const r = window.__estellaCooked.capture();
        let s = '';
        for (let i = 0; i < r.rgba.length; i += 0x8000) s += String.fromCharCode(...r.rgba.subarray(i, i + 0x8000));
        return { width: r.width, height: r.height, rgba: btoa(s) };
      });
      await writeFile(path.join(SHOTS, `${tag}-canvas.png`), png(shot.width, shot.height, Buffer.from(shot.rgba, 'base64')));
      return summarize(scene, { settled, free, prof, cpuProf, tasks, canvas, errors, load: boxBusy, mem });
    } finally {
      await context.close();
      await new Promise((r) => server.close(r));
    }
  });
}

const fmt = (x, d = 2) => (x === null || x === undefined ? '-' : typeof x === 'number' ? x.toFixed(d) : String(x));

function report(row) {
  const flag = row.cpu.median > 33.3 ? ' >33' : row.cpu.median > 16.7 ? ' >16.7' : '';
  console.log(`${row.scene.padEnd(20)} cpu ${fmt(row.cpu.median)} / p95 ${fmt(row.cpu.p95)} ms${flag}  tasks ${fmt(row.mainThreadTaskPerFrame)}  fps ${fmt(row.fps, 1)}  gpu ${fmt(row.gpu.graph)} (post ${fmt(row.gpu.post)}, ${row.gpu.passes} passes)  draws ${row.draws.engine ?? '-'} (gl ${row.draws.gl ?? '-'}, shadow ${row.draws.shadow ?? '-'})  tris ${fmt((row.triangles ?? 0) / 1000, 0)}k  shadow tiles ${row.shadowTiles ?? '-'}  box ${fmt(row.boxLoad, 0)}% (before: cpu ${fmt(row.quietBefore?.cpu, 0)}%, gpu ${row.quietBefore?.gpu ?? '-'}%${row.quietBefore?.gaveUp ? ', BUSY' : ''})`);
  console.log(`${''.padEnd(20)} phone gpu (estimate) by compute ${fmt(row.phoneGpu.byCompute)} ms, by fill ${fmt(row.phoneGpu.byFill)} ms  scene ${row.fill.scene?.join('x') ?? '-'}  fullscreen ${row.fill.fullscreenSizes.join(' ')}  textures ${fmt(row.memory.textures / 1048576, 1)} MB  buffers ${fmt(row.memory.buffers / 1048576, 1)} MB`);
  console.log(`${''.padEnd(20)} systems ${fmt(row.profiled.systemsSum)} ms [${row.systems.slice(0, 6).map((s) => `${s.name} ${fmt(s.ms)}`).join(', ')}]  render native ${fmt(row.renderCpu)} ms  split wasm ${fmt(row.split.perFrame.wasm)} script ${fmt(row.split.perFrame.script)} gc ${fmt(row.split.perFrame.gc)} program ${fmt(row.split.perFrame.program)}  canvas ${row.canvas.join('x')}${row.settledTimedOut ? '  NOT SETTLED' : ''}${row.errors.length ? '  ERRORS ' + row.errors[0] : ''}`);
}

console.log(slowdownLabel(SLOW));
console.log(`viewport ${VIEW.width}x${VIEW.height} @${DPR}, quality ${QUALITY}, ${FRAMES} frames free-running, ${PROFILE_FRAMES} profiled, ${ROUNDS} round(s)`);
const prepared = [];
const skipped = {};
for (const scene of SCENES) {
  try { await exportScene(scene); prepared.push(scene); } catch (e) { skipped[scene] = String(e.message ?? e); console.log(`${scene.padEnd(20)} skipped: ${skipped[scene]}`); }
}
const rounds = [];
let adapter = 'unknown';
for (let round = 0; round < ROUNDS; round++) {
  const order = prepared.slice(round % Math.max(1, prepared.length)).concat(prepared.slice(0, round % Math.max(1, prepared.length)));
  const rows = {};
  for (const scene of order) {
    let row = null;
    for (let attempt = 0; attempt < 2 && !row; attempt++) {
      const browser = await chromium.launch({ headless: true, args: CHROME_ARGS });
      try {
        if (adapter === 'unknown') {
          const p = await browser.newPage();
          adapter = await p.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const x = gl?.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
          await p.close();
          console.log(`adapter: ${adapter}`);
        }
        const quiet = await waitQuiet();
        row = await measureScene(browser, scene);
        row.quietBefore = quiet;
      } catch (e) {
        console.log(`${scene.padEnd(20)} failed${attempt === 0 ? ', retrying' : ''}: ${String(e.message ?? e).split('\n')[0]}`);
      } finally {
        await browser.close();
      }
    }
    rows[scene] = row ?? { scene, failed: true };
    if (row) report(row);
  }
  rounds.push(rows);
}
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ estimate: ESTIMATE, cpuSlowdown: SLOW, quality: QUALITY, viewport: VIEW, dpr: DPR, memoryGB: MEMORY_GB, adapter, frames: FRAMES, skipped, rounds }, null, 1));
console.log(`written ${path.relative(ROOT, OUT)}`);
