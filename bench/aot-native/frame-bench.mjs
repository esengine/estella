// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  frame-bench.mjs — what a compiled system buys a frame on a host with NO JIT.
 *
 * `bench/aot-frame` measured this engine's frame on V8 and on a phone's Chromium.
 * Both have a JIT, and its own README says so: "A no-JIT number, and that is the
 * number AOT exists for." The plan's proxy for that number was a Mac running
 * Bun/JavaScriptCore.
 *
 * The proxy is no longer needed. The desktop native host embeds QuickJS-ng, which
 * has no JIT — the same constraint iOS puts on JavaScriptCore — and as of the AOT
 * native road it dispatches to compiled systems. So this runs the REAL host, the
 * REAL SDK and a REAL exported project, twice from one tree:
 *
 *   `estella export`            the compiled build
 *   `estella export --no-aot`   the same project, same tree, interpreted
 *
 * and reads the host's own frame clock (native/host/Bench.hpp) off both. It also
 * reads a COUNT off the host — how many entities each compiled system was paid
 * over — because the second thing that can go wrong here is not a slower frame
 * but a frame charged for the whole world (see `--gate`).
 *
 * The project is materialized, not committed: an entity count is a parameter, and
 * a scene file per count is a file per parameter. Its systems are COPIED from
 * `bench/aot-frame/project/src/systems.ts` — one source for both benchmarks, so a
 * ratio measured here and one measured there are about the same code.
 *
 * The same clock can also say what a frame spends DRAWING: a pair of scenes
 * differing only in whether they carry a `Sprite`, opt-in with BENCH_RENDER=1.
 * Measured and reported, not gated — the README says what was tried and why.
 *
 *   node bench/aot-native/frame-bench.mjs
 *   BENCH_ENTITIES=20000 BENCH_BODIES=thin,heavy node bench/aot-native/frame-bench.mjs
 *   BENCH_BUILDS=compiled BENCH_BYSTANDERS=95000 node bench/aot-native/frame-bench.mjs
 *   BENCH_BODIES= BENCH_RENDER=1 node bench/aot-native/frame-bench.mjs
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedTemplateDir } from '../../build-tools/utils/nativeTemplate.js';
import { desktopExecutableIn } from '../../build-tools/utils/desktopApp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The one source both AOT benchmarks measure. */
const SYSTEMS = path.join(ROOT, 'bench', 'aot-frame', 'project', 'src', 'systems.ts');

/**
 * `--gate` makes this two release criteria, for two silent failures. A system
 * that stops being dispatched to falls back to the interpreter BY DESIGN — no
 * error, no pixel, only time — caught by the ratio. One that IS dispatched to
 * can still be paid over the whole world, caught by the count and its scenery.
 */
const GATE = process.argv.includes('--gate');
const ENTITIES = Number(process.env.BENCH_ENTITIES ?? (GATE ? 2000 : 5000));
const FRAMES = Number(process.env.BENCH_FRAMES ?? (GATE ? 60 : 300));
const WARMUP = Number(process.env.BENCH_WARMUP ?? (GATE ? 60 : 120));
const REPS = Number(process.env.BENCH_REPS ?? (GATE ? 1 : 3));
/**
 * Reps for a PAIR, whose answer is a ratio: the smaller half decides it, and one
 * bad sample of that half decides the gate. Measured, the same tree read 0.735,
 * 1.195 and 2.864 ms on the compiled side at one rep.
 */
const PAIR_REPS = Math.max(REPS, 3);
const BODIES = (process.env.BENCH_BODIES ?? 'thin').split(',').map((s) => s.trim()).filter(Boolean);
/**
 * Which of the two builds to export and run. Both by default, because the ratio
 * is the point — but the interpreted one is where the time goes (seconds per
 * frame at 100,000 entities), so a question about the compiled side alone should
 * not pay for it. The report drops the ratio lines when a build is missing.
 */
const BUILDS = (process.env.BENCH_BUILDS ?? 'interpreted,compiled')
    .split(',').map((s) => s.trim()).filter(Boolean);
/** Measured at 29x (5000 entities) and ~23x (2000). The bar is what a fallback
 *  cannot pass, not what today happens to reach. */
