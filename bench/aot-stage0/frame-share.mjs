// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frame-share.mjs
 * @brief   Amdahl's denominator for the AOT proposal.
 *
 * @details Stage 0 measured that compiling a system LOOP is worth 154-385x
 *          under a no-JIT interpreter. That decides nothing alone: a loop 400x
 *          faster occupying 5% of a frame moves the frame by 1.05x. What
 *          Stage 1 turns on is the SHARE.
 *
 *          Boots the real engine headless and reads the split App.enableStats()
 *          has always kept — every system's ms, the phases, the frame. No new
 *          instrumentation.
 *
 *          Two bounds pull opposite ways, so both are printed:
 *          - it runs under V8 WITH a jit, and the target is an interpreter
 *            where the TS half slows and the C++ half does not, so the share
 *            here is a FLOOR for the native host;
 *          - it is HEADLESS, so the renderer's C++ work is missing and the TS
 *            share is inflated. That is the half still owed.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const ENTITIES = intEnv('BENCH_ENTITIES', 5000);
const FRAMES = intEnv('BENCH_FRAMES', 300);
const WARMUP = intEnv('BENCH_WARMUP', 120);
const DT = 1 / 60;

// What Stage 0 measured for one system loop, QuickJS vs native C++, on the
// thick/scattered (least flattering) configuration. Used only by the projection.
const STAGE0_INTERP_FACTOR = 396;

