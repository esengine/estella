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
import { rmSync, mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
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
import { addSystemToSchedule, Schedule, defineSystem, GetWorld, Res, Input, WorldStreamingSource } from 'esengine';
import type { World, InputState } from 'esengine';

const radiusSystem = defineSystem(
    [Res(Input), GetWorld()],
    (input: InputState, world: World) => {
        const on = input.isKeyPressed('Digit1');
        if (!on && !input.isKeyPressed('Digit0')) return;
        const source = world.findEntityByName('Source');
        if (source === null) return;
        world.update(source, WorldStreamingSource, (s) => {
            s.loadRadius = on ? 3000 : 0;
            s.unloadRadius = on ? 3200 : 0;
            s.enabled = on;
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

    const script = path.join(WORK, 'probe.json');
    writeFileSync(script, JSON.stringify([
        { do: 'step', frames: 30 },
        // One frame at a time from the gesture, so the arrival is a row and not
        // an average, with a system breakdown wherever a frame is expensive.
        { do: 'frames', as: 'arrival', key: 'Digit1', count: 240, costsAbove: 1.0 },
    ], null, 2));
    const run = runElectron([LAUNCHER, '--dir', out, '--script', script, '--w', '640', '--h', '360'],
        { encoding: 'utf8', cwd: ROOT });

    const readings = {};
    for (const line of (run.stdout || '').split('\n')) {
        const at = Math.max(line.indexOf('profile '), line.indexOf('delivery '));
        if (at < 0) continue;
        const kind = line.slice(at, line.indexOf(' ', at));
        try { readings[kind] = JSON.parse(line.slice(line.indexOf(line.includes('profile') && kind === 'profile' ? '[' : '{', at))); } catch { /* partial */ }
    }
    const frames = readings.profile;
    const delivery = readings.delivery;
    if (!frames) {
        console.error(`✗ nothing was measured — ${(run.stdout || run.stderr || '').slice(-500)}`);
        process.exit(1);
    }

    const heavy = frames.filter((f) => f.ms > 1.0);
    const arrival = frames.find((f, i) => i > 0 && frames[i - 1].resident === 0 && f.resident > 0);
    console.log(`\nheavy cell — 1 skin, ${PROPS} imported props, ${BODIES} bodies\n`);
    console.log('  preparation (between frames, no system timer holds it):');
    for (const [cell, v] of Object.entries(delivery ?? {})) {
        for (const [phase, ms] of Object.entries(v.phases).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${phase.padEnd(8)} ${ms.toFixed(2).padStart(8)} ms`);
        }
        console.log(`    ${'delivery'.padEnd(8)} ${v.deliveryMs.toFixed(2).padStart(8)} ms  (issue → resident, ${cell})`);
    }
    console.log('\n  the frames it cost, by system:');
    for (const f of heavy.slice(0, 12)) {
        const at = frames.indexOf(f);
        const top = (f.costs ?? []).slice(0, 4).map((c) => `${c.name} ${c.ms.toFixed(2)}`).join(', ');
        console.log(`    f${String(at).padEnd(4)} ${f.ms.toFixed(2).padStart(6)} ms  ent=${f.entities} bodies=${f.bodies}${top ? `  | ${top}` : ''}`);
    }
    const worst = Math.max(...frames.map((f) => f.ms));
    const spawn = Object.values(delivery ?? {})[0]?.phases?.spawn ?? 0;
    console.log(`\n  largest single frame ${worst.toFixed(1)} ms; largest atomic preparation phase `
        + `${Math.max(spawn, ...Object.values(Object.values(delivery ?? {})[0]?.phases ?? { a: 0 })).toFixed(1)} ms`);
    console.log(`  arrival landed on frame ${arrival ? frames.indexOf(arrival) : '(none)'}\n`);
}

main();
