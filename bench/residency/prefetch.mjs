#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bench/residency/prefetch.mjs — did the place get ready before it was wanted?
 *
 * The heavy-cell profile settled what an arrival COSTS and found nothing worth a
 * budget scheduler. That moved the question: what delivery claims now is not
 * that publication got cheaper but that fetching and decoding happen before the
 * player needs the place. So the number that decides whether it works is not a
 * duration at all — it is how often demand finds readiness already there.
 *
 * Two runs over the same corridor of identical cells, cold each time:
 *
 *   approach   a source walks in, so speculation has the lead time it was
 *              designed for           → demand should find the cell PREPARED
 *   teleport   a source appears in a cell it was never near
 *                                     → demand finds nothing, and pays the
 *                                       preparation itself
 *
 * and a third that is this bench's own falsifier: the same walk with prefetch
 * turned down to the load radius. If the approach row does not collapse into the
 * teleport row, the approach row was never measuring prefetch.
 *
 *   node bench/residency/prefetch.mjs
 *   node bench/residency/prefetch.mjs --props 60 --bodies 240   heavier cells
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runElectron } from '../../tools/lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = path.join(ROOT, '.golden', 'bench-prefetch');
const LAUNCHER = path.join(ROOT, 'tools', 'launchers', 'residency-run.mjs');
const SAMPLE = path.join(ROOT, 'examples', 'third-person-3d', 'assets', 'models');

const flag = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const CELL = 600;
const COLUMNS = 16;
const PROPS = Number(flag('props', '40'));
const BODIES = Number(flag('bodies', '160'));

/**
 * The radii every scenario runs at.
 *
 * `unload` is deliberately NOT below `prefetch`: a cell given up while still
 * inside the prefetch radius is speculated about again the moment it goes, and
 * the walk would be measuring its own churn.
 */
const LOAD = 200;
const PREFETCH = 1200;
const UNLOAD = 1300;
const SPEED = 600;

/** Where a teleporting source lands: cell centres far enough apart that the next
 *  one was never inside the prefetch radius of the last. */
const STOPS = [0, 3, 6, 9, 12, 15].map((c) => c * CELL + CELL / 2);

