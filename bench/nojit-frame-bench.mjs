// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// nojit-frame-bench.mjs — the native boot-spike proxy.
//
// Boots the REAL engine wasm core headlessly (createHeadlessApp — no renderer, no
// GL, no DOM), builds a scene of N entities, and steps M frames of the actual
// per-frame update loop (ECS iteration + velocity integration in TS + C++
// transform propagation in wasm), timing each frame. It benchmarks the CPU-side
// per-frame work — everything EXCEPT GPU submission, which is hard-gated on a
// renderer and cannot run headless.
//
// WHY: iOS third-party apps get NO JIT (JavaScriptCore runs interpreter/LLInt only
// for both JS and wasm). iOS's JS engine IS JavaScriptCore. So running this under a
// JSC runtime with JIT disabled measures the exact engine iOS uses, on the same
// no-JIT constraint — the single biggest risk for the "embedded Dawn + JS engine +
// our wasm+TS" native architecture (wasm dropping from JIT to interpreter is
// typically 5-20x). Run it twice and compare:
//
//   Node (Windows/Mac, V8, JIT) ............ node bench/nojit-frame-bench.mjs
//   Bun  (JSC, JIT baseline) ............... bun  bench/nojit-frame-bench.mjs
//   Bun  (JSC, JIT DISABLED = iOS proxy) ... BUN_JSC_useJIT=0 bun bench/nojit-frame-bench.mjs
//                                    (also try  JSC_useJIT=0  if the above is ignored)
//
// If the two Bun numbers are ~identical, the flag was ignored (JIT still on) — the
// no-JIT run must be MULTIPLES slower for the flag to have taken effect. On an M4
// Mac the no-JIT median-ms/frame is a close, mildly-optimistic proxy for an iPhone
// (same JSC engine, same microarch lineage). Compare it against the 16.67ms (60fps)
// / 33.33ms (30fps) budgets for a go/no-go on the native form factor.
//
// Config via env:
//   BENCH_ENTITIES (5000)  BENCH_FRAMES (600)  BENCH_WARMUP (120)
//   BENCH_LABEL (auto)     ESENGINE_WASM_DIR (auto)  ESENGINE_SDK (auto)

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const ENTITIES = intEnv('BENCH_ENTITIES', 5000);
const FRAMES = intEnv('BENCH_FRAMES', 600);
const WARMUP = intEnv('BENCH_WARMUP', 120);
const DT = 1 / 60;

function intEnv(name, def) {
    const v = env(name);
    if (v == null || v === '') return def;
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : def;
}
// Portable env read (process.env under Node/Bun).
function env(name) {
    return (typeof process !== 'undefined' && process.env) ? process.env[name] : undefined;
}
// Portable high-res clock: performance.now() where present (Node/Bun), else Date.now().
const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();
const hasHiRes = (typeof performance !== 'undefined' && typeof performance.now === 'function');

// Deterministic scene (mulberry32) so the JIT and no-JIT runs benchmark the SAME
// entities — a fair comparison needs an identical workload.
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function detectRuntime() {
    // Bun exposes globalThis.Bun; both Node and Bun set process.versions.
    // eslint-disable-next-line no-undef
    if (typeof Bun !== 'undefined') return `bun ${process.versions?.bun ?? '?'} (JSC)`;
    if (typeof process !== 'undefined' && process.versions?.node) return `node ${process.versions.node} (V8)`;
    return 'unknown-runtime';
}

function resolveWasmDir() {
    const override = env('ESENGINE_WASM_DIR');
    const candidates = [
        override && resolve(override),
        join(REPO, 'build', 'wasm', 'web'),
        join(REPO, 'desktop', 'public', 'wasm'),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (existsSync(join(dir, 'esengine.wasm')) && existsSync(join(dir, 'esengine.js'))) return dir;
    }
    throw new Error(
        'could not find esengine.wasm + esengine.js. Set ESENGINE_WASM_DIR to the dir holding them.\n' +
        'Tried:\n  ' + candidates.join('\n  '));
}

function resolveSdk() {
    const override = env('ESENGINE_SDK');
    const candidates = [
        override && resolve(override),
        join(REPO, 'sdk', 'dist', 'index.node.js'),
    ].filter(Boolean);
    for (const p of candidates) if (existsSync(p)) return p;
    throw new Error(
        'could not find the built SDK node entry (sdk/dist/index.node.js). Run `npm run build` in sdk/, ' +
        'or set ESENGINE_SDK.\nTried:\n  ' + candidates.join('\n  '));
}

