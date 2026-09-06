#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bench/residency/run.mjs — what a streamed world costs to hold.
 *
 * Generates a 10x10 world of cells, packages it, and drives the real thing:
 * cells arrive over the network into the same scene lifecycle a game uses, so
 * every number here includes what a player would actually wait through.
 *
 * Three residencies from one source, chosen by radius: its own cell, its 3x3
 * neighbourhood, its 5x5. And the scan itself, isolated — the same world cut
 * into 100 cells and into 4, with NOTHING resident in either, so the difference
 * over 96 cells is the per-frame cost of deciding.
 *
 *   node bench/residency/run.mjs
 *   node bench/residency/run.mjs --props 40    denser cells
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runElectron } from '../../tools/lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = path.join(ROOT, '.golden', 'bench-residency');
const LAUNCHER = path.join(ROOT, 'tools', 'launchers', 'residency-run.mjs');

const flag = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const CELL = 600;
const PROPS = Number(flag('props', '20'));
const FRAMES = Number(flag('frames', '300'));

/**
 * Radii that select exactly 1, 9 and 25 cells for a source standing at a cell's
 * centre. The gaps are wide: a 3x3 needs to reach a diagonal box corner at 424
 * and must not reach the next ring at 900.
 */
const LEVELS = [
    { key: 'Digit1', cells: 1, radius: 100 },
    { key: 'Digit2', cells: 9, radius: 500 },
    { key: 'Digit3', cells: 25, radius: 1300 },
];