const MIN_RATIO = Number(process.env.BENCH_MIN_RATIO ?? 5);
/** An idle run of the same scene, so a body's OWN cost can be read off the frame. */
const IDLE = process.env.BENCH_IDLE === '1';
const KEEP = process.env.BENCH_KEEP === '1';
/**
 * Whether the entities carry a `Sprite`. On by default, so the frame is a real
 * one. Turn it off to resolve a COMPILED system: the sprite render is most of the
 * idle floor, and it scales with the entity count, so raising that count alone
 * never lifts a cheap system clear of it.
 */
const SPRITES = process.env.BENCH_SPRITES !== '0';
/**
 * The render pair's scene: one scene twice, differing only in whether its
 * entities carry a `Sprite`, so only the numerator carries the drawing. 128,000
 * because the DENOMINATOR is the small number and its noise is the ratio's — the
 * numerator repeats to 1%, the denominator to 16%, and it does not shrink below.
 */
const RENDER_ENTITIES = Number(process.env.BENCH_RENDER_ENTITIES ?? 128000);
/**
 * How much of a frame's span has to be CPU for the span to be about the engine.
 * A window the compositor throttles reads 16.6 ms at 9% busy whatever the scene
 * holds, and every number in the report is that wait — see MIN_BUSY's uses.
 */
const MIN_BUSY = Number(process.env.BENCH_MIN_BUSY ?? 0.5);
/**
 * Run the pair. Opt-in only: it was a release criterion with a 5x ceiling until
 * 2026-09-02, when the SAME code read 4.78 one day and 5.06–5.17 the next on the
 * machine that set it — the pair's ratio moves with the machine, not the engine.
 */
const RENDER = process.env.BENCH_RENDER === '1';

/**
 * Entities carrying NO component: the size of the WORLD, separated from the size
 * of the matched set. Bare is load-bearing — a bystander the engine transforms
 * moves the idle floor too, leaving the answer as the difference of two large
 * numbers whose run-to-run spread is bigger than it.
 */
const BYSTANDERS = Number(process.env.BENCH_BYSTANDERS ?? (GATE ? 18000 : 0));

/** Which component each body moves, and how to read a position off it. */
const BODY = {
    thin: { system: 'thinSystem', comp: 'Transform', read: 'c.position.x + c.position.y + c.position.z' },
    thick: { system: 'thickSystem', comp: 'Transform', read: 'c.position.x + c.position.y + c.position.z' },
    heavy: { system: 'heavySystem', comp: 'Transform', read: 'c.position.x + c.position.y + c.position.z' },
    script: { system: 'scriptSystem', comp: 'Pos', read: 'c.x + c.y + c.z' },
    idle: { system: null, comp: 'Transform', read: 'c.position.x + c.position.y + c.position.z' },
};

const os = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const version = JSON.parse(spawnSync(process.execPath, ['-p', 'JSON.stringify(require("./package.json"))'],
    { cwd: ROOT, encoding: 'utf8' }).stdout || '{}').version;
const template = installedTemplateDir(version, os);
if (!template || !existsSync(template)) {
    // Saying so was not enough: this exited 0, so the release gate read three
    // criteria as answered on every runner that never had a template. 2 is the
    // convention for a machine that cannot answer, which is not a verdict.
    console.log(`aot native bench: no ${os} runtime template for v${version} — did NOT run.`);
    console.log(`  build one with: node build-tools/cli.js native --target ${os}`);
    process.exit(2);
}

// ---------------------------------------------------------------- the project

/** The scene: a camera and nothing else. The entities are a startup system's,
 *  because their number is this benchmark's parameter. */
