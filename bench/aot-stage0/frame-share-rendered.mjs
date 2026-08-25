// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frame-share-rendered.mjs
 * @brief   `c` — the C++ share of a REAL rendered frame.
 *
 * @details frame-share.mjs runs headless, so the renderer is missing and the TS
 *          share it reports is an upper bound. This drives the pixel-gate host
 *          instead — a real WebGL2/WebGPU context, a real scene, 9801 sprites —
 *          and reads the SDK's own ProfileRecorder, which pairs per-system TS ms
 *          with the engine's C++ ES_PROFILE_SCOPE ms.
 *
 *          No new instrumentation: ProfileRecorder.start() already engages both
 *          sides. What was missing was a door on the render host, not a harness.
 *
 *          What it still is NOT: wasm under V8, not native under QuickJS. So the
 *          C++ half is SLOWER here than native and the TS half is FASTER than an
 *          interpreter — both biases inflate `c`, which makes the number a
 *          conservative (pessimistic) input to the Amdahl table.
 *
 *              node bench/aot-stage0/frame-share-rendered.mjs
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync as io_writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const RUNNER = join(ROOT, 'tools', 'render-host', 'run.mjs');

// The sprite-scale-cost gate's scene: one fixture sprite copied onto a 99x99
// grid. A real rendered frame at an entity count a game would recognise.
const SCENE_ENV = {
    ESTELLA_VERIFY_SCENE: '/scenes/scale-sprites.esscene',
    ESTELLA_VERIFY_W: '256',
    ESTELLA_VERIFY_H: '256',
    ESTELLA_VERIFY_STEPS: '30',
    ESTELLA_VERIFY_SCALE: '{"copies":9801,"cols":99,"spacing":[6,6]}',
    ESTELLA_VERIFY_PLAY: '1',
    ESTELLA_VERIFY_PROFILE: process.env.BENCH_FRAMES ?? '90',
};

const STAGE0_INTERP_FACTOR = 396;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const ms = (x) => x.toFixed(4);

function run(cmd, args, env) {
    return spawnSync(cmd, args, {
        cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32',
        env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024,
    });
}

console.log('building the render host (it bundles sdk/dist, not sdk/src)…');
const built = run('node', ['tools/render-host/build.mjs'], {});
if (built.status !== 0) {
    console.error((built.stderr || built.stdout || '').slice(-2000));
    process.exit(1);
}

console.log('driving electron with a real GL context, 9801 sprites…');
const r = run('pnpm', ['exec', 'electron', RUNNER], SCENE_ENV);
const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
const drive = /^DRIVE_RESULT (\{.*\})$/m.exec(out);
if (!drive) {
    console.error(out.slice(-3000));
    console.error('\nno DRIVE_RESULT — the run did not reach its verdict.');
    process.exit(1);
}

// One derivation, not two: the SDK's own tree builder, loaded from the same
// dist the render host bundled.
const { buildFrameProfile } = await import(
    pathToFileURL(join(ROOT, 'sdk', 'dist', 'index.node.js')).href);

const result = JSON.parse(drive[1]);
if (process.env.BENCH_DUMP_FRAME) {
    const f = (result.profile?.frames ?? []).at(-1);
    io_writeFileSync(process.env.BENCH_DUMP_FRAME, JSON.stringify(f));
}
const frames = result.profile?.frames ?? [];
if (!frames.length) {
    console.error('DRIVE_RESULT carried no profile frames. ESTELLA_VERIFY_PROFILE not honoured?');
    process.exit(1);
}

// buildFrameProfile is the SDK's own derivation, the same one the editor panel
// reads, so this computes no second answer. It nests render.collect/.finalize
// under render.submit (which declares remainder:'wait' at CameraPlugin.ts:733).
const tsPer = [];
const cppPer = [];
const cpuPer = [];
const systemTotals = new Map();
const scopeTotals = new Map();
const jsScopeTotals = new Map();
for (const f of frames) {
    const prof = buildFrameProfile({
        frameMs: f.dtMs, systems: f.systems ?? [], scopes: f.scopes ?? [],
        nativeScopes: f.nativeScopes ?? [], gpuMs: f.gpuMs,
    });
    const cpp = sum((f.nativeScopes ?? []).map((s) => s.ms));
    cpuPer.push(prof.cpuMs);
    cppPer.push(cpp);
    tsPer.push(Math.max(0, prof.cpuMs - cpp));
    for (const s of f.systems ?? []) systemTotals.set(s.name, (systemTotals.get(s.name) ?? 0) + s.ms);
    for (const s of f.nativeScopes ?? []) scopeTotals.set(s.name, (scopeTotals.get(s.name) ?? 0) + s.ms);
    for (const s of f.scopes ?? []) jsScopeTotals.set(s.name, (jsScopeTotals.get(s.name) ?? 0) + s.ms);
}

