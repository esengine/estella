#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bench/residency/heavy.mjs — is there a cell arrival nobody can split?
 *
 * The cube world says no: 0.42 ms of spawn per cell and an arrival frame of
 * 6 ms for twenty-five of them. What it cannot say is whether real content —
 * an imported skin, several imported meshes, materials, textures, an animator,
 * a few hundred bodies — hides a main-thread phase big enough to need a budget.
 *
 * So this builds ONE deliberately heavy cell out of assets that already exist
 * (the third-person sample's), packages it, and reads two instruments rather
 * than a stopwatch: the per-cell PHASES of the load, which run between frames
 * and land on no system timer, and the per-SYSTEM cost of the frames the cell
 * arrives on.
 *
 *   node bench/residency/heavy.mjs
 *   node bench/residency/heavy.mjs --props 80 --bodies 400
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runElectron } from '../../tools/lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = path.join(ROOT, '.golden', 'bench-heavy');
const LAUNCHER = path.join(ROOT, 'tools', 'launchers', 'residency-run.mjs');
const SAMPLE = path.join(ROOT, 'examples', 'third-person-3d', 'assets', 'models');

const flag = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const CELL = 600;
/** The one cell this fixture cooks, as residency registers it. */
const CELL_NAME = 'main.cell_1_0';
const PROPS = Number(flag('props', '40'));
const BODIES = Number(flag('bodies', '200'));

const transform = (x, y, z, s = 1) => ({
    type: 'Transform',
    data: { position: { x, y, z }, scale: { x: s, y: s, z: s } },
});
const box = (r, g, b) => ({
    type: 'MeshRenderer',
    data: { mesh: 'builtin:cube', lit: true, opaque: true, cullBackfaces: true,
            color: { r, g, b, a: 1 } },
});
const solid = (h) => ([
    { type: 'RigidBody3D', data: { bodyType: 0 } },
    { type: 'BoxCollider3D', data: { halfExtents: { x: h, y: h, z: h }, friction: 0.6 } },
]);

