#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bench/residency/readiness.mjs — does a prepared cell know what it needs?
 *
 * `heavy.mjs` proved the equivalence on the content it happens to carry, which
 * has no shadow caster and no material — so two of the six facts a program key
 * is made of never took part. These are the two fixtures that make them, and
 * they are deliberately tiny: what is being guarded is a CONTRACT, not a cost,
 * and three renderables answer it as well as two hundred.
 *
 *   node bench/residency/readiness.mjs        (needs ESTELLA_TEST_PROBES=1 wasm)
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runElectron } from '../../tools/lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = path.join(ROOT, '.golden', 'bench-readiness');
const LAUNCHER = path.join(ROOT, 'tools', 'launchers', 'residency-run.mjs');
const SAMPLE = path.join(ROOT, 'examples', 'third-person-3d', 'assets', 'models');
const CELL = 600;
const CELL_NAME = 'main.cell_1_0';

const transform = (x, y, z) => ({ type: 'Transform', data: { position: { x, y, z } } });

/** One streamed world with a handful of renderables in its single cell. */
function project(dir, { shadows, material }) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(path.join(dir, 'assets', 'scenes'), { recursive: true });
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    cpSync(SAMPLE, path.join(dir, 'assets', 'models'), { recursive: true });

    if (material) {
        mkdirSync(path.join(dir, 'assets', 'materials'), { recursive: true });
        writeFileSync(path.join(dir, 'assets', 'materials', 'stone.esmaterial'),
            JSON.stringify({ version: '1.0', type: 'material', shader: 'builtin:model',
                             blendMode: 9, depthTest: true, depthWrite: true, cull: 1,
                             properties: { u_metallic: 0.2, u_roughness: 0.7 } }, null, 2) + '\n');
        writeFileSync(path.join(dir, 'assets', 'materials', 'stone.esmaterial.meta'),
            JSON.stringify({ uuid: randomUUID(), version: '2.0', type: 'material', importer: {} }) + '\n');
    }

    const entities = [];
    const push = (id, name, components) =>
        entities.push({ id, name, parent: null, children: [], visible: true, components });

    push(0, 'World', [transform(0, 0, 0), { type: 'StreamedWorld', data: { cellSize: CELL } }]);
    push(1, 'Camera', [transform(900, 400, 1400),
        { type: 'Camera', data: { projectionType: 0, fov: 55, nearPlane: 10, farPlane: 8000,
                                   isActive: true, priority: 0 } },
        { type: 'WorldPersistent', data: {} }]);
    // `meshShadows` is what puts a caster in the frame's plan, and a plan is what
    // makes the depth variant a requirement rather than a possibility.
    push(2, 'Sun', [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 },
            rotation: { w: 0.834, x: -0.521, y: 0.182, z: 0 } } },
        { type: 'Light', data: { type: 1, intensity: 1.05, enabled: true,
                                  meshShadows: !!shadows, shadowDistance: shadows ? 4000 : 0,
                                  color: { r: 1, g: 0.96, b: 0.9, a: 1 } } },
        { type: 'WorldPersistent', data: {} }]);
    push(3, 'Source', [transform(-4000, 60, 300),
        { type: 'WorldStreamingSource',
          data: { loadRadius: 0, prefetchRadius: 0, unloadRadius: 0, enabled: false } },
        { type: 'WorldPersistent', data: {} }]);

    for (let n = 0; n < 3; n++) {
        push(100 + n, `Rock${n}`, [transform(700 + n * 60, 30, 300),
            { type: 'MeshRenderer', data: {
                mesh: 'assets/models/rock-lod0.esmesh', lit: true, opaque: true,
                ...(material ? { material: 'assets/materials/stone.esmaterial' } : {}),
                color: { r: 0.5, g: 0.5, b: 0.45, a: 1 } } }]);
    }

    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene'),
        JSON.stringify({ version: 4, name: 'main', entities }, null, 1) + '\n');
    writeFileSync(path.join(dir, 'assets', 'scenes', 'main.esscene.meta'),
        JSON.stringify({ uuid: randomUUID(), version: '2.0', type: 'scene', importer: {} }) + '\n');
    writeFileSync(path.join(dir, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'Readiness', description: 'Two facts the heavy cell never uses.',
        tag: '3D', version: '0.1.0', defaultScene: 'assets/scenes/main.esscene',
        designResolution: { width: 640, height: 360 }, spineVersion: 'none',
    }, null, 2) + '\n');
    writeFileSync(path.join(dir, 'src', 'main.ts'), `
import { addSystemToSchedule, Schedule, defineSystem, GetWorld, Res, Input, WorldStreamingSource } from 'esengine';
import type { World, InputState } from 'esengine';

let ready = false;
let want = false;
addSystemToSchedule(Schedule.Update, defineSystem(
    [Res(Input), GetWorld()],
    (input: InputState, world: World) => {
        if (input.isKeyPressed('Digit2')) ready = true;
        if (input.isKeyPressed('Digit1')) want = true;
        if (!ready && !want) return;
        const source = world.findEntityByName('Source');
        if (source === null) return;
        world.update(source, WorldStreamingSource, (s) => {
            s.loadRadius = want ? 6000 : 0;
            s.prefetchRadius = 6000;
            s.unloadRadius = 6200;
            s.enabled = true;
        });
    },
    { name: 'DemandSystem' },
));
`);
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler',
            strict: true, esModuleInterop: true, skipLibCheck: true, noEmit: true,
            paths: { esengine: ['./.esengine/sdk/index.d.ts'] } },
        include: ['src/**/*'],
    }, null, 2) + '\n');
    return dir;
}

