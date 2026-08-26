// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  frame-bench.mjs — what AOT buys a FRAME, measured rather than argued.
 *
 * bench/aot-stage0 measured a system LOOP: 154-385x, QuickJS against native C++,
 * neither of them the real runtime. This measures the real one: the same engine
 * wasm, the same App, the same scheduler, the same project file — run once
 * interpreted and once with its compiled twin installed, on a scene of N
 * entities carrying a real `Transform`.
 *
 * Every number is a frame time, taken with no profiler on: the SDK's own timings
 * would have measured the timing — its clock reads and query accounting are real
 * work that a shipped frame does not do.
 *
 * The system's own cost is that frame minus an IDLE run of the same scene, which
 * is a fair subtrahend here: a root transform is recomposed every frame whether
 * or not it moved (TransformSystem's dirty tag only gates TransformStatic), so
 * the idle run does the same engine work minus the system.
 *
 * It is small, and that is the caveat on the frame ratio rather than a result: a
 * real game's frame also carries rendering, physics and UI that no compiler
 * touches (REARCH_AOT.md §14 measured that share).
 *
 * The compiled side's cost includes materialising a row array and a SysCtx per
 * call — the cost §7.2 is owed a number for, and the thin/thick pair is what
 * separates it from the body.
 *
 * WHAT THIS IS NOT: a no-JIT number. Under node or Bun-with-JIT, V8/JSC compile
 * the interpreted system to machine code too — this is the LEAST favourable
 * case for AOT, and the platforms AOT exists for (iOS, WeChat iOS, QuickJS) have
 * no JIT at all. Run it under a JIT-disabled JavaScriptCore for that half:
 *
 * node bench/aot-frame/frame-bench.mjs              V8, JIT           (floor)
 * bun  bench/aot-frame/frame-bench.mjs              JSC, JIT
 * BUN_JSC_useJIT=0 bun bench/aot-frame/frame-bench.mjs   JSC, no JIT  (iOS proxy)
 *
 * Build the artifacts first: node bench/aot-frame/build.mjs
 *
 * Every configuration is measured BENCH_REPS times, in its OWN PROCESS, and the
 * reps are interleaved. One pass of each in one process was not a fair test: the
 * interpreted body allocates a component copy per entity per frame and therefore
 * collects garbage, so a heap that fifteen engine modules had already grown
 * penalised it more than the compiled side — biasing the ratio in the direction
 * this benchmark exists to be sceptical of. A fresh process per measurement
 * costs half a second and removes the question.
 *
 * Config via env:
 * BENCH_ENTITIES (5000)  BENCH_FRAMES (600)  BENCH_WARMUP (120)  BENCH_REPS (3)
 * ESENGINE_WASM_DIR (auto)  ESENGINE_SDK (auto)
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BUILD = join(HERE, '.build');

const env = (name) => (typeof process !== 'undefined' && process.env ? process.env[name] : undefined);
const intEnv = (name, def) => {
    const v = env(name);
    const n = v == null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) ? Math.floor(n) : def;
};
const ENTITIES = intEnv('BENCH_ENTITIES', 5000);
const FRAMES = intEnv('BENCH_FRAMES', 600);
const WARMUP = intEnv('BENCH_WARMUP', 120);
const REPS = intEnv('BENCH_REPS', 5);
const DT = 1 / 60;

const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now() : () => Date.now();

/** The same scene for every run: a comparison of two engines needs one workload. */
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
    if (typeof Bun !== 'undefined') return `bun ${process.versions?.bun ?? '?'} (JSC)`;
    if (typeof process !== 'undefined' && process.versions?.node) return `node ${process.versions.node} (V8)`;
    return 'unknown-runtime';
}