function project(dir, columns) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.join(dir, 'assets', 'scenes'), { recursive: true });
    mkdirSync(path.join(dir, 'src'), { recursive: true });

    const entities = [];
    const transform = (x, y, z, s = 1) => ({
        type: 'Transform',
        data: { position: { x, y, z }, scale: { x: s, y: s, z: s } },
    });
    const box = (r, g, b) => ({
        type: 'MeshRenderer',
        data: { mesh: 'builtin:cube', lit: true, opaque: true, cullBackfaces: true,
                color: { r, g, b, a: 1 } },
    });
    // Props collide, so what a cell costs to instantiate includes the bodies it
    // hands to the physics world — the half a renderer count cannot show.
    const solid = () => ([
        { type: 'RigidBody3D', data: { bodyType: 0 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: 25, y: 25, z: 25 }, friction: 0.6 } },
    ]);
    const push = (id, name, components, parent = null) =>
        entities.push({ id, name, parent, children: [], visible: true, components });

    // The source stands at the centre of the middle cell, so every radius below
    // measures from one place.
    const middle = Math.floor(columns / 2);
    push(0, 'World', [transform(0, 0, 0),
        { type: 'StreamedWorld', data: { cellSize: CELL, enabled: true } }]);
    push(1, 'Camera', [transform(middle * CELL + 300, 900, middle * CELL + 1200),
        { type: 'Camera', data: { projectionType: 0, fov: 55, nearPlane: 10, farPlane: 20000,
                                   isActive: true, priority: 0 } },
        { type: 'WorldPersistent', data: {} }]);
    push(2, 'Sun', [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 },
            rotation: { w: 0.834, x: -0.521, y: 0.182, z: 0 } } },
        { type: 'Light', data: { type: 1, intensity: 1.05, enabled: true,
                                  color: { r: 1, g: 0.96, b: 0.9, a: 1 } } },
        { type: 'WorldPersistent', data: {} }]);
    push(3, 'Source', [transform(middle * CELL + 300, 60, middle * CELL + 300),
        { type: 'WorldStreamingSource', data: { loadRadius: 0, unloadRadius: 0, enabled: false } },
        { type: 'WorldPersistent', data: {} }]);

    let id = 100;
    for (let cx = 0; cx < columns; cx++) {
        for (let cz = 0; cz < columns; cz++) {
            for (let n = 0; n < PROPS; n++) {
                const x = cx * CELL + 40 + (n % 5) * 120;
                const z = cz * CELL + 40 + Math.floor(n / 5) * 120;
                push(id++, `P_${cx}_${cz}_${n}`,
                    [transform(x, 30, z, 0.5), box(0.6, 0.55, 0.45), ...solid()]);
            }
        }
    }

    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene'),
        JSON.stringify({ version: 4, name: 'main', entities }, null, 1) + '\n');
    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene.meta'),
        JSON.stringify({ uuid: randomUUID(), version: '2.0', type: 'scene', importer: {} }) + '\n');
    writeFileSync(path.join(dir, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'Residency Bench', description: 'A generated world of cells.',
        tag: '3D', version: '0.1.0', defaultScene: 'assets/scenes/main.esscene',
        designResolution: { width: 640, height: 360 }, spineVersion: 'none',
    }, null, 2) + '\n');
    // The radius is the knob, and only the game may turn it: a driver that could
    // set residency directly would be measuring itself.
    writeFileSync(path.join(dir, 'src', 'main.ts'), `
import { addSystemToSchedule, Schedule, defineSystem, GetWorld, Res, Input, WorldStreamingSource } from 'esengine';
import type { World, InputState } from 'esengine';

const RADII: Record<string, number> = ${JSON.stringify(
        Object.fromEntries([['Digit0', 0], ...LEVELS.map((l) => [l.key, l.radius])]))};

const radiusSystem = defineSystem(
    [Res(Input), GetWorld()],
    (input: InputState, world: World) => {
        for (const key of Object.keys(RADII)) {
            if (!input.isKeyPressed(key)) continue;
            const source = world.findEntityByName('Source');
            if (source === null) continue;
            world.update(source, WorldStreamingSource, (s) => {
                s.loadRadius = RADII[key];
                s.unloadRadius = RADII[key] * 1.05;
                s.enabled = RADII[key] > 0;
            });
        }
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

function packageProject(dir, out) {
    const r = spawnSync(process.execPath, [
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', dir,
        '--platform', 'web', '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    if (r.status !== 0) {
        console.error(`✗ the bench world did not package:\n${(r.stderr || r.stdout || '').slice(-800)}`);
        process.exit(1);
    }
    return out;
}

function drive(dir, name, steps) {
    const script = path.join(WORK, `${name}.json`);
    writeFileSync(script, JSON.stringify(steps, null, 2));
    const r = runElectron([LAUNCHER, '--dir', dir, '--script', script, '--w', '640', '--h', '360'],
        { encoding: 'utf8', cwd: ROOT });
    const out = {};
    for (const line of (r.stdout || '').split('\n')) {
        const at = Math.max(line.indexOf('timing '), line.indexOf('reading '));
        if (at < 0) continue;
        const label = line.slice(line.indexOf(' ', at) + 1, line.indexOf(':', at));
        try { out[label] = JSON.parse(line.slice(line.indexOf('{', at))); } catch { /* partial line */ }
    }
    if (Object.keys(out).length === 0) {
        console.error(`✗ ${name}: nothing was measured — ${(r.stdout || r.stderr || '').slice(-400)}`);
        process.exit(1);
    }
    return out;
}

const ms = (v) => `${v.toFixed(2)} ms`;

function main() {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });

    const wide = packageProject(project(path.join(WORK, 'src-100'), 10), path.join(WORK, 'web-100'));
    const narrow = packageProject(project(path.join(WORK, 'src-4'), 2), path.join(WORK, 'web-4'));

    const steps = [{ do: 'step', frames: 30 }, { do: 'time', as: 'idle', frames: FRAMES }];
    for (const level of LEVELS) {
        steps.push({ do: 'arrive', as: `arrive${level.cells}`, key: level.key });
        steps.push({ do: 'time', as: `hold${level.cells}`, frames: FRAMES });
        steps.push({ do: 'arrive', as: `leave${level.cells}`, key: 'Digit0' });
    }
    const held = drive(wide, 'held', steps);
    const scan = drive(narrow, 'scan', [{ do: 'step', frames: 30 },
        { do: 'time', as: 'idle', frames: FRAMES }]);

    console.log(`\nresidency — ${100} cells authored, ${PROPS} props each, cell ${CELL} wu\n`);
    console.log('  level   cells  entities  renderers  bodies  refs   hold/frame   arrive   leave');
    for (const level of LEVELS) {
        const hold = held[`hold${level.cells}`];
        const s = hold.streaming;
        const entities = Object.values(s.cellEntityCounts).reduce((a, b) => a + b, 0);
        const renderers = Object.values(s.cellRenderCounts).reduce((a, b) => a + b, 0);
        const refs = Object.values(s.assetRefsByCell).reduce((a, b) => a + b, 0);
        console.log(`  ${String(level.cells).padStart(5)}   ${String(s.residentCells.length).padStart(5)}`
            + `  ${String(entities).padStart(8)}  ${String(renderers).padStart(9)}`
            + `  ${String(s.physicsBodies).padStart(6)}  ${String(refs).padStart(4)}`
            + `  ${ms(hold.msPerFrame).padStart(11)}`
            + `  ${ms(held[`arrive${level.cells}`].ms).padStart(7)}`
            + `  ${ms(held[`leave${level.cells}`].ms).padStart(6)}`);
    }
    // Nothing resident in either, so what differs is 96 cells' worth of deciding.
    const wideIdle = held.idle.msPerFrame;
    const narrowIdle = scan.idle.msPerFrame;
    const perCell = (wideIdle - narrowIdle) / 96 * 1000;
    console.log(`\n  deciding: ${ms(wideIdle)}/frame over 100 cells vs ${ms(narrowIdle)} over 4`);
    // A difference at or below zero is the measurement's floor, not a saving —
    // saying "-0.2 µs" would be reporting noise as a result.
    console.log(perCell > 0.5
        ? `  → ${perCell.toFixed(1)} µs per 100 cells scanned\n`
        : `  → the scan over 96 more cells is below what this can measure`
          + ` (the two differ by ${((wideIdle - narrowIdle) * 1000).toFixed(1)} µs a frame)\n`);
}

main();