const n = frames.length;
const ts = median(tsPer);
const cpp = median(cppPer);
const cpu = median(cpuPer);
const c = cpu > 0 ? cpp / cpu : 0;
// nativeScopes and systems are both ScopeCost[]/SystemCost[] — {name, ms} — not
// Records. Reading either as a Record yields string concatenation and a silent
// "(none recorded)", which is how the first run of this reported c = 0%.
const gpu = median(frames.map((f) => (typeof f.gpuMs === 'number' ? f.gpuMs : -1)));

console.log('\n' + '='.repeat(70));
console.log('Estella AOT — `c` from a rendered frame');
console.log(`  frames    : ${n} recorded, ${result.entityCount} entities, ${result.drawCalls} draw call(s)`);
console.log(`  runtime   : wasm under V8 — see the header for which way that biases c`);
console.log('='.repeat(70));

const show = (title, totals) => {
    console.log(`\n  ${title}`);
    const rows = [...totals.entries()].map(([k, v]) => [k, v / n]).filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!rows.length) { console.log('    (none recorded)'); return; }
    for (const [k, v] of rows) console.log(`    ${k.padEnd(42)} ${ms(v).padStart(10)} ms`);
};
show('TypeScript systems', systemTotals);
show('engine C++ scopes (ES_PROFILE_SCOPE)', scopeTotals);
show('JS sub-frame scopes (measureFrameScope)', jsScopeTotals);

console.log('\n  ' + '-'.repeat(66));
console.log(`    CPU frame (the systems)  ${ms(cpu).padStart(10)} ms`);
console.log(`      of which C++ inside them ${ms(cpp).padStart(9)} ms   ${(100 * c).toFixed(1)}%   <- c`);
console.log(`      leaving script           ${ms(ts).padStart(9)} ms   ${(100 * (1 - c)).toFixed(1)}%`);
console.log(`    GPU  ${ms(gpu).padStart(10)} ms   (the device's; compiling script does not touch it)`);

// Two MEASURED inputs, not the Stage 0 factor: 396x came from a numeric loop
// over component bytes (AOT's best case) and 94% of the TS here is RenderSystem,
// which is draw submission. K is QuickJS/V8 on real SDK code, per frame-share.mjs.
const K = 12;
const NATIVE_OVER_V8 = STAGE0_INTERP_FACTOR / K;   // ~33x on the Stage 0 loop

const njFrame = K * ts + cpp;
const floorFrame = ts + cpp;                        // compiled TS merely matches V8
const ceilFrame = ts / NATIVE_OVER_V8 + cpp;        // compiled TS runs native
const floorX = njFrame / floorFrame;
const ceilX = njFrame / ceilFrame;

console.log('\n  carried to the native host (TS interpreted, C++ compiled)');
console.log('  ' + '-'.repeat(66));
console.log(`    c measured here (wasm + jit) ............. ${(100 * c).toFixed(1)}%`);
console.log(`    K = QuickJS/V8 on real SDK code ......... ${K}x   (measured)`);
console.log(`    a no-JIT frame would be ................. ${ms(njFrame)} ms CPU`);
console.log(`      of which TS ........................... ${(100 * K * ts / njFrame).toFixed(1)}%`);
console.log('');
console.log(`    compiled TS merely matches a JIT ........ ${floorX.toFixed(1)}x   <- floor`);
console.log(`    compiled TS runs at native speed ........ ${ceilX.toFixed(1)}x   <- ceiling`);
console.log(`
  gate: >= 3x opens Stage 1  ->  ${floorX >= 3 ? 'OPEN' : 'HOLD'}`);

// This scene carries no game logic (VelocitySystem ~0.01 ms — the copies have no
// Velocity), so c is at its RENDERING end; headless is the other end at ~4%. The
// payoff follows c across that range, so one number cannot answer this.
const hottestScope = [...scopeTotals.entries()].sort((a, b) => b[1] - a[1])[0];
console.log('\n  what this scene actually is, and what it is not');
console.log('  ' + '-'.repeat(66));
if (hottestScope) {
    console.log(`    hottest thing in the frame: ${hottestScope[0]} at ${ms(hottestScope[1] / n)} ms`);
    console.log('    — already C++. Compiling script does not touch it.');
}
console.log('    This scene carries no game logic, so c is at its RENDERING end.');
console.log('    frame-share.mjs (headless, all game logic) is the other end at ~4%.');
console.log('    A real game sits between; the payoff follows c:');
for (const cc of [0.05, 0.25, 0.5, c, 0.9]) {
    const njF = K * (1 - cc) + cc;
    const sp = njF / ((1 - cc) / NATIVE_OVER_V8 + cc);
    const mark = Math.abs(cc - c) < 1e-9 ? '  <- measured here' : '';
    console.log(`      c = ${(100 * cc).toFixed(0).padStart(3)}%   ${sp.toFixed(1).padStart(5)}x${mark}`);
}
console.log('='.repeat(70));