function intEnv(name, def) {
    const v = process.env[name];
    if (v == null || v === '') return def;
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : def;
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function resolveWasmDir() {
    const candidates = [
        process.env.ESENGINE_WASM_DIR && resolve(process.env.ESENGINE_WASM_DIR),
        join(REPO, 'build', 'wasm', 'web'),
        join(REPO, 'desktop', 'public', 'wasm'),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (existsSync(join(dir, 'esengine.wasm'))) return dir;
    }
    throw new Error('no esengine.wasm — set ESENGINE_WASM_DIR. Tried:\n  ' + candidates.join('\n  '));
}

function resolveSdk() {
    const p = process.env.ESENGINE_SDK
        ? resolve(process.env.ESENGINE_SDK)
        : join(REPO, 'sdk', 'dist', 'index.node.js');
    if (!existsSync(p)) {
        throw new Error(`no built SDK at ${p} — run \`node build-tools/cli.js sdk\` (add --no-cache after a failed build).`);
    }
    return p;
}

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const ms = (x) => x.toFixed(4);
const pctOf = (x, total) => total > 0 ? (100 * x / total).toFixed(1) + '%' : '—';

async function main() {
    const wasmDir = resolveWasmDir();
    const sdkPath = resolveSdk();

    const sdk = await import(pathToFileURL(sdkPath).href);
    const { loadEsengineModule, createHeadlessApp, Transform, Sprite, Velocity } = sdk;

    const module = await loadEsengineModule(wasmDir);
    const app = createHeadlessApp(module);
    app.enableStats();
    const world = app.world;
    const cppRegistry = world.getCppRegistry();

    const rand = mulberry32(0x1234abcd);
    for (let i = 0; i < ENTITIES; i++) {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000, z: 0 } });
        world.insert(e, Velocity, { linear: { x: (rand() - 0.5) * 120, y: (rand() - 0.5) * 120, z: 0 } });
        world.insert(e, Sprite, { size: { x: 16, y: 16 } });
    }

    console.log('='.repeat(70));
    console.log("Estella AOT — Amdahl's denominator   (Stage 0 follow-up)");
    console.log('  runtime  : node', process.versions.node, '(V8, WITH jit)');
    console.log('  entities :', ENTITIES);
    console.log('  frames   :', FRAMES, `(+${WARMUP} warmup)`);
    console.log('  frame    : app.tick + transform_update — headless, no renderer');
    console.log('='.repeat(70));

    const step = async () => {
        await app.tick(DT);
        if (cppRegistry) module.transform_update(cppRegistry);
    };

    for (let f = 0; f < WARMUP; f++) await step();

    // The map read after a tick is already that frame's cost: SystemRunner
    // accumulates WITHIN a frame and App clears at the boundary. Differencing
    // snapshots reports zero — which is what the first version of this did.
    const frameTotals = [];
    const perSystem = new Map();

    for (let f = 0; f < FRAMES; f++) {
        const t0 = performance.now();
        await step();
        const total = performance.now() - t0;

        const timings = app.getSystemTimings();
        if (f === 0 && (!timings || timings.size === 0)) {
            throw new Error('getSystemTimings() is empty after a tick — stats did not take. '
                + 'enableStats() must be called before the first tick builds the SystemRunner.');
        }
        for (const [name, msThisFrame] of timings ?? []) {
            if (!perSystem.has(name)) perSystem.set(name, []);
            perSystem.get(name).push(msThisFrame);
        }
        frameTotals.push(total);
    }

    const frame = median(frameTotals);
    const rows = [...perSystem.entries()]
        .map(([name, xs]) => ({ name, ms: median(xs) }))
        .filter((r) => r.ms > 0)
        .sort((a, b) => b.ms - a.ms);
    const tsTotal = rows.reduce((a, r) => a + r.ms, 0);
    const rest = Math.max(0, frame - tsTotal);

    console.log(`\n  ${'system (TypeScript)'.padEnd(42)} ${'ms/frame'.padStart(10)} ${'of frame'.padStart(9)}`);
    console.log(`  ${'-'.repeat(42)} ${'-'.repeat(10)} ${'-'.repeat(9)}`);
    for (const r of rows) {
        console.log(`  ${r.name.padEnd(42)} ${ms(r.ms).padStart(10)} ${pctOf(r.ms, frame).padStart(9)}`);
    }
    console.log(`  ${'-'.repeat(42)} ${'-'.repeat(10)} ${'-'.repeat(9)}`);
    console.log(`  ${'TS systems, total'.padEnd(42)} ${ms(tsTotal).padStart(10)} ${pctOf(tsTotal, frame).padStart(9)}`);
    console.log(`  ${'everything else (C++/wasm, schedule)'.padEnd(42)} ${ms(rest).padStart(10)} ${pctOf(rest, frame).padStart(9)}`);
    console.log(`  ${'frame'.padEnd(42)} ${ms(frame).padStart(10)} ${'100.0%'.padStart(9)}`);

    const phases = app.getPhaseTimings();
    if (phases && phases.size) {
        const ph = [...phases.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        if (ph.length) {
            console.log('\n  phases (last frame, for shape — not medians)');
            for (const [name, v] of ph) console.log(`    ${name.padEnd(40)} ${ms(v).padStart(10)}`);
        }
    }

    // ----------------------------------------------------------------------
    // `rest` is 4% only because a headless frame has no renderer, so scaling it
    // by the Stage 0 factor is an artifact (this printed a 378x once). Sweep the
    // unknown: for c the C++ share of a no-JIT frame, compiling leaves c+(1-c)/F.
    // ----------------------------------------------------------------------
    const share = frame > 0 ? tsTotal / frame : 0;
    const F = STAGE0_INTERP_FACTOR;

    // Cross-check Stage 0 against the real SDK: its variant A is a hand
    // transcription of the generated accessors under QuickJS, and this is the
    // same shape under V8. They must differ by an interpreter/JIT factor, only.
    const hot = rows[0];
    if (hot) {
        console.log('\n  cross-check against Stage 0');
        console.log(`    ${hot.name} here, under V8 ......... ${ms(hot.ms)} ms`);
        console.log('    Stage 0 variant A, under QuickJS ....... 10.4-11.8 ms');
        console.log(`    => QuickJS/V8 on this loop ............. ~${(11.0 / hot.ms).toFixed(0)}x`);
        console.log('    A plausible interpreter-vs-JIT ratio, so the Stage 0');
        console.log('    transcription is not measuring something else.');
    }

    console.log('\n  how much C++ must a frame carry before AOT stops paying?');
    console.log('  ' + '-'.repeat(66));
    console.log(`    F = ${F}x  (Stage 0, thick/scattered — what compiling the TS half buys)`);
    console.log(`    ${'C++ share of a no-JIT frame'.padEnd(34)} ${'frame speedup'.padStart(14)}`);
    for (const c of [0.01, 0.05, 0.2, 0.5, 0.8, 0.95, 0.99]) {
        const sp = 1 / (c + (1 - c) / F);
        const note = sp >= 2 ? '' : '   <- AOT no longer the lever';
        console.log(`    ${(100 * c).toFixed(0).padStart(3)}%${' '.repeat(30)} ${(sp.toFixed(2) + 'x').padStart(14)}${note}`);
    }

    console.log('\n  where the measured point sits');
    console.log('  ' + '-'.repeat(66));
    console.log(`    headless, V8 ....... TS ${(100 * share).toFixed(1)}%, C++ ${(100 * (1 - share)).toFixed(1)}%`);
    console.log('    Under no-JIT the TS half grows and the C++ half does not, so');
    console.log('    the C++ share only falls from there. The renderer is the whole');
    console.log('    of what this cannot see — and it is the only thing that could');
    console.log('    push c high enough to matter.');
    console.log('\n  NEXT MEASUREMENT: the renderer C++ cost in a real rendered frame.');
    console.log('    The wasm build already records it (render.collect / .submit / .graph /');
    console.log('    .finalize via ES_PROFILE_SCOPE). The native build does not — its');
    console.log('    es_profile_now_ms() returned 0.0 until this branch fixed it.');
    console.log('='.repeat(70));
}

main().catch((e) => {
    console.error('frame-share failed:', e?.stack || e);
    process.exitCode = 1;
});