function resolveWasmDir() {
    const candidates = [env('ESENGINE_WASM_DIR') && resolve(env('ESENGINE_WASM_DIR')),
        join(REPO, 'build', 'wasm', 'web'), join(REPO, 'desktop', 'public', 'wasm')].filter(Boolean);
    for (const dir of candidates) {
        if (existsSync(join(dir, 'esengine.wasm')) && existsSync(join(dir, 'esengine.js'))) return dir;
    }
    throw new Error(`no esengine.wasm + esengine.js. Tried:\n  ${candidates.join('\n  ')}`);
}

function resolveSdk() {
    const candidates = [env('ESENGINE_SDK') && resolve(env('ESENGINE_SDK')),
        join(REPO, 'sdk', 'dist', 'index.node.js')].filter(Boolean);
    for (const p of candidates) if (existsSync(p)) return p;
    throw new Error(`no built SDK node entry. Tried:\n  ${candidates.join('\n  ')}`);
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const ms = (x) => x.toFixed(3);

/**
 * One world, N frames, one number per frame. A `body` of null schedules no
 * project system — the idle run. `compiled` installs the twins before anything
 * is spawned, the only moment it can: the rows a twin reads have to be
 * allocated in the memory it reads.
 */
async function measure(sdk, fixture, wasmDir, body, compiled) {
    const { loadEsengineModule, createHeadlessApp, Transform, Schedule } = sdk;
    const module = await loadEsengineModule(wasmDir);
    const app = createHeadlessApp(module);
    if (compiled) {
        const manifest = JSON.parse(readFileSync(join(BUILD, 'systems.json'), 'utf8'));
        const installed = await app.installCompiledSystems(join(BUILD, 'systems.wasm'), manifest);
        if (installed === 0) throw new Error('the module installed no twins');
    }

    const world = app.world;
    const cppRegistry = world.getCppRegistry();
    const rand = mulberry32(0x1234abcd);
    const entities = [];
    for (let i = 0; i < ENTITIES; i++) {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000, z: 0 } });
        world.insert(e, fixture.Mover, {
            dx: rand() - 0.5, dy: rand() - 0.5, speed: 40 + rand() * 80, boost: rand() < 0.5 ? 1 : 0,
        });
        entities.push(e);
    }
    const systems = { thin: fixture.thinSystem, thick: fixture.thickSystem, heavy: fixture.heavySystem };
    if (body) app.addSystemToSchedule(Schedule.Update, systems[body]);

    const step = async () => {
        await app.tick(DT);
        if (cppRegistry) module.transform_update(cppRegistry);
    };
    for (let f = 0; f < WARMUP; f++) await step();

    const samples = new Float64Array(FRAMES);
    for (let f = 0; f < FRAMES; f++) {
        const t0 = now();
        await step();
        samples[f] = now() - t0;
    }

    // What the frames actually computed. Two runs that disagree here are not two
    // measurements of one thing, and the ratio between them means nothing.
    let checksum = 0;
    for (const e of entities) {
        const p = world.get(e, Transform).position;
        checksum += p.x + p.y + p.z;
    }

    const sorted = Array.from(samples).sort((a, b) => a - b);
    return { median: pct(sorted, 50), p95: pct(sorted, 95), checksum };
}

const CONFIGS = [
    { key: 'thin interpreted', body: 'thin', compiled: false },
    { key: 'thin compiled', body: 'thin', compiled: true },
    { key: 'thick interpreted', body: 'thick', compiled: false },
    { key: 'thick compiled', body: 'thick', compiled: true },
    { key: 'heavy interpreted', body: 'heavy', compiled: false },
    { key: 'heavy compiled', body: 'heavy', compiled: true },
    { key: 'idle scene', body: null, compiled: false },
];

/** One configuration, in this process, reported on stdout for the parent. */
async function child(key) {
    const config = CONFIGS.find((c) => c.key === key);
    if (!config) throw new Error(`no such configuration: ${key}`);
    const sdk = await import(pathToFileURL(resolveSdk()).href);
    const fixture = await import(pathToFileURL(join(BUILD, 'systems.js')).href);
    const r = await measure(sdk, fixture, resolveWasmDir(), config.body, config.compiled);
    console.log(`RESULT ${JSON.stringify(r)}`);
}

