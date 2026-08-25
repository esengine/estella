// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frame-share-rendered.mjs
 * @brief   `c` — the C++ share of a REAL rendered frame (docs/REARCH_AOT.md §14).
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const result = JSON.parse(drive[1]);
const frames = result.profile?.frames ?? [];
if (!frames.length) {
    console.error('DRIVE_RESULT carried no profile frames. ESTELLA_VERIFY_PROFILE not honoured?');
    process.exit(1);
}

// Per frame: TS is every system's ms; C++ is every engine scope's ms. GPU time is
// neither — it is the device's, and compiling script does not touch it.
const tsPer = [];
const cppPer = [];
const systemTotals = new Map();
const scopeTotals = new Map();
for (const f of frames) {
    const ts = sum((f.systems ?? []).map((s) => s.ms));
    const cpp = sum((f.nativeScopes ?? []).map((s) => s.ms));
    tsPer.push(ts);
    cppPer.push(cpp);
    for (const s of f.systems ?? []) systemTotals.set(s.name, (systemTotals.get(s.name) ?? 0) + s.ms);
    for (const s of f.nativeScopes ?? []) scopeTotals.set(s.name, (scopeTotals.get(s.name) ?? 0) + s.ms);
}

const n = frames.length;
const ts = median(tsPer);
const cpp = median(cppPer);
const cpu = ts + cpp;
const c = cpu > 0 ? cpp / cpu : 0;
// nativeScopes and systems are both ScopeCost[]/SystemCost[] — {name, ms} — not
// Records. Reading either as a Record yields string concatenation and a silent
// "(none recorded)", which is how the first run of this reported c = 0%.
const gpu = median(frames.map((f) => (typeof f.gpuMs === 'number' ? f.gpuMs : -1)));

console.log('\n' + '='.repeat(70));
console.log('Estella AOT — `c` from a rendered frame   (REARCH_AOT.md §14)');
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

console.log('\n  ' + '-'.repeat(66));
console.log(`    TS   ${ms(ts).padStart(10)} ms   ${(100 * (1 - c)).toFixed(1)}%`);
console.log(`    C++  ${ms(cpp).padStart(10)} ms   ${(100 * c).toFixed(1)}%   <- c`);
console.log(`    CPU  ${ms(cpu).padStart(10)} ms`);
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
  gate (REARCH_AOT §13.4): >= 3x opens Stage 1  ->  ${floorX >= 3 ? 'OPEN' : 'HOLD'}`);

// The frame's hottest thing is TypeScript, and it is not a game system.
const hottest = [...systemTotals.entries()].sort((a, b) => b[1] - a[1])[0];
if (hottest) {
    const hm = hottest[1] / n;
    console.log('\n  the finding that does not depend on AOT at all');
    console.log('  ' + '-'.repeat(66));
    console.log(`    ${hottest[0]} is ${ms(hm)} ms — ${(100 * hm / ts).toFixed(0)}% of the TS and`);
    console.log(`    ${(100 * hm / cpu).toFixed(0)}% of the CPU frame. The hottest thing in a rendered frame is`);
    console.log('    script, and it is the SDK own draw submission, not game code.');
}
console.log('='.repeat(70));
