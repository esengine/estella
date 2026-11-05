// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-native-physx.mjs — a native app runs the 3D solver its project chose.
 *
 * A native host links Jolt and PhysX side by side (PhysX's copy of the one
 * physics3d_* surface renamed to physx3d_*), and the SDK picks between them from
 * the project's `features.physics.backend3d`. The quiet failure is the fallback:
 * a host that lost its PhysX copy, or a mapping that no longer reaches it, still
 * runs the scene, on Jolt, and everything downstream looks fine.
 *
 * So examples/physics-3d is exported twice for this machine's desktop template,
 * once per solver, and run hidden at a fixed 1/60. Held:
 *   - each run says it acquired the module it asked for, and the PhysX run never
 *     says it fell back;
 *   - the bodies that settle (stacked crates, the chain, the lift, the jointed
 *     arm) end where both solvers agree they rest;
 *   - the character does NOT agree: PhysX keeps a skin of a tenth of its radius
 *     (Unity's), Jolt none, so the PhysX hero stands higher. That difference is
 *     the proof the second run was PhysX and not Jolt answering under its name.
 *
 *   node tools/verify-native-physx.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedTemplateDir } from '../build-tools/utils/nativeTemplate.js';
import { desktopExecutableIn } from '../build-tools/utils/desktopApp.js';
import { requireNativeHostSuccess } from './lib/nativeHostResult.mjs';
import { templateEmbedsBundle } from './lib/nativeBytecode.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'examples', 'physics-3d');
const FRAMES = 360;
/** Bodies at rest by frame 360 on both solvers, in scene units. */
const SETTLED = ['Crate1', 'Crate2', 'ChainBall', 'Lift', 'UpperArm'];
const SETTLED_TOLERANCE = 0.5;
/** PhysX's skin is radius/10; the example's hero has radius 30, so 3 units. */
const SKIN_MIN = 1.5;

const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const os = process.platform === 'darwin' ? 'macos'
  : process.platform === 'win32' ? 'windows' : 'linux';

function unanswered(why, fix) {
  console.log(`native physx: ${why} — did NOT run.`);
  if (fix) console.log(`  ${fix}`);
  process.exit(2);
}

function fail(what, detail) {
  console.error(`✗ native physx: ${what}`);
  if (detail) console.error(detail.split('\n').map((l) => `    ${l}`).join('\n'));
  process.exit(1);
}

if (os === 'macos') unanswered('macOS hosts link Jolt only (PhysX 5 dropped Apple platforms)');
const template = process.env.NATIVE_TEMPLATE || installedTemplateDir(version, os);
if (!template || !existsSync(template)) {
  unanswered(`no ${os} runtime template for v${version}`, `build one with: node build-tools/cli.js native --target ${os}`);
}
// The template embeds the SDK: one built before an SDK edit answers for the old one.
const bundle = path.join(ROOT, 'sdk', 'dist', 'index.native.bundled.js');
if (!existsSync(bundle) || !templateEmbedsBundle(template, readFileSync(bundle))) {
  unanswered(`the ${os} template embeds a different SDK from sdk/dist`,
    `pnpm --filter ./sdk build && node build-tools/cli.js native --target ${os}`);
}

const NAMES = [...SETTLED, 'Hero'];
const PROBE = `
import { defineSystem, Query, Transform, Name, addSystemToSchedule, Schedule } from 'esengine';
let frame = 0;
const NAMES = new Set(${JSON.stringify(NAMES)});
addSystemToSchedule(Schedule.Update, defineSystem([Query(Transform, Name)], (rows) => {
    if (++frame !== ${FRAMES - 2}) return;
    const out: Record<string, number[]> = {};
    for (const [, t, name] of rows) {
        if (!NAMES.has(name.value)) continue;
        const p = t.worldPosition;
        out[name.value] = [p.x, p.y, p.z];
    }
    console.log('PHYSX_PROBE ' + JSON.stringify(out));
}, { name: 'NativePhysXProbe' }));
`;