const SCENE = JSON.stringify({
    version: 4,
    name: 'Main',
    entities: [{
        id: 0, name: 'Camera', parent: null, children: [], visible: true,
        components: [
            { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
            { type: 'Camera', data: { projectionType: 1, orthoSize: 1200, isActive: true, priority: 0 } },
        ],
    }],
}, null, 2);

const TSCONFIG = JSON.stringify({
    compilerOptions: {
        target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', strict: true,
        esModuleInterop: true, skipLibCheck: true, declaration: false,
        outDir: './dist', rootDir: '.',
        paths: { esengine: ['./.esengine/sdk/index.d.ts'], 'esengine/wasm': ['./.esengine/sdk/wasm.d.ts'] },
    },
    include: ['src/**/*'], exclude: ['node_modules'],
}, null, 2);

/**
 * The project's own source. The scene is built by a startup system from a SEEDED
 * generator — the same one `bench/aot-frame/measure.mjs` uses — because two builds
 * with different starting positions have no differential between them, and
 * `Math.random` would give exactly that.
 */
function mainTs(body, scene) {
    const spec = BODY[body];
    const schedule = spec.system === null ? '' : `addSystemToSchedule(Schedule.Update, ${spec.system});\n`;
    return `import {
    addStartupSystem, addSystemToSchedule, Schedule, defineSystem,
    Commands, Query, Transform, Sprite,
} from 'esengine';
import { Mover, Pos, thinSystem, thickSystem, heavySystem, scriptSystem } from './systems';

// Generated by bench/aot-native/frame-bench.mjs — an entity count is a parameter.
const ENTITIES = ${scene.entities};
const BYSTANDERS = ${scene.bystanders};
const CHECKSUM_AT = ${WARMUP + FRAMES};

/** The generator bench/aot-frame uses, so both benchmarks lay out one scene. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const setupSystem = defineSystem([Commands()], (cmds) => {
    const rand = mulberry32(0x1234abcd);
    for (let i = 0; i < ENTITIES; i++) {
        cmds.spawn()
            .insert(Transform, { position: { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000, z: 0 } })
            .insert(Mover, { dx: rand() - 0.5, dy: rand() - 0.5, speed: 40 + rand() * 80, boost: rand() < 0.5 ? 1 : 0 })
            .insert(Pos, { x: 0, y: 0, z: 0 })${scene.sprites
        ? "\n            .insert(Sprite, { size: { x: 4, y: 4 }, color: { r: 1, g: 1, b: 1, a: 1 } })" : ''};
    }
    // NOTHING on them: they grow the world without growing the matched set, and
    // cost the engine's frame nothing. The dispatcher still decides about each —
    // the host's forEachEntity yields every live entity, component or not.
    for (let i = 0; i < BYSTANDERS; i++) {
        cmds.spawn();
    }
}, { name: 'BenchSetup' });

/**
 * What the frames actually computed. Printed once, from the frame the timed run
 * ends on: two builds that disagree here are not two measurements of one thing,
 * and the ratio between them means nothing.
 */
let seen = 0;
const checksumSystem = defineSystem([Query(${spec.comp})], (query) => {
    seen++;
    if (seen !== CHECKSUM_AT) return;
    let sum = 0;
    for (const [, c] of query) sum += ${spec.read};
    console.log('bench checksum: ' + sum.toFixed(4) + ' over ' + ENTITIES + ' entities');
}, { name: 'BenchChecksum' });

addStartupSystem(setupSystem);
${schedule}addSystemToSchedule(Schedule.Update, checksumSystem);
`;
}

/** What a scene is, as parameters: everything the generated project differs by. */
const SCENE_DEFAULT = { entities: ENTITIES, bystanders: BYSTANDERS, sprites: SPRITES };

function materialize(dir, body, scene = SCENE_DEFAULT) {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    mkdirSync(path.join(dir, 'assets', 'scenes'), { recursive: true });
    copyFileSync(SYSTEMS, path.join(dir, 'src', 'systems.ts'));
    writeFileSync(path.join(dir, 'src', 'main.ts'), mainTs(body, scene));
    writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG);
    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene'), SCENE);
    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene.meta'), JSON.stringify({
        uuid: '7b1f0c8e-4a2d-4f61-9c3a-9d5e2f7a1b04', version: '2.0', type: 'scene',
        importer: { autoMigrate: true },
    }, null, 2));
    writeFileSync(path.join(dir, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: `AotNativeBench-${path.basename(dir)}`,
        description: 'Generated by bench/aot-native — what a compiled system buys a no-JIT frame.',
        version: '0.1.0', defaultScene: 'assets/scenes/main.esscene',
        designResolution: { width: 800, height: 600 }, spineVersion: 'none',
    }, null, 2));
}

// ---------------------------------------------------------------- export + run

function exportApp(project, out, compiled) {
    const args = [path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', project,
        '--platform', 'desktop', '--out', out, '--template', template];
    if (!compiled) args.push('--no-aot');
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
    if (r.status !== 0) {
        console.error(`✗ the export failed (${compiled ? 'aot' : 'no-aot'})`);
        console.error((r.stderr || r.stdout || '').trim().slice(-1500));
        process.exit(1);
    }
    const exe = desktopExecutableIn(out, os);
    if (exe === null) {
        console.error(`✗ the export assembled no app under ${out}`);
        process.exit(1);
    }
    return exe;
}