function pct(sorted, p) {
    if (sorted.length === 0) return NaN;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}
const ms = (x) => x.toFixed(3);

async function main() {
    const label = env('BENCH_LABEL') || detectRuntime();
    const wasmDir = resolveWasmDir();
    const sdkPath = resolveSdk();

    console.log('='.repeat(64));
    console.log('ESEngine no-JIT frame benchmark');
    console.log('  runtime  :', detectRuntime());
    console.log('  label    :', label);
    console.log('  clock    :', hasHiRes ? 'performance.now()' : 'Date.now() (ms-resolution)');
    console.log('  entities :', ENTITIES);
    console.log('  frames   :', FRAMES, `(+${WARMUP} warmup)`);
    console.log('  wasm dir :', wasmDir);
    console.log('  sdk      :', sdkPath);
    console.log('='.repeat(64));

    const sdk = await import(pathToFileURL(sdkPath).href);
    const { loadEsengineModule, createHeadlessApp, Transform, Sprite, Velocity } = sdk;

    const tBoot0 = now();
    const module = await loadEsengineModule(wasmDir);
    const app = createHeadlessApp(module);
    const world = app.world;
    const cppRegistry = world.getCppRegistry();
    const tBoot1 = now();
    console.log(`boot: ${ms(tBoot1 - tBoot0)} ms (wasm instantiate + app)`);

    // Build a representative scene: N moving sprites. Velocity is integrated into
    // Transform.position by velocitySystem (TS) each frame; transform_update folds
    // local→world matrices in C++ (wasm) — both are per-frame hot paths.
    const rand = mulberry32(0x1234abcd);
    const tScene0 = now();
    for (let i = 0; i < ENTITIES; i++) {
        const e = world.spawn();
        world.insert(e, Transform, {
            position: { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000, z: 0 },
        });
        world.insert(e, Velocity, {
            linear: { x: (rand() - 0.5) * 120, y: (rand() - 0.5) * 120, z: 0 },
        });
        world.insert(e, Sprite, { size: { x: 16, y: 16 } });
    }
    const tScene1 = now();
    console.log(`scene: ${ms(tScene1 - tScene0)} ms to spawn ${ENTITIES} entities`);

    const stepFrame = async () => {
        await app.tick(DT);
        if (cppRegistry) module.transform_update(cppRegistry);
    };

    // Warmup: the first tick does one-time setup (SystemRunner build, startup
    // systems, Time insert) and, under a JIT runtime, lets the optimizer warm up.
    for (let f = 0; f < WARMUP; f++) await stepFrame();

    const samples = new Float64Array(FRAMES);
    const tRun0 = now();
    for (let f = 0; f < FRAMES; f++) {
        const t0 = now();
        await stepFrame();
        samples[f] = now() - t0;
    }
    const tRun1 = now();

    const sorted = Array.from(samples).sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;
    const median = pct(sorted, 50);
    const p95 = pct(sorted, 95);
    const p99 = pct(sorted, 99);
    const wall = tRun1 - tRun0;

    console.log('-'.repeat(64));
    console.log(`RESULT [${label}]  ${ENTITIES} entities, ${FRAMES} frames`);
    console.log(`  ms/frame  mean ${ms(mean)}  median ${ms(median)}  p95 ${ms(p95)}  p99 ${ms(p99)}`);
    console.log(`            min  ${ms(sorted[0])}  max ${ms(sorted[sorted.length - 1])}`);
    console.log(`  throughput ${(1000 / median).toFixed(1)} fps-equiv (median)  ` +
                `${(ENTITIES * (1000 / median) / 1e6).toFixed(2)} M entity-updates/s`);
    console.log(`  budget    60fps=16.67ms → ${median <= 16.67 ? 'PASS' : 'OVER'}   ` +
                `30fps=33.33ms → ${median <= 33.33 ? 'PASS' : 'OVER'}  (median)`);
    console.log(`  wall      ${ms(wall)} ms for ${FRAMES} timed frames`);
    console.log('='.repeat(64));
}

main().catch((e) => {
    console.error('bench failed:', e?.stack || e);
    if (typeof process !== 'undefined') process.exitCode = 1;
});