/** Export the example on `backend` and run it; answers its log and the probe. */
function play(backend) {
  const work = mkdtempSync(path.join(tmpdir(), `estella-native-physx-${backend}-`));
  try {
    const proj = path.join(work, 'project');
    const out = path.join(work, 'out');
    cpSync(PROJECT, proj, { recursive: true });
    const manifest = path.join(proj, 'project.esproject');
    const p = JSON.parse(readFileSync(manifest, 'utf8'));
    p.features = { ...(p.features ?? {}), physics: { ...(p.features?.physics ?? {}), backend3d: backend } };
    writeFileSync(manifest, JSON.stringify(p, null, 2));
    writeFileSync(path.join(proj, 'src', 'nativePhysXProbe.ts'), PROBE);
    const main = path.join(proj, 'src', 'main.ts');
    writeFileSync(main, `${readFileSync(main, 'utf8')}\nimport './nativePhysXProbe';\n`);

    const exported = spawnSync(process.execPath, [
      path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', proj,
      '--platform', 'desktop', '--out', out, '--template', template, '--no-aot',
    ], { encoding: 'utf8', cwd: ROOT });
    if (exported.status !== 0) fail(`the ${backend} export failed`, `${exported.stdout}${exported.stderr}`.trim().slice(-800));
    const exe = desktopExecutableIn(out, os);
    if (exe === null) fail(`the ${backend} export assembled no app under ${out}`);

    const run = spawnSync(exe, [], {
      encoding: 'utf8', timeout: 120_000, cwd: path.dirname(exe),
      env: {
        ...process.env,
        ESTELLA_BENCH_FRAMES: String(FRAMES), ESTELLA_BENCH_WARMUP: '0',
        ESTELLA_BENCH_DT: String(1 / 60), ESTELLA_BENCH_QUIT: '1',
        ESTELLA_HIDDEN_WINDOW: process.env.ESTELLA_HIDDEN_WINDOW ?? '1',
      },
    });
    requireNativeHostSuccess(run, `${backend} run`);
    const log = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const line = log.split(/\r?\n/).find((l) => l.includes('PHYSX_PROBE '));
    if (!line) fail(`the ${backend} run printed no probe — did the scene boot?`, log.slice(-1500));
    return { log, at: JSON.parse(line.slice(line.indexOf('PHYSX_PROBE ') + 12)) };
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

const jolt = play('jolt');
const physx = play('physx');

if (!/\[sidemodule\] physics3d: native/.test(jolt.log)) fail('the Jolt run did not acquire physics3d', jolt.log.slice(-1500));
if (/no PhysX compiled in/.test(physx.log)) {
  fail('the PhysX run fell back to Jolt: this host has no physx3d_* copy (configured with -DESTELLA_PHYSX=OFF?)');
}
if (!/\[sidemodule\] physics3d:physx: native/.test(physx.log)) fail('the PhysX run did not acquire physics3d:physx', physx.log.slice(-1500));

for (const name of NAMES) {
  if (!jolt.at[name] || !physx.at[name]) fail(`${name} is missing from a probe`, JSON.stringify({ jolt: jolt.at, physx: physx.at }));
}
for (const name of SETTLED) {
  const [a, b] = [jolt.at[name], physx.at[name]];
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (!(d <= SETTLED_TOLERANCE)) fail(`${name} rests ${d.toFixed(3)} apart on the two solvers`, `jolt ${a}\nphysx ${b}`);
}
const lift = physx.at.Hero[1] - jolt.at.Hero[1];
if (!(lift >= SKIN_MIN)) {
  fail(`the PhysX hero stands ${lift.toFixed(3)} above the Jolt one, and PhysX's skin is ${SKIN_MIN}+ — `
    + 'did Jolt answer the PhysX run?');
}
console.log(`native physx: the ${os} host runs each project's solver — ${SETTLED.length} settled bodies agree, `
  + `the PhysX character stands ${lift.toFixed(2)} higher (its skin).`);