function run(exe, label) {
    const r = spawnSync(exe, [], {
        encoding: 'utf8', cwd: path.dirname(exe),
        env: {
            ...process.env,
            ESTELLA_BENCH_FRAMES: String(FRAMES),
            ESTELLA_BENCH_WARMUP: String(WARMUP),
            ESTELLA_BENCH_LABEL: label,
            ESTELLA_BENCH_DT: String(1 / 60),
        },
    });
    const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const line = /bench: (\{.*\})/.exec(log);
    if (line === null) {
        console.error(`✗ ${label}: the host printed no bench line`);
        console.error(log.trim().split('\n').slice(-15).join('\n'));
        process.exit(1);
    }
    const checksum = /bench checksum: ([-\d.]+)/.exec(log);
    return {
        ...JSON.parse(line[1]),
        checksum: checksum ? checksum[1] : null,
        // Installed is not enough: a module can load and never be dispatched to.
        running: /AOT: (\w+) is running compiled/.exec(log)?.[1] ?? null,
    };
}

// ---------------------------------------------------------------------- drive

const out = mkdtempSync(path.join(tmpdir(), 'estella-aot-native-bench-'));
const rows = [];
/** The render pair's two halves, keyed by which one they are. */
const render = {};
try {
    const bodies = IDLE ? [...BODIES, 'idle'] : BODIES;
    for (const body of bodies) {
        if (!(body in BODY)) { console.error(`✗ unknown body "${body}"`); process.exit(1); }
        const project = path.join(out, `${body}-project`);
        materialize(project, body);
        const built = {};
        for (const key of BUILDS) {
            process.stdout.write(`  exporting ${body} ${key}...\n`);
            built[key] = exportApp(project, path.join(out, `${body}-${key}`), key === 'compiled');
        }
        // Every rep in its own process and the FASTEST kept: noise only ever adds
        // time. Interleaved across the builds — run one's reps then the other's
        // and any drift between the two stretches lands whole in the ratio.
        const best = {};
        for (let rep = 0; rep < PAIR_REPS; rep++) {
            for (const key of BUILDS) {
                const r = run(built[key], `${body} ${key}`);
                process.stdout.write(`  ${body} ${key} rep ${rep + 1}/${PAIR_REPS}: cpu p50 ${r.cpu.p50.toFixed(3)} ms\n`);
                if (best[key] === undefined || r.cpu.p50 < best[key].cpu.p50) best[key] = r;
            }
        }
        for (const key of BUILDS) rows.push({ body, key, ...best[key] });
    }
    // The render pair. Compiled only: `idle` schedules no system, so the two
    // builds of it are the same program, and the interpreted export would cost a
    // minute to measure nothing.
    if (RENDER) {
        const halves = ['drawing', 'holding'];
        const exe = {};
        for (const half of halves) {
            const project = path.join(out, `${half}-project`);
            materialize(project, 'idle',
                { entities: RENDER_ENTITIES, bystanders: 0, sprites: half === 'drawing' });
            process.stdout.write(`  exporting ${half} (${RENDER_ENTITIES} entities)...\n`);
            exe[half] = exportApp(project, path.join(out, `${half}-build`), true);
        }
        // Interleaved and repped like the bodies above: same shape, same reason.
        for (let rep = 0; rep < PAIR_REPS; rep++) {
            for (const half of halves) {
                const r = run(exe[half], half);
                process.stdout.write(`  ${half} rep ${rep + 1}/${PAIR_REPS}: cpu p50 ${r.cpu.p50.toFixed(3)} ms\n`);
                if (render[half] === undefined || r.cpu.p50 < render[half].cpu.p50) render[half] = r;
            }
        }
    }
} finally {
    if (!KEEP) rmSync(out, { recursive: true, force: true });
    else console.log(`\nkept: ${out}`);
}

// --------------------------------------------------------------------- report

console.log(`\nno-JIT frame — QuickJS-ng in the native host, ${ENTITIES} entities, `
    + `${FRAMES} frames after ${WARMUP}, best of ${REPS}\n`);
// `tick` is the microtask drain, not the `update` call: that one only schedules an
// async tick. `draws` is a column because a body can move the render's cost —
// `heavy` writes `position.z`, which breaks sprite batching into one draw each.
// `walked` is what a compiled system covered in one frame, `packed` what it had
// to write — zero once the row table is being kept. Counts and not clocks on
// purpose; see the ceiling below.
/** How much of a frame's span was CPU and not waiting; '?' from a host that cannot say. */
const busyText = (r) => (typeof r.busy === 'number' && r.busy >= 0 ? r.busy.toFixed(2) : '?');