function project(dir) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(path.join(dir, 'assets', 'scenes'), { recursive: true });
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    // The sample's own imported products, not a second content pipeline.
    cpSync(SAMPLE, path.join(dir, 'assets', 'models'), { recursive: true });

    const entities = [];
    const push = (id, name, components, parent = null, children = []) =>
        entities.push({ id, name, parent, children, visible: true, components });

    // Persistent: everything residency never removes.
    push(0, 'World', [transform(0, 0, 0),
        { type: 'StreamedWorld', data: { cellSize: CELL } }]);
    push(1, 'Camera', [transform(900, 400, 1400),
        { type: 'Camera', data: { projectionType: 0, fov: 55, nearPlane: 10, farPlane: 8000,
                                   isActive: true, priority: 0 } },
        { type: 'WorldPersistent', data: {} }]);
    push(2, 'Sun', [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 },
            rotation: { w: 0.834, x: -0.521, y: 0.182, z: 0 } } },
        { type: 'Light', data: { type: 1, intensity: 1.05, enabled: true,
                                  color: { r: 1, g: 0.96, b: 0.9, a: 1 } } },
        { type: 'WorldPersistent', data: {} }]);
    push(3, 'Ground', [transform(600, -20, 300, 1), ...solid(2000),
        { type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: true, opaque: true,
            color: { r: 0.3, g: 0.34, b: 0.3, a: 1 } } },
        { type: 'WorldPersistent', data: {} }]);
    // Parked outside every cell; the radius knob decides what it asks for.
    push(4, 'Source', [transform(-1500, 60, 300),
        { type: 'WorldStreamingSource', data: { loadRadius: 0, unloadRadius: 0, enabled: false } },
        { type: 'WorldPersistent', data: {} }]);

    // The heavy cell, at grid (1,0): a skin, imported meshes at three levels,
    // materials, an animator, and a few hundred bodies.
    let id = 100;
    const skinRoot = id++;
    const bone0 = id++;
    const bone1 = id++;
    const body = id++;
    push(skinRoot, 'Hero', [transform(900, 60, 300),
        { type: 'Animator', data: { controller: 'assets/models/locomotion.esanimator',
                                     currentState: '', enabled: true } }],
        null, [bone0, bone1, body]);
    push(bone0, 'Bone0', [transform(0, 0, 0)], skinRoot);
    push(bone1, 'Bone1', [transform(60, 0, 0)], skinRoot);
    push(body, 'HeroBody', [transform(0, 0, 0),
        { type: 'MeshRenderer', data: { mesh: 'assets/models/skinned-fade.esmesh',
            lit: true, opaque: true, color: { r: 0.35, g: 0.75, b: 0.45, a: 1 } } },
        { type: 'MeshSkin', data: { joints: [bone0, bone1] } }], skinRoot);

    const LEVELS = ['rock-lod0', 'rock-lod1', 'rock-lod2'];
    for (let n = 0; n < PROPS; n++) {
        const x = 620 + (n % 8) * 22;
        const z = 20 + Math.floor(n / 8) * 22;
        push(id++, `Rock${n}`, [transform(x, 30, z, 1),
            { type: 'MeshRenderer', data: { mesh: `assets/models/${LEVELS[n % 3]}.esmesh`,
                lit: true, opaque: true,
                color: { r: 0.5 + (n % 5) * 0.08, g: 0.5, b: 0.45, a: 1 } } },
            { type: 'LODGroup', data: { lod1: 'assets/models/rock-lod1.esmesh',
                lod2: 'assets/models/rock-lod2.esmesh',
                lod1Size: 0.25, lod2Size: 0.11, cullSize: 0.02, hysteresis: 0.1 } }]);
    }
    for (let n = 0; n < BODIES; n++) {
        const x = 610 + (n % 20) * 9;
        const z = 300 + Math.floor(n / 20) * 9;
        push(id++, `Body${n}`, [transform(x, 30, z, 0.2), box(0.6, 0.55, 0.45), ...solid(10)]);
    }

    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene'),
        JSON.stringify({ version: 4, name: 'main', entities }, null, 1) + '\n');
    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene.meta'),
        JSON.stringify({ uuid: randomUUID(), version: '2.0', type: 'scene', importer: {} }) + '\n');
    writeFileSync(path.join(dir, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'Heavy Cell', description: 'One deliberately heavy cell.',
        tag: '3D', version: '0.1.0', defaultScene: 'assets/scenes/main.esscene',
        designResolution: { width: 640, height: 360 }, spineVersion: 'none',
    }, null, 2) + '\n');
    writeFileSync(path.join(dir, 'src', 'main.ts'), `
import { addSystemToSchedule, Schedule, defineSystem, GetWorld, Res, Input, Transform, WorldStreamingSource } from 'esengine';
import type { World, InputState } from 'esengine';

// Latched, because a gesture is one frame and residency is asked every frame: a
// system that reads the key alone would give the cell back the frame after.
let ready = false;
let want = false;

const radiusSystem = defineSystem(
    [Res(Input), GetWorld()],
    (input: InputState, world: World) => {
        if (input.isKeyPressed('Digit2')) ready = true;
        if (input.isKeyPressed('Digit1')) want = true;
        const source = world.findEntityByName('Source');
        if (source !== null && (ready || want)) {
            world.update(source, WorldStreamingSource, (s) => {
                s.loadRadius = want ? 3000 : 0;
                s.prefetchRadius = ready ? 3000 : 0;
                s.unloadRadius = 3200;
                s.enabled = true;
            });
        }
        // Turning the camera away and back is what separates "publication made
        // the renderer work" from "seeing it for the first time did".
        const away = input.isKeyPressed('Digit3');
        const back = input.isKeyPressed('Digit4');
        if (!away && !back) return;
        const camera = world.findEntityByName('Camera');
        if (camera === null) return;
        world.update(camera, Transform, (t) => {
            t.rotation.x = 0; t.rotation.z = 0;
            t.rotation.y = away ? 1 : 0;
            t.rotation.w = away ? 0 : 1;
        });
    },
    { name: 'RadiusSystem' },
);
addSystemToSchedule(Schedule.Update, radiusSystem);
`);
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', strict: true,
            esModuleInterop: true, skipLibCheck: true, noEmit: true,
            paths: { esengine: ['./.esengine/sdk/index.d.ts'] },
        },
        include: ['src/**/*'],
    }, null, 2) + '\n');
    return dir;
}