function project(dir) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(path.join(dir, 'assets', 'scenes'), { recursive: true });
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    // The sample's own imported products: a cell's preparation is only worth
    // hiding if it is decoding real meshes and materials.
    cpSync(SAMPLE, path.join(dir, 'assets', 'models'), { recursive: true });

    const entities = [];
    const transform = (x, y, z, s = 1) => ({
        type: 'Transform',
        data: { position: { x, y, z }, scale: { x: s, y: s, z: s } },
    });
    const solid = (h) => ([
        { type: 'RigidBody3D', data: { bodyType: 0 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: h, y: h, z: h }, friction: 0.6 } },
    ]);
    const push = (id, name, components, parent = null) =>
        entities.push({ id, name, parent, children: [], visible: true, components });

    push(0, 'World', [transform(0, 0, 0),
        { type: 'StreamedWorld', data: { cellSize: CELL } }]);
    push(1, 'Camera', [transform(0, 1200, 1800),
        { type: 'Camera', data: { projectionType: 0, fov: 55, nearPlane: 10, farPlane: 20000,
                                   isActive: true, priority: 0 } },
        { type: 'WorldPersistent', data: {} }]);
    push(2, 'Sun', [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 },
            rotation: { w: 0.834, x: -0.521, y: 0.182, z: 0 } } },
        { type: 'Light', data: { type: 1, intensity: 1.05, enabled: true,
                                  color: { r: 1, g: 0.96, b: 0.9, a: 1 } } },
        { type: 'WorldPersistent', data: {} }]);
    // Parked a whole prefetch radius short of the first cell, so the run begins
    // with nothing speculated about and the first arrival is a real one.
    push(3, 'Source', [transform(-(PREFETCH + 200), 60, CELL / 2),
        { type: 'WorldStreamingSource',
          data: { prefetchRadius: 0, loadRadius: 0, unloadRadius: 0, enabled: false } },
        { type: 'WorldPersistent', data: {} }]);

    const LEVELS = ['rock-lod0', 'rock-lod1', 'rock-lod2'];
    let id = 100;
    for (let cx = 0; cx < COLUMNS; cx++) {
        // Identical cell to cell, so "the same content arrived" is a fact about
        // the fixture and not a hope about the cook.
        for (let n = 0; n < PROPS; n++) {
            push(id++, `Rock_${cx}_${n}`, [
                transform(cx * CELL + 20 + (n % 8) * 22, 30, 20 + Math.floor(n / 8) * 22, 1),
                { type: 'MeshRenderer', data: { mesh: `assets/models/${LEVELS[n % 3]}.esmesh`,
                    lit: true, opaque: true, color: { r: 0.5, g: 0.5, b: 0.45, a: 1 } } },
                { type: 'LODGroup', data: { lod1: 'assets/models/rock-lod1.esmesh',
                    lod2: 'assets/models/rock-lod2.esmesh',
                    lod1Size: 0.25, lod2Size: 0.11, cullSize: 0.02, hysteresis: 0.1 } }]);
        }
        for (let n = 0; n < BODIES; n++) {
            push(id++, `Body_${cx}_${n}`, [
                transform(cx * CELL + 10 + (n % 20) * 9, 30, 300 + Math.floor(n / 20) * 9, 0.2),
                { type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: true, opaque: true,
                    cullBackfaces: true, color: { r: 0.6, g: 0.55, b: 0.45, a: 1 } } },
                ...solid(10)]);
        }
    }

    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene'),
        JSON.stringify({ version: 4, name: 'main', entities }, null, 1) + '\n');
    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene.meta'),
        JSON.stringify({ uuid: randomUUID(), version: '2.0', type: 'scene', importer: {} }) + '\n');
    writeFileSync(path.join(dir, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'Prefetch Bench', description: 'A corridor of identical cells.',
        tag: '3D', version: '0.1.0', defaultScene: 'assets/scenes/main.esscene',
        designResolution: { width: 640, height: 360 }, spineVersion: 'none',
    }, null, 2) + '\n');
    // The source moves itself, at a fixed step, because the driver may not: a
    // harness that placed the source would be choosing when demand arrives, and
    // that is the entire quantity under measurement.
    writeFileSync(path.join(dir, 'src', 'main.ts'), `
import { addSystemToSchedule, Schedule, defineSystem, GetWorld, Res, Input, Transform, WorldStreamingSource } from 'esengine';
import type { World, InputState } from 'esengine';

const STEP = ${SPEED} / 60;
const STOPS = ${JSON.stringify(STOPS)};
const DWELL = 90;

let mode: '' | 'walk' | 'teleport' = '';
let ran = 0;

const driveSystem = defineSystem(
    [Res(Input), GetWorld()],
    (input: InputState, world: World) => {
        const source = world.findEntityByName('Source');
        if (source === null) return;
        const begin = (next: 'walk' | 'teleport', prefetch: number) => {
            if (mode !== '') return;
            mode = next;
            ran = 0;
            world.update(source, WorldStreamingSource, (s) => {
                s.prefetchRadius = prefetch;
                s.loadRadius = ${LOAD};
                s.unloadRadius = ${UNLOAD};
                s.enabled = true;
            });
        };
        if (input.isKeyPressed('Digit1')) begin('walk', ${PREFETCH});
        if (input.isKeyPressed('Digit2')) begin('teleport', ${PREFETCH});
        // Speculation reaching no further than demand: the same walk with
        // nothing able to run ahead of it.
        if (input.isKeyPressed('Digit3')) begin('walk', ${LOAD});
        if (mode === 'walk') {
            world.update(source, Transform, (t) => { t.position.x += STEP; });
        } else if (mode === 'teleport') {
            const stop = STOPS[Math.min(Math.floor(ran / DWELL), STOPS.length - 1)];
            world.update(source, Transform, (t) => { t.position.x = stop; });
        }
        if (mode !== '') ran++;
    },
    { name: 'PrefetchDriveSystem' },
);
addSystemToSchedule(Schedule.Update, driveSystem);
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

/** Frames enough to walk the corridor's first seven cells, and to make every stop. */
const WALK_FRAMES = Math.ceil(((COLUMNS / 2) * CELL + PREFETCH + 200) / SPEED * 60);
const STOP_FRAMES = STOPS.length * 90 + 60;

function drive(dir, name, steps) {
    const script = path.join(WORK, `${name}.json`);
    writeFileSync(script, JSON.stringify(steps, null, 2));
    // A fresh Electron per scenario: the launcher clears the HTTP cache at boot,
    // so each run pays for its own fetching. Two scenarios in one process would
    // hand the second a warmed cache and call the difference prefetch.
    const run = runElectron([LAUNCHER, '--dir', dir, '--script', script, '--w', '640', '--h', '360'],
        { encoding: 'utf8', cwd: ROOT });
    for (const line of (run.stdout || '').split('\n')) {
        const at = line.indexOf('stream ');
        if (at < 0) continue;
        try { return JSON.parse(line.slice(line.indexOf('{', at))); } catch { /* partial line */ }
    }
    console.error(`✗ ${name}: nothing was measured — ${(run.stdout || run.stderr || '').slice(-600)}`);
    process.exit(2);
}

const percentile = (values, p) => {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const ms = (v) => (Number.isNaN(v) ? '—' : `${v.toFixed(1)}`);

/** The arrivals a scenario produced, one row per cell that was actually asked for. */
function arrivals(streaming) {
    const rows = [];
    for (const [cell, d] of Object.entries(streaming.delivery ?? {})) {
        if (d.outcome === '' || d.demandToResidentMs <= 0) continue;
        rows.push({
            cell,
            outcome: d.outcome,
            latency: d.demandToResidentMs,
            prepare: d.prepareMs,
            publish: d.publishMs,
            dwell: d.dwellMs,
            fetch: d.phases?.fetch ?? 0,
            assets: d.phases?.assets ?? 0,
            spawn: d.phases?.spawn ?? 0,
        });
    }
    // In corridor order, so the first (cold) arrival is visibly the first.
    return rows.sort((a, b) => Number(a.cell.match(/\d+/g).at(-2)) - Number(b.cell.match(/\d+/g).at(-2)));
}

function summarise(streaming) {
    const rows = arrivals(streaming);
    const latency = rows.map((r) => r.latency);
    const hits = rows.filter((r) => r.outcome === 'hit');
    const asked = streaming.prefetchHits + streaming.prefetchMisses;
    return {
        rows,
        requested: streaming.prefetchRequests,
        stillReady: streaming.preparedCells.length,
        hits: streaming.prefetchHits,
        misses: streaming.prefetchMisses,
        cancelled: streaming.cancelCount,
        hitRate: asked === 0 ? NaN : streaming.prefetchHits / asked,
        latency50: percentile(latency, 0.5),
        latency95: percentile(latency, 0.95),
        dwell50: percentile(hits.map((r) => r.dwell), 0.5),
        dwell95: percentile(hits.map((r) => r.dwell), 0.95),
        prepare: percentile(rows.map((r) => r.prepare), 0.5),
        publish: percentile(rows.map((r) => r.publish), 0.5),
        fetch: percentile(rows.map((r) => r.fetch), 0.5),
        assets: percentile(rows.map((r) => r.assets), 0.5),
        spawn: percentile(rows.map((r) => r.spawn), 0.5),
    };
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
        console.error(`✗ the corridor did not package:\n${(built.stderr || built.stdout || '').slice(-900)}`);
        process.exit(2);
    }

    const scenarios = [
        ['approach', { do: 'stream', as: 'approach', key: 'Digit1', count: WALK_FRAMES }],
        ['teleport', { do: 'stream', as: 'teleport', key: 'Digit2', count: STOP_FRAMES }],
        ['no-prefetch', { do: 'stream', as: 'noPrefetch', key: 'Digit3', count: WALK_FRAMES }],
    ];
    const measured = new Map();
    for (const [name, step] of scenarios) {
        measured.set(name, summarise(drive(out, name, [{ do: 'step', frames: 30 }, step])));
    }

    console.log(`\nprefetch effectiveness — ${COLUMNS} identical cells, `
        + `${PROPS} imported props + ${BODIES} bodies each, cell ${CELL} wu`);
    console.log(`  load ${LOAD} / prefetch ${PREFETCH} / unload ${UNLOAD} wu, walking ${SPEED} wu/s\n`);

    console.log('  scenario       requested  hits  misses  cancelled  still ready  hit rate');
    for (const [name, s] of measured) {
        console.log(`  ${name.padEnd(13)}  ${String(s.requested).padStart(9)}`
            + `  ${String(s.hits).padStart(4)}  ${String(s.misses).padStart(6)}`
            + `  ${String(s.cancelled).padStart(9)}  ${String(s.stillReady).padStart(11)}`
            + `  ${(Number.isNaN(s.hitRate) ? '—' : `${(s.hitRate * 100).toFixed(0)}%`).padStart(8)}`);
    }
    console.log('  (a speculation is requested once, then hit, cancelled, or still waiting.)');

    console.log(`\n  what the player waits through, milliseconds`
        + ` (dwell is wall time; the designed lead is`
        + ` ${((PREFETCH - LOAD) / SPEED).toFixed(2)} s of walking):`);
    console.log('  scenario       arrivals  loadRadius→resident      prepared dwell     preparation  publication');
    console.log('                             p50     p95            p50      p95      (median)     (median)');
    for (const [name, s] of measured) {
        console.log(`  ${name.padEnd(13)}  ${String(s.rows.length).padStart(8)}`
            + `  ${ms(s.latency50).padStart(9)} ${ms(s.latency95).padStart(7)}`
            + `      ${ms(s.dwell50).padStart(9)} ${ms(s.dwell95).padStart(7)}`
            + `  ${ms(s.prepare).padStart(11)}  ${ms(s.publish).padStart(11)}`);
    }

    console.log('\n  and where a preparation goes (median): '
        + [...measured].map(([name, s]) =>
            `${name} fetch ${ms(s.fetch)} + assets ${ms(s.assets)} → spawn ${ms(s.spawn)}`).join('\n'
            + '                                         '));

    console.log('\n  every arrival, in corridor order:');
    for (const [name, s] of measured) {
        console.log(`    ${name}`);
        for (const r of s.rows) {
            console.log(`      ${r.cell.padEnd(12)} ${r.outcome.padEnd(5)}`
                + ` demand→resident ${ms(r.latency).padStart(6)}`
                + `  prepare ${ms(r.prepare).padStart(6)}  publish ${ms(r.publish).padStart(6)}`
                + `  dwell ${ms(r.dwell).padStart(7)}`);
        }
    }

    // The corridor's cells share their rock meshes, so only the first one of a
    // cold run pays a real `assets` phase — which makes this row the one place
    // a whole preparation is on show.
    const cold = (name) => measured.get(name).rows.find((r) => r.cell.endsWith('cell_0_0'));
    console.log('\n  the one cold cell each run pays for — same content, same fetch, same assets:');
    for (const name of ['approach', 'teleport', 'no-prefetch']) {
        const r = cold(name);
        if (!r) continue;
        console.log(`    ${name.padEnd(13)} preparation ${ms(r.prepare).padStart(6)} ms`
            + ` ${r.outcome === 'hit' ? 'hidden behind a dwell of ' + ms(r.dwell) + ' ms' : 'paid at the door'}`
            + ` → the player waited ${ms(r.latency)} ms`);
    }

    const approach = measured.get('approach');
    const teleport = measured.get('teleport');
    const sabotage = measured.get('no-prefetch');
    const checks = [
        [approach.hits > 0 && approach.hitRate >= 0.8,
            'walking in finds the place already prepared',
            `${approach.hits}/${approach.hits + approach.misses} arrivals hit`],
        [teleport.misses > 0 && teleport.hits === 0,
            'appearing in a place nobody was near finds nothing ready',
            `${teleport.misses} miss(es), ${teleport.hits} hit(s)`],
        [approach.latency50 < teleport.latency50,
            'and a hit is the shorter wait of the two',
            `${ms(approach.latency50)} ms vs ${ms(teleport.latency50)} ms at p50`],
        [approach.latency50 <= approach.publish * 1.6 + 1,
            'a hit costs about what publishing costs, and no preparation',
            `${ms(approach.latency50)} ms against ${ms(approach.publish)} ms of publication`],
        [teleport.latency50 >= teleport.prepare + teleport.publish * 0.8,
            'a miss carries the preparation into the wait',
            `${ms(teleport.latency50)} ms against ${ms(teleport.prepare)} + ${ms(teleport.publish)} ms`],
        [sabotage.hits === 0,
            'and with speculation reaching no further than demand, the same walk hits nothing',
            `${sabotage.hits} hit(s), ${sabotage.misses} miss(es)`],
    ];
    console.log('');
    let failed = 0;
    for (const [ok, claim, detail] of checks) {
        if (!ok) failed++;
        console.log(`  ${ok ? '✓' : '✗'} ${claim}${detail ? ` — ${detail}` : ''}`);
    }
    console.log('');
    process.exit(failed === 0 ? 0 : 1);
}

main();