console.log('body      build           tick p50    cpu p50   frame p50   busy   draws    walked   packed   compiled?');
for (const r of rows) {
    console.log(`${r.body.padEnd(9)} ${r.key.padEnd(13)} ${`${r.pump.p50.toFixed(3)} ms`.padStart(10)}`
        + ` ${`${r.cpu.p50.toFixed(3)} ms`.padStart(10)} ${`${r.frame.p50.toFixed(3)} ms`.padStart(11)}`
        + ` ${busyText(r).padStart(6)} ${String(r.draws ?? '?').padStart(7)} ${String(r.aotCandidates ?? '?').padStart(9)}`
        + ` ${String(r.aotPacked ?? '?').padStart(8)}   ${r.running ?? '—'}`);
}

let bad = 0;
console.log('');

// A frame the compositor throttled spends its span waiting and reads exactly like
// a frame that cost that much — measured, 16.6 ms whatever the scene held, at 8%
// busy, and the render pair reading 0.99x and passing. Refuse, do not report.
/** A run that measured nothing. Nothing downstream may pass a verdict on it. */
const unmeasured = (r) => r?.waited === true;

for (const r of rows.concat(Object.values(render))) {
    if (typeof r.busy !== 'number' || r.busy < 0) continue;
    if (r.busy >= MIN_BUSY) continue;
    r.waited = true;
    console.error(`✗ ${r.label || 'a run'}: only ${(r.busy * 100).toFixed(0)}% of its frame was CPU`
        + ` (needs ${(MIN_BUSY * 100).toFixed(0)}%) — it WAITED, so ${r.cpu.p50.toFixed(2)} ms is the`
        + ' compositor and not the engine. Measured causes: a covered window, and a virtual display'
        + ' (a remote session), which hands out drawables at its own rate however fast the frame is.');
    bad++;
}