function drive(name, options) {
    const src = project(path.join(WORK, name), options);
    const out = path.join(WORK, `${name}-web`);
    const built = spawnSync(process.execPath, [path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'),
        'export', src, '--platform', 'web', '--out', out], { encoding: 'utf8', cwd: ROOT });
    if (built.status !== 0) {
        console.error(`✗ ${name}: did not package:\n${(built.stderr || built.stdout || '').slice(-700)}`);
        process.exit(2);
    }
    const script = path.join(WORK, `${name}.json`);
    writeFileSync(script, JSON.stringify([
        { do: 'step', frames: 30 },
        // Readied but NOT published, so the document pass asks first. After
        // publication the first collect has already built everything, and
        // "nothing left to compile" is true of any two warm calls.
        { do: 'arrive', as: 'primed', key: 'Digit2' },
        { do: 'prewarm', as: 'document', cell: CELL_NAME, from: 'document' },
        { do: 'arrive', as: 'published', key: 'Digit1' },
        { do: 'prewarm', as: 'entities', cell: CELL_NAME },
    ], null, 2));
    const run = runElectron([LAUNCHER, '--dir', out, '--script', script, '--w', '640', '--h', '360'],
        { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    const readings = new Map();
    for (const line of (run.stdout || '').split('\n')) {
        const m = /^prewarm ([^:]+): (.*)$/.exec(line);
        if (m) { try { readings.set(m[1], JSON.parse(m[2])); } catch { /* partial */ } }
    }
    if (readings.size < 2) {
        console.error(`✗ ${name}: nothing was measured — ${(run.stdout || run.stderr || '').slice(-700)}`);
        process.exit(2);
    }
    return readings;
}

const keySet = (r) => {
    const keys = [];
    for (let i = 0; i < 32; i++) {
        if (r.keysLo & (1 << i)) keys.push(i);
        if (r.keysHi & (1 << i)) keys.push(i + 32);
    }
    return keys;
};

function main() {
    if (!existsSync(SAMPLE)) {
        console.error(`✗ the sample's imported assets are not here: ${SAMPLE}`);
        process.exit(2);
    }
    rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(WORK, { recursive: true });

    let failed = 0;
    const check = (ok, claim, detail) => {
        if (!ok) failed++;
        console.log(`  ${ok ? '✓' : '✗'} ${claim}${detail ? ` — ${detail}` : ''}`);
    };

    console.log('\nreadiness coverage — the two facts the heavy cell never exercises\n');

    for (const [name, options] of [['shadow', { shadows: true }],
                                   ['material', { material: true }]]) {
        const r = drive(name, options);
        const doc = r.get('document');
        const live = r.get('entities');
        const docKeys = keySet(doc);
        const liveKeys = keySet(live);
        console.log(`  ${name}: document {${docKeys.join(', ')}} in ${doc.ms.toFixed(2)} ms`
            + ` (${doc.compiles} compile(s), ${doc.materialAsks} material ask(s));`
            + ` entities {${liveKeys.join(', ')}} in ${live.ms.toFixed(2)} ms`
            + ` (${live.compiles} compile(s), ${live.materialAsks} material ask(s))`);
        check(doc.keysLo === live.keysLo && doc.keysHi === live.keysHi,
            `${name}: what the prepared cell knows equals what its entities ask for`,
            `{${docKeys.join(', ')}} against {${liveKeys.join(', ')}}`);
        // The entity pass runs second, so what it still builds is what the
        // document did not know about — and this is non-vacuous only if the
        // document pass built something at all.
        check(doc.compiles > 0,
            `${name}: the document pass is the one that pays, so this is a real test`,
            `${doc.compiles} compile(s) from the document`);
        check(live.compiles === 0,
            `${name}: and readying from the document left nothing for them to compile`,
            `${live.compiles} late compile(s)`);
        if (name === 'shadow') {
            check(docKeys.some((k) => (k & 16) !== 0),
                'shadow: the depth-pass variant is a requirement, not a possibility',
                `keys {${docKeys.join(', ')}} — bit 16 is depthOnly`);
        } else {
            check(doc.materialAsks > 0 && doc.materialAsks === live.materialAsks,
                'material: the material-owned path is enumerated, and the same both ways',
                `${doc.materialAsks} against ${live.materialAsks} ask(s)`);
            check(live.materialCompiles === 0,
                'material: and its programs were built by the document pass',
                `${live.materialCompiles} late material compile(s)`);
        }
    }
    console.log('');
    process.exit(failed === 0 ? 0 : 1);
}

main();