/** The same runtime this is running under — a bench that measured node from bun
 *  would answer a question nobody asked. */
function measureInProcess(key) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--one', key],
        { encoding: 'utf8' });
    const line = (run.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
    if (!line) throw new Error(`no result for "${key}":\n${run.stdout}\n${run.stderr}`);
    return JSON.parse(line.slice('RESULT '.length));
}

async function main() {
    if (!existsSync(join(BUILD, 'systems.wasm'))) {
        throw new Error('nothing built yet — run `node bench/aot-frame/build.mjs` first');
    }
    const wasmDir = resolveWasmDir();

    console.log('='.repeat(72));
    console.log('ESEngine AOT frame benchmark');
    console.log('  runtime  :', detectRuntime());
    console.log('  entities :', ENTITIES);
    console.log('  frames   :', FRAMES, `(+${WARMUP} warmup)`);
    console.log('  wasm dir :', wasmDir);
    console.log('  reps     :', REPS, '(each in its own process; the fastest is reported)');
    console.log('='.repeat(72));

    const runs = new Map(CONFIGS.map((c) => [c.key, []]));
    for (let rep = 0; rep < REPS; rep++) {
        for (const c of CONFIGS) runs.get(c.key).push(measureInProcess(c.key));
        console.log(`rep ${rep + 1}/${REPS} done`);
    }
    /**
     * The FASTEST rep, and what the reps disagreed by. The minimum rather than
     * the median because noise on a desktop only ever adds time: a rep that lost
     * the CPU measured the machine, not the engine, and the spread beside it is
     * what says how much of that there was.
     */
    const of = (key) => {
        const medians = runs.get(key).map((r) => r.median).sort((a, b) => a - b);
        return {
            median: medians[0], lo: medians[0], hi: medians[medians.length - 1],
            checksum: runs.get(key)[0].checksum,
        };
    };

    const idle = of('idle scene');
    console.log('config               frame ms   spread over reps   the system   ns/entity');
    for (const c of CONFIGS) {
        const r = of(c.key);
        const own = c.body ? ms(r.median - idle.median) : '';
        console.log(`${c.key.padEnd(20)} ${ms(r.median).padStart(8)}   `
            + `${`${ms(r.lo)}-${ms(r.hi)}`.padEnd(17)}  ${own.padStart(10)}   `
            + `${c.body ? ((r.median - idle.median) * 1e6 / ENTITIES).toFixed(1) : ''}`);
    }
    console.log('-'.repeat(72));
    for (const body of ['thin', 'thick', 'heavy']) {
        const i = of(`${body} interpreted`);
        const c = of(`${body} compiled`);
        const agree = i.checksum === c.checksum;
        console.log(`${body}: system ${((i.median - idle.median) / (c.median - idle.median)).toFixed(2)}x   `
            + `frame ${(i.median / c.median).toFixed(2)}x   `
            + `${agree ? 'same result' : `RESULT MISMATCH ${i.checksum} vs ${c.checksum}`}`);
    }
    const mismatched = ['thin', 'thick', 'heavy'].some((body) =>
        of(`${body} interpreted`).checksum !== of(`${body} compiled`).checksum);
    console.log('-'.repeat(72));
    console.log('A ratio here is a FLOOR: this runtime has a JIT, and AOT exists for the ones');
    console.log('that do not. Frame ms excludes GPU submission (headless), and this scene is');
    console.log('almost nothing but the system — a real frame carries work no compiler touches.');
    console.log('='.repeat(72));

    if (mismatched) {
        throw new Error('the two worlds computed different things — the ratios above are meaningless');
    }
}

const one = process.argv.indexOf('--one');
const entry = one >= 0 ? child(process.argv[one + 1]) : main();
entry.catch((e) => {
    console.error('bench failed:', e?.stack || e);
    if (typeof process !== 'undefined') process.exitCode = 1;
});