// ------------------------------------------------------------------ the ceiling
//
// A compiled system is paid over what it MATCHES, not over the world: the host
// walks the shortest column each query names, or is handed every entity alive.
const WORLD = ENTITIES + BYSTANDERS;
{
    /**
     * How far past the matched set a system may be paid before this is a bug.
     *
     * Slack, not equality: a query names several columns and the shortest is not
     * always the matched set. Wide enough to be a bug and not a tuning knob —
     * 20,000 movers in a 200,000-entity world walked 20,000, or 200,001 unfixed.
     */
    const slack = Number(process.env.BENCH_MAX_WALKED_SLACK ?? 1.5);
    const ceiling = Math.ceil(ENTITIES * slack);
    for (const r of rows) {
        if (r.key !== 'compiled' || r.body === 'idle') continue;
        if (typeof r.aotCandidates !== 'number') continue;
        const line = `${r.body}: walked ${r.aotCandidates} of a ${WORLD}-entity world`
            + ` for the ${ENTITIES} it matches`;
        if (r.aotCandidates > ceiling) {
            console.error(`✗ ${line} — over the ${ceiling} ceiling; a query is not narrowing`);
            bad++;
        } else if (BYSTANDERS > 0) {
            console.log(`${line} — ${(WORLD / Math.max(r.aotCandidates, 1)).toFixed(1)}x fewer`
                + ' entities than the world has');
        }
        // Nothing in this scene moves after startup, so a row table packed once
        // must still stand. Repacking it every frame is the other silent way to
        // pay for the world: no error, no pixel, just time.
        if (typeof r.aotPacked === 'number' && r.aotPacked > 0) {
            console.error(`✗ ${r.body}: repacked ${r.aotPacked} rows in a world that did not`
                + ' move — the row table is not being kept');
            bad++;
        }
    }
}
// An idle run of the same scene, if one was asked for: the frame minus the system,
// so the body's OWN cost can be read off a frame that also renders 5000 sprites.
const idleOf = (key) => rows.find((r) => r.body === 'idle' && r.key === key)?.cpu.p50 ?? null;
for (const body of [...new Set(rows.map((r) => r.body))]) {
    const i = rows.find((r) => r.body === body && r.key === 'interpreted');
    const c = rows.find((r) => r.body === body && r.key === 'compiled');
    // One build alone still has to answer for itself: it must have run compiled
    // if it was the compiled one, and must NOT have if it was the other.
    if (!i || !c) {
        const only = i ?? c;
        // `idle` schedules no system at all, so it has nothing to dispatch to.
        if (only && body !== 'idle' && only.key === 'compiled' && only.running === null) {
            console.error(`✗ ${body}: the compiled build never dispatched to a compiled system`);
            bad++;
        }
        if (only && only.key === 'interpreted' && only.running !== null) {
            console.error(`✗ ${body}: the --no-aot build dispatched to ${only.running}`);
            bad++;
        }
        continue;
    }
    // Two worlds that computed different things have no ratio between them.
    if (i.checksum === null || c.checksum === null) {
        console.error(`✗ ${body}: a run printed no checksum`);
        bad++;
    } else if (i.checksum !== c.checksum) {
        console.error(`✗ ${body}: the two builds disagree — interpreted ${i.checksum}, compiled ${c.checksum}`);
        bad++;
    }
    if (body !== 'idle' && c.running === null) {
        console.error(`✗ ${body}: the compiled build never dispatched to a compiled system`);
        bad++;
    }
    if (i.running !== null) {
        console.error(`✗ ${body}: the --no-aot build dispatched to ${i.running} — it is not the interpreted twin`);
        bad++;
    }
    if (body === 'idle') continue;
    // "A system is reaching the interpreter" is a verdict about the ENGINE, and a
    // half that spent its frame waiting cannot support one — it is already red
    // above, with the reason it is actually red for.
    if (unmeasured(i) || unmeasured(c)) continue;
    const ratio = i.cpu.p50 / c.cpu.p50;
    if (GATE && !(ratio >= MIN_RATIO)) {
        console.error(`✗ ${body}: the compiled frame is only ${ratio.toFixed(2)}x the interpreted one `
            + `(needs ${MIN_RATIO}x) — a system is reaching the interpreter`);
        bad++;
    }
    const saved = i.cpu.p50 - c.cpu.p50;
    console.log(`${body}: the frame's CPU is ${(i.cpu.p50 / c.cpu.p50).toFixed(2)}x — `
        + `${saved.toFixed(2)} ms of a 16.67 ms frame given back `
        + `(${i.cpu.p50.toFixed(2)} ms -> ${c.cpu.p50.toFixed(2)} ms)`);
    const iIdle = idleOf('interpreted');
    const cIdle = idleOf('compiled');
    if (iIdle !== null && cIdle !== null) {
        // The system is the frame minus an idle run of the same scene. Reported in
        // ns per entity per frame, the unit bench/aot-frame reports, so the two
        // benchmarks' tables can be read side by side.
        const iSys = i.cpu.p50 - iIdle;
        const cSys = c.cpu.p50 - cIdle;
        const ns = (ms) => (ms * 1e6) / ENTITIES;
        console.log(`${' '.repeat(body.length)}  the system alone: ${ns(iSys).toFixed(0)} ns/entity `
            + `-> ${ns(cSys).toFixed(0)} ns/entity`
            + (cSys > 0.05 ? ` (${(iSys / cSys).toFixed(0)}x)` : ' (at the idle floor)'));
    }
}

// ------------------------------------------------------------ what drawing costs
//
// The frame's TIME, which nothing else bounds: the count ceilings hold draws,
// meshes and triangles, every one of which a frame can honour for twice the CPU.
if (render.drawing && render.holding) {
    // Counts first, and they hold whether or not the frame was measurable: two
    // halves that both drew nothing would read 1.0x, having measured one scene
    // twice, and no timing rule can catch that.
    if (!(render.drawing.draws > 0) || render.holding.draws !== 0) {
        console.error(`✗ drawing: the pair is not a pair — ${render.drawing.draws} draw(s) with sprites, `
            + `${render.holding.draws} without`);
        bad++;
    }
}
if (render.drawing && render.holding && !unmeasured(render.drawing) && !unmeasured(render.holding)) {
    const drawing = render.drawing.cpu.p50;
    const holding = render.holding.cpu.p50;
    const ratio = drawing / holding;
    const nsPerSprite = ((drawing - holding) * 1e6) / RENDER_ENTITIES;
    // A CPU rasterizer pays for the sprites inside this span too; say so.
    const onCpu = render.drawing.adapter === 'cpu';
    console.log(`\ndrawing: ${RENDER_ENTITIES} sprites make the frame ${ratio.toFixed(2)}x the one that `
        + `only holds them (${holding.toFixed(2)} ms -> ${drawing.toFixed(2)} ms, `
        + `${nsPerSprite.toFixed(0)} ns/sprite, ${render.drawing.draws} draw(s)`
        + `${onCpu ? ', rasterized on the CPU' : ''})`);
}

if (bad > 0) process.exit(1);