function main() {
    if (!existsSync(SAMPLE)) {
        console.error(`✗ the sample's imported assets are not here: ${SAMPLE}`);
        process.exit(2);
    }
    rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(WORK, { recursive: true });
    const src = project(path.join(WORK, 'src'));
    const out = path.join(WORK, 'web');
    const built = spawnSync(process.execPath, [
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', src,
        '--platform', 'web', '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    if (built.status !== 0) {
        console.error(`✗ the heavy world did not package:\n${(built.stderr || built.stdout || '').slice(-900)}`);
        process.exit(1);
    }

    // Two ways into the SAME cell, each from a cold cache, because the question
    // "what does prefetch cost" has no answer from one of them: readying early
    // does not make the work cheaper, it moves WHEN it is paid.
    // One frame at a time, every one broken down: an arrival costs its excess
    // over a steady state, and a steady state nobody broke down is a number to
    // subtract from rather than one to attribute.
    const profile = (as, key) => ({ do: 'frames', as, key, count: 240, costsAbove: 0 });
    const arms = [
        ['miss', [{ do: 'step', frames: 30 }, profile('arrival', 'Digit1')]],
        // Readied and SETTLED first: `arrive` waits out `preparing`, so the
        // demand below meets a cell that is already `prepared`.
        ['hit', [{ do: 'step', frames: 30 }, { do: 'arrive', as: 'primed', key: 'Digit2' },
                 profile('arrival', 'Digit1')]],
        // Nothing ever arrives. The control for every spike below: a renderer
        // that produces one of these on its own is not producing it for us.
        ['zero', [{ do: 'step', frames: 30 }, profile('arrival', null)]],
        // Published with the camera turned away, then turned back. Which of the
        // two profiles carries the spike is the whole experiment: publication
        // bookkeeping shows in the first, first visibility in the second.
        ['blind', [{ do: 'step', frames: 30 }, { do: 'tap', key: 'Digit3', frames: 10 },
                   profile('published', 'Digit1'), profile('revealed', 'Digit4')]],
        // Does a PREPARED cell know what a published one needs? Both derivations
        // run on the same cell and their key SETS are compared — a count that
        // matched by luck would not be an equivalence.
        ['equivalence', [{ do: 'step', frames: 30 }, { do: 'tap', key: 'Digit3', frames: 10 },
                         profile('published', 'Digit1'),
                         { do: 'prewarm', as: 'document', cell: CELL_NAME, from: 'document' },
                         { do: 'prewarm', as: 'entities', cell: CELL_NAME }]],
        // The same walk, with the programs readied while the camera is still
        // away. If first visibility then costs what a warm frame costs, the
        // hitch was the compile and readying it early is where it belongs.
        ['prewarmed', [{ do: 'step', frames: 30 }, { do: 'tap', key: 'Digit3', frames: 10 },
                       profile('published', 'Digit1'),
                       { do: 'prewarm', as: 'ready', cell: CELL_NAME },
                       profile('revealed', 'Digit4')]],
        // The real shape: readied while the cell is only PREPARED, from its own
        // document, before a single entity of it exists. Then demanded, which on
        // this path publishes and becomes visible in the same frame.
        ['readied', [{ do: 'step', frames: 30 },
                     { do: 'arrive', as: 'primed', key: 'Digit2' },
                     { do: 'prewarm', as: 'ready', cell: CELL_NAME, from: 'document' },
                     profile('arrival', 'Digit1')]],
    ];

    // `--arms hit,blind` narrows a remeasure to the question being asked. Each
    // arm is its own Electron, so running the ones nobody is reading is minutes
    // spent on a number nobody will look at.
    const wanted = flag('arms', '').split(',').filter(Boolean);
    for (const [arm, steps] of arms.filter(([a]) => wanted.length === 0 || wanted.includes(a))) {
        const runs = drive(out, arm, steps);
        for (const [as, { frames, delivery }] of runs) {
            report(`${arm}${runs.size > 1 ? `/${as}` : ''}`, frames, delivery);
        }
        for (const [as, ready] of prewarmed.get(arm) ?? []) {
            console.log(`\n  readying ${arm}/${as} took ${ready.ms.toFixed(2)} ms`
                + ` — ${ready.compiles} compile(s) of ${ready.uniqueKeys} unique key(s)`
                + ` over ${ready.asks} ask(s) for ${ready.entities} renderable(s);`
                + ` ${ready.materialCompiles} material compile(s) of ${ready.materialAsks} ask(s)`
                + `  keys ${keySet(ready)}`);
        }
        const both = prewarmed.get(arm);
        if (both?.has('document') && both.has('entities')) {
            const doc = both.get('document');
            const live = both.get('entities');
            const same = doc.keysLo === live.keysLo && doc.keysHi === live.keysHi;
            failedTotal += same ? 0 : 1;
            console.log(`\n  ${same ? '✓' : '✗'} what a PREPARED cell knows it will need equals`
                + ` what its published entities ask for`
                + ` — ${keySet(doc)} from the document, ${keySet(live)} from the world`);
            const materials = doc.materialAsks === live.materialAsks;
            failedTotal += materials ? 0 : 1;
            console.log(`  ${materials ? '✓' : '✗'} and the material-owned path is enumerated the`
                + ` same both ways — ${doc.materialAsks} against ${live.materialAsks} ask(s)`);
        }
    }
    console.log('');
    process.exit(failedTotal === 0 ? 0 : 1);
}

let failedTotal = 0;
/** What readying an arm's programs early cost, by arm. */
const prewarmed = new Map();

/** Run one arm in its own Electron, so each pays for its own cold cache. */
function drive(out, name, steps) {
    const script = path.join(WORK, `${name}.json`);
    writeFileSync(script, JSON.stringify(steps, null, 2));
    const run = runElectron([LAUNCHER, '--dir', out, '--script', script, '--w', '640', '--h', '360'],
        // Node's 1 MB default truncates a per-frame profile mid-JSON, and a
        // truncated line parses as nothing — which this bench then reports as an
        // engine that produced no measurement.
        { encoding: 'utf8', cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });

    // Keyed by the step's `as`, because an arm may profile twice — publishing
    // and revealing are two events, and one overwriting the other is how the
    // experiment that separates them stops separating them.
    const runs = new Map();
    for (const line of (run.stdout || '').split('\n')) {
        const ready = /^prewarm ([^:]+): (.*)$/.exec(line);
        if (ready) {
            try {
                if (!prewarmed.has(name)) prewarmed.set(name, new Map());
                prewarmed.get(name).set(ready[1], JSON.parse(ready[2]));
            } catch { /* partial */ }
            continue;
        }
        const match = /^(profile|delivery) ([^:]+): /.exec(line);
        if (!match) continue;
        const [, kind, as] = match;
        if (!runs.has(as)) runs.set(as, { frames: null, delivery: null });
        try {
            const rest = line.slice(match[0].length);
            // A profile arrives as a path, because stdout cannot carry it whole.
            const body = kind === 'profile' && !rest.startsWith('[')
                ? readFileSync(rest.trim(), 'utf8')
                : line.slice(line.indexOf(kind === 'profile' ? '[' : '{', match[0].length - 1));
            runs.get(as)[kind === 'profile' ? 'frames' : 'delivery'] = JSON.parse(body);
        } catch { /* partial line */ }
    }
    for (const [as, r] of runs) if (!r.frames) runs.delete(as);
    if (runs.size === 0) {
        console.error(`✗ ${name}: nothing was measured — ${(run.stdout || run.stderr || '').slice(-500)}`);
        process.exit(2);
    }
    return runs;
}

/**
 * What may be left unnamed before an instrument is not closed.
 *
 * PER FRAME for the frame accounting, because the residual IS the per-frame cost
 * outside every system accumulated over the window — a fixed budget would pass a
 * short window and fail a long one for the same engine.
 */
const RESIDUAL_MS = 0.6;
const RESIDUAL_MS_PER_FRAME = 0.15;

function report(arm, frames, delivery) {

    console.log(`\n${'='.repeat(78)}\nheavy cell, ${arm.toUpperCase()} — `
        + `${arm === 'hit' ? 'readied before it was wanted' : 'wanted before anything readied it'}`
        + ` — 1 skin, ${PROPS} imported props, ${BODIES} bodies\n`);

    let failed = 0;
    const check = (ok, claim, detail) => {
        if (!ok) failed++;
        failedTotal += ok ? 0 : 1;
        console.log(`  ${ok ? '✓' : '✗'} ${claim}${detail ? ` — ${detail}` : ''}`);
    };

    // Three events, not one: need (the gesture), publish (the entities exist),
    // visible (the renderer first ACCEPTS them). Anchoring on publish measures
    // the wrong event, and a spike outside such a window is a definition.
    const publishAt = frames.findIndex((f) => f.resident > 0);
    const drawn = (f) => f.drawn ?? 0;
    const floor = drawn(frames[0]);
    const peak = Math.max(...frames.map(drawn));
    const visibleAt = peak > floor + 10
        ? frames.findIndex((f) => drawn(f) >= floor + (peak - floor) * 0.5)
        : -1;
    // An arm where nothing ever arrives is the control, and it has no window.
    // Reported as such rather than as an arrival of zero frames: those are two
    // different statements and only one of them is true here.
    const arrivalAt = visibleAt >= 0 ? visibleAt : publishAt;
    const arrived = arrivalAt >= 0;
    console.log(`  need f0  →  publish ${publishAt < 0 ? '(never)' : `f${publishAt}`}`
        + `  →  first renderable accepted ${visibleAt < 0 ? '(never)' : `f${visibleAt}`}`
        + `   (${floor} → ${peak} drawn)`);
    // MEANS, and means for both halves. A median wall time against mean domain
    // times is two baselines, and the excess arithmetic below then does not
    // close — it reported 112% of an excess it had mis-subtracted.
    const settled = frames.slice(-60);
    const mean = (values) => values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const baseline = mean(settled.map((f) => f.ms));
    const baselineSystems = mean(settled.map((f) => sumDomains(f)));
    const baselineDomains = new Map();
    for (const f of settled) {
        for (const [domain, ms] of byDomain(f)) {
            baselineDomains.set(domain, (baselineDomains.get(domain) ?? 0) + ms / settled.length);
        }
    }
    // Closes on quiet, not on a count. Realization lands a variable number of
    // frames after publication, so a fixed window is one that sometimes misses
    // the thing it exists to measure.
    const QUIET = 3;
    const window = [];
    if (arrivalAt >= 0) {
        let calm = 0;
        for (let i = arrivalAt; i < frames.length && window.length < 40; i++) {
            window.push(frames[i]);
            calm = frames[i].ms <= baseline + 0.3 ? calm + 1 : 0;
            if (calm >= QUIET) break;
        }
    }

    // On every frame of the window, not only the expensive ones: a cheap first
    // visibility is exactly where a compile is easiest to miss.
    const compiledInRun = Math.max(0, ...frames.map((f) => f.compiles ?? 0));
    const compiledInWindow = Math.max(0, ...window.map((f) => f.compiles ?? 0));
    check(compiledInWindow === 0,
        'nothing was compiled on the frames the arrival is made of',
        `peak render.mesh.programCompiles ${compiledInWindow} in the window,`
        + ` ${compiledInRun} across the run`);

    // Which clock brackets the publication transaction depends on where it runs:
    // between frames the streamer's wall time does; inside the frame that spans
    // the rest of it, and only the profiler's `scene` domain is left.
    const sceneExcess = window.reduce((a, f) => a + (byDomain(f).get('scene') ?? 0), 0)
        - (baselineDomains.get('scene') ?? 0) * window.length;

    for (const [cell, v] of Object.entries(delivery ?? {})) {
        const roots = tree(v.phases);
        const half = (keep) => roots.filter((n) => PREPARATION.has(n.name) === keep);

        console.log(`  ${cell} — where its delivery went\n`);
        console.log('  preparation — between frames, on no system timer, and hideable:');
        printTree(half(true), '    ');
        const prepared = sum(half(true));
        console.log(`    ${'= accounted'.padEnd(22)}${prepared.toFixed(2).padStart(7)} ms`
            + `  of ${v.prepareMs.toFixed(2)} ms issue → prepared   (${pct(prepared, v.prepareMs)})`);

        console.log('\n  publicationCost — the publication transaction: prepared data → ECS-visible.');
        console.log('  What demand pays whatever prefetch did, and it is NOT all of what demand pays:');
        printTree(half(false), '    ');
        const published = sum(half(false));
        // Decided by the STREAMER's verdict, not the arm's name: a hit publishes
        // inside the frame that asked, so wall time there spans the whole frame.
        // Keying it on the arm made a third hitting arm read the wrong clock.
        const witness = v.outcome === 'hit'
            ? { ms: sceneExcess, what: "the frame profiler's `scene` domain" }
            : { ms: v.publishMs, what: 'publish → resident wall time' };
        console.log(`    ${'= accounted'.padEnd(22)}${published.toFixed(2).padStart(7)} ms`);
        console.log(`    ${'against'.padEnd(22)}${witness.ms.toFixed(2).padStart(7)} ms`
            + `  from ${witness.what} (${pct(published, witness.ms)})`);
        if (v.outcome === 'hit') {
            console.log(`    ${'(publish → resident'.padEnd(22)}${v.publishMs.toFixed(2).padStart(7)} ms`
                + `  wall, which on a hit spans the whole frame — not the transaction.)`);
        }
        console.log(`\n    ${'delivery'.padEnd(22)}${v.deliveryMs.toFixed(2).padStart(7)} ms  issue → resident`);

        // Two instruments on one interval, so either being wrong shows up as
        // disagreement. A one-sided check would pass by over-counting.
        check(published >= witness.ms * 0.9 && published <= witness.ms * 1.15,
            'the publication a player pays for is explained by named work',
            `${published.toFixed(2)} ms of named phases against ${witness.ms.toFixed(2)} ms `
            + `from ${witness.what} (${pct(published, witness.ms)})`);
        // The check above is satisfied by `spawn: 6.8 ms` and nothing else —
        // the state this bench was written to leave. A total is not a mechanism.
        const biggest = leaves(half(false)).sort((a, b) => b.ms - a.ms)[0] ?? { name: 'none', ms: 0 };
        check(biggest.ms <= published * 0.5,
            'and no single undivided phase is most of it — a total would be, a mechanism is not',
            `largest is ${biggest.name} at ${pct(biggest.ms, published)} of publication`);
        const deepest = closure(half(false));
        if (deepest) {
            console.log(`    (the instrument closes to ${(deepest.ratio * 100).toFixed(1)}% at its worst `
                + `parent, ${deepest.name} — reported, not a criterion: sub-phases partition their `
                + `parent by construction.)`);
        }
        check(v.prepareMs - prepared <= RESIDUAL_MS,
            'and so is the preparation prefetch hides',
            `${(v.prepareMs - prepared).toFixed(2)} ms unnamed of ${v.prepareMs.toFixed(2)} ms `
            + `(${pct(prepared, v.prepareMs)})`);
    }

    console.log(`\n  realization — ECS-visible → actually drawn. Steady state ${baseline.toFixed(2)} ms/frame, `
        + `${arrived ? `anchored on f${arrivalAt}` : 'NOTHING ARRIVED — this is the control'}\n`);
    console.log('    frame     wall   systems  collect    drawn  | by domain');
    // Beyond the window: whether the first frame's collect is a ONE-OFF or the
    // new steady cost is what one frame cannot tell apart.
    const shown = arrived
        ? frames.slice(arrivalAt, Math.max(arrivalAt + window.length, arrivalAt + 12))
        : [];
    for (const f of shown) {
        const domains = byDomain(f);
        const top = [...domains].sort((a, b) => b[1] - a[1]).filter(([, ms]) => ms >= 0.01).slice(0, 3)
            .map(([d, ms]) => `${d} ${ms.toFixed(2)}`).join(', ');
        const collect = f.collect ?? 0;
        const inWindow = frames.indexOf(f) < arrivalAt + window.length;
        console.log(`    f${String(frames.indexOf(f)).padEnd(6)}${f.ms.toFixed(2).padStart(7)}`
            + `${[...domains.values()].reduce((a, b) => a + b, 0).toFixed(2).padStart(9)}`
            + `${collect.toFixed(2).padStart(9)}${String(drawn(f)).padStart(9)}`
            + `  |${inWindow ? '' : ' ·'} ${top}`);
    }
    const wall = window.reduce((a, f) => a + f.ms, 0);
    const accounted = window.reduce((a, f) => a + sumDomains(f), 0);
    console.log(`    ${'window'.padEnd(7)}${wall.toFixed(2).padStart(7)}${accounted.toFixed(2).padStart(9)}`
        + `${pct(accounted, wall).padStart(10)}`);
    // Every frame costs something outside every system (the step call, the
    // promise turn). Charged to the arrival it makes the ratio a measure of how
    // CHEAP the window was, so excess is judged against excess.
    const wallExcess = wall - baseline * window.length;
    const systemExcess = accounted - baselineSystems * window.length;

    // What the arrival ADDED, which is the only part of these frames residency
    // is answerable for: the same systems run on every other frame too.
    const excess = wallExcess;
    const perDomain = new Map();
    for (const f of window) {
        for (const [domain, ms] of byDomain(f)) perDomain.set(domain, (perDomain.get(domain) ?? 0) + ms);
    }
    for (const [domain, ms] of baselineDomains) {
        perDomain.set(domain, (perDomain.get(domain) ?? 0) - ms * window.length);
    }
    console.log(`\n    the arrival cost these ${window.length} frames ${excess.toFixed(2)} ms above steady state:`);
    for (const [domain, ms] of [...perDomain].sort((a, b) => b[1] - a[1])) {
        if (Math.abs(ms) < 0.05) continue;
        console.log(`      ${domain.padEnd(16)}${ms.toFixed(2).padStart(7)} ms`);
    }

    realization(window, frames[arrivalAt]);

    console.log('');
    // The RESIDUAL, not the ratio: at an excess of 2.7 ms the same 0.2 ms of
    // per-frame overhead reads as 93%, so a ratio would measure how cheap the
    // arrival was. A truncated breakdown still fails this, leaving 3.6 ms.
    const residual = wallExcess - systemExcess;
    if (arrived) {
        check(residual <= RESIDUAL_MS_PER_FRAME * window.length,
            'and what the arrival ADDS to those frames is explained by the systems that ran',
            `${residual.toFixed(2)} ms unnamed of ${wallExcess.toFixed(2)} ms of excess over `
            + `${window.length} frames, against ${(RESIDUAL_MS_PER_FRAME * window.length).toFixed(2)}`
            + ` ms of known per-frame overhead (${pct(systemExcess, wallExcess)})`);
    }

    const first = Object.values(delivery ?? {})[0];
    const publicationCost = first
        ? sum(tree(first.phases).filter((n) => !PREPARATION.has(n.name)))
        : 0;
    const firstVisibleFrameCost = window.length ? Math.max(...window.map((f) => f.ms)) : 0;
    const arrivalWindowCost = excess;
    console.log(`\n  what one heavy arrival costs the main thread:\n`);
    console.log(`    publicationCost        ${publicationCost.toFixed(2).padStart(6)} ms   prepared data → ECS-visible, between frames`);
    console.log(`    firstVisibleFrameCost  ${firstVisibleFrameCost.toFixed(2).padStart(6)} ms   the dearest single frame of the arrival`);
    console.log(`    arrivalWindowCost      ${arrivalWindowCost.toFixed(2).padStart(6)} ms   ${window.length} frames, above steady state`);
    console.log(`    ${'─'.repeat(60)}`);
    console.log(`    ECS publication finishing is not the delivery paid for: the larger`);
    console.log(`    half lands after it, in realization.\n`);

    // A budget line, not a tolerance: an arrival may have half a 60 Hz frame
    // because the GAME needs the other half. This fixture's world is nearly
    // empty, so a pass says nothing about a real one and a fail says everything.
    const HEADROOM = 1000 / 60 / 2;
    const spike = firstVisibleFrameCost - baseline;
    const fits = spike <= HEADROOM;
    console.log('');
    // Through `check`: this verdict was incrementing a tally the exit code does
    // not read, so a run that printed the violation still exited 0.
    check(fits, 'BUDGET — a heavy arrival leaves the game its half of the frame',
          `${spike.toFixed(2)} ms of arrival work against ${HEADROOM.toFixed(2)} ms of headroom`);

    void failed;  // every verdict goes through `check`
    const spikes = frames.map((f, i) => ({ i, f }))
        .filter(({ f }) => f.ms > baseline + 4)
        .sort((a, b) => b.f.ms - a.f.ms).slice(0, 6);
    if (spikes.length > 0) {
        console.log('\n    every frame more than 4 ms above steady state:');
        for (const { i, f } of spikes) {
            const own = arrived && i >= arrivalAt && i < arrivalAt + window.length;
            console.log(`      f${String(i).padEnd(5)}${f.ms.toFixed(2).padStart(7)} ms`
                + `  collect ${(f.collect ?? 0).toFixed(2).padStart(6)}`
                + `  drawn ${String(drawn(f)).padStart(5)}`
                + `  ${own ? '(the arrival)' : '(NOT the arrival)'}`);
            // A spike with no collect in it is a different mechanism wearing the
            // same shape, and naming it needs its own scopes rather than the
            // window's — which is what made it look like a delayed arrival.
            const inside = [
                ...(f.scopes ?? []).map((c) => [`js  ${c.name}`, c.ms]),
                ...Object.entries(f.native ?? {}).map(([n, ms]) => [`cpp ${n}`, ms]),
            ].sort((a, b) => b[1] - a[1]).filter(([, ms]) => ms >= 0.1).slice(0, 5);
            for (const [n, ms] of inside) {
                console.log(`          ${n.padEnd(30)}${ms.toFixed(2).padStart(7)} ms`);
            }
        }
    }
    const worstAt = frames.reduce((best, f, i) => (f.ms > frames[best].ms ? i : best), 0);
    const worst = frames[worstAt];
    console.log(`\n  largest single frame of the whole run: f${worstAt} at ${worst.ms.toFixed(1)} ms`
        + ` — ${[...byDomain(worst)].sort((a, b) => b[1] - a[1]).filter(([, ms]) => ms >= 0.05).slice(0, 4)
            .map(([d, ms]) => `${d} ${ms.toFixed(2)}`).join(', ') || 'no breakdown'}`
        + `${worstAt >= arrivalAt && worstAt < arrivalAt + window.length ? '  (inside the arrival window)'
            : '  (OUTSIDE the arrival window)'}`);
}

/**
 * A cell's phases, as the tree their dotted names describe.
 *
 * `spawn.components.MeshRenderer` is inside `spawn.components` is inside
 * `spawn`, so the roots are the only rows that may be summed — adding the whole
 * flat list counts the same milliseconds three times.
 */
function tree(phases) {
    const nodes = new Map();
    const node = (name) => {
        let n = nodes.get(name);
        if (!n) { n = { name, ms: 0, children: [] }; nodes.set(name, n); }
        return n;
    };
    for (const [name, ms] of Object.entries(phases)) node(name).ms = ms;
    const roots = [];
    for (const [name, n] of nodes) {
        const cut = name.lastIndexOf('.');
        if (cut < 0) roots.push(n);
        else node(name.slice(0, cut)).children.push(n);
    }
    const order = (list) => {
        list.sort((a, b) => b.ms - a.ms);
        for (const n of list) order(n.children);
    };
    order(roots);
    return roots;
}

const sum = (nodes) => nodes.reduce((total, n) => total + n.ms, 0);

/** Every phase with no breakdown of its own — the rows a total could hide in. */
function leaves(nodes) {
    const out = [];
    const walk = (list) => {
        for (const n of list) {
            if (n.children.length === 0) out.push(n);
            else walk(n.children);
        }
    };
    walk(nodes);
    return out;
}

/**
 * The worst parent at explaining itself. Summing the ROOTS is blind to a `spawn`
 * measured as one number: its root sum is perfect and it explains nothing.
 */
function closure(nodes) {
    let worst = null;
    const walk = (list) => {
        for (const n of list) {
            if (n.children.length > 0 && n.ms > 0.05) {
                const ratio = sum(n.children) / n.ms;
                if (worst === null || ratio < worst.ratio) worst = { name: n.name, ratio, ms: n.ms };
            }
            walk(n.children);
        }
    };
    walk(nodes);
    return worst;
}


/** Print one phase subtree, naming what its children do not explain. */
function printTree(nodes, indent) {
    for (const n of nodes) {
        const leaf = n.name.slice(n.name.lastIndexOf('.') + 1);
        console.log(`${indent}${leaf.padEnd(26 - indent.length)}${n.ms.toFixed(2).padStart(7)} ms`);
        if (n.children.length === 0) continue;
        printTree(n.children, indent + '  ');
        // A parent measured by one clock against children measured by another:
        // the gap is real work nobody named, and hiding it would make every
        // accounting below true by construction.
        const rest = n.ms - sum(n.children);
        if (rest > 0.005) {
            console.log(`${indent}  ${'(unattributed)'.padEnd(24 - indent.length)}${rest.toFixed(2).padStart(7)} ms`);
        }
    }
}

/** Which half of delivery owns a root phase — the split prefetch turns on. */
const PREPARATION = new Set(['fetch', 'prefab', 'assets', 'discover', 'subsystems', 'readying']);


const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const median = (values) => {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Inside the render domain, on the frame the arrival landed on.
 *
 * Systems say WHICH subsystem paid; only the scopes say what it was doing. The
 * `cpp.*` rows nest inside the JS scope that called them, so the two are printed
 * as lists and never summed into one total.
 */
function realization(window, arrival) {
    const rows = [];
    for (const f of window) {
        for (const s of f.scopes ?? []) rows.push({ where: 'js', ...s, frame: f });
        for (const [name, ms] of Object.entries(f.native ?? {})) {
            rows.push({ where: 'cpp', name, ms, system: '', frame: f });
        }
    }
    if (rows.length === 0) {
        console.log('\n    (no scopes: the frames were too cheap to carry a breakdown)');
        return;
    }
    console.log('\n    inside the arrival frames, by scope:');
    const total = new Map();
    for (const r of rows) {
        const key = `${r.where}  ${r.name}`;
        total.set(key, (total.get(key) ?? 0) + r.ms);
    }
    for (const [name, ms] of [...total].sort((a, b) => b[1] - a[1])) {
        if (ms < 0.05) continue;
        console.log(`      ${name.padEnd(30)}${ms.toFixed(2).padStart(7)} ms`);
    }
    // Divisors, so a phase that GREW and one whose unit cost grew are told
    // apart: the same milliseconds over ten items and over a thousand are two
    // different findings.
    const counts = Object.entries(arrival?.counters ?? {})
        .filter(([k]) => k.startsWith('render.mesh.') || k === 'render.meshes');
    if (counts.length > 0) {
        console.log('\n    what it walked on that frame:');
        for (const [k, v] of counts) console.log(`      ${k.padEnd(30)}${String(v).padStart(7)}`);
    }
    const renderSystem = (arrival?.costs ?? []).find((c) => c.name === 'RenderSystem');
    if (renderSystem) {
        const js = rows.filter((r) => r.where === 'js' && r.system === 'RenderSystem'
            && r.frame === arrival).reduce((a, r) => a + r.ms, 0);
        console.log(`\n      RenderSystem on the arrival frame ${renderSystem.ms.toFixed(2)} ms,`
            + ` of which ${js.toFixed(2)} ms is named by JS scopes`
            + ` (${((js / renderSystem.ms) * 100).toFixed(0)}%)`);
    }
}

/** The variant keys a prewarm derived, as a set a reader can compare by eye. */
function keySet(r) {
    const keys = [];
    for (let i = 0; i < 32; i++) {
        if (r.keysLo & (1 << i)) keys.push(i);
        if (r.keysHi & (1 << i)) keys.push(i + 32);
    }
    return `{${keys.join(', ')}}`;
}

/** What one frame cost, by the domain that owns each system. */
function byDomain(frame) {
    return new Map(Object.entries(frame.domains ?? {}));
}

/** What this frame's systems cost in total — the attributed half of its wall time. */
function sumDomains(frame) {
    let total = 0;
    for (const ms of Object.values(frame.domains ?? {})) total += ms;
    return total;
}

main();
