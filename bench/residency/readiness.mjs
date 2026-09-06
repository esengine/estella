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
        // Prefetching now READIES the cell — preparation owes a claim — so the
        // compile is already paid before either pass runs. What these two judge
        // is whether document and entities agree about WHAT was needed.
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

const digestOf = (r) => `${r.digestHi.toString(16)}${r.digestLo.toString(16).padStart(8, '0')}`;

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

    const runs = new Map();
    for (const [name, options] of [['plain', {}],
                                   ['shadow', { shadows: true }],
                                   ['material', { material: true }]]) {
        const r = drive(name, options);
        runs.set(name, r);
        const doc = r.get('document');
        const live = r.get('entities');
        const liveKeys = keySet(live);
        console.log(`  ${name}: document ${digestOf(doc)} in ${doc.ms.toFixed(2)} ms`
            + ` (${doc.compiles} compile(s), ${doc.materialAsks} material ask(s));`
            + ` entities {${liveKeys.join(', ')}} ${digestOf(live)} in ${live.ms.toFixed(2)} ms`
            + ` (${live.compiles} compile(s), ${live.materialAsks} material ask(s))`);
        // The digest, not the key set: production returns no keys — naming the
        // variants is the oracle's job — and the digest is the stronger claim
        // anyway, covering material programs the key set is silent about.
        check(doc.digestLo === live.digestLo && doc.digestHi === live.digestHi,
            `${name}: what the prepared cell knows equals what its entities ask for`,
            `${digestOf(doc)} against ${digestOf(live)}`);
        check(doc.claimValid === 1,
            `${name}: and the readying produced a claim — nothing moved underneath it`,
            `claimValid=${doc.claimValid}`);
        // Non-vacuous through the digests above: a derivation producing nothing
        // would not match the entity side, which reads a live world and cannot
        // be empty.
        check(doc.compiles === 0 && live.compiles === 0,
            `${name}: preparation already paid, so neither pass has anything to build`,
            `${doc.compiles} then ${live.compiles} compile(s)`);
        check(doc.programEpoch === live.programEpoch,
            `${name}: and both were taken under the same program epoch`,
            `${doc.programEpoch} against ${live.programEpoch}`);
        // The guard, not a third truth: had the device been rebuilt between the
        // two derivations, neither reading would describe the live one.
        check(doc.deviceGeneration === live.deviceGeneration,
            `${name}: on one device generation, so neither reading is stale`,
            `${doc.deviceGeneration} against ${live.deviceGeneration}`);
        if (name === 'plain') {
            // nothing fixture-specific: this one exists to be compared against.
        } else if (name === 'shadow') {
            check(liveKeys.some((k) => (k & 16) !== 0),
                'shadow: the depth-pass variant is a requirement, not a possibility',
                `keys {${liveKeys.join(', ')}} — bit 16 is depthOnly`);
        } else {
            check(doc.materialAsks > 0 && doc.materialAsks === live.materialAsks,
                'material: the material-owned path is enumerated, and the same both ways',
                `${doc.materialAsks} against ${live.materialAsks} ask(s)`);
            check(live.materialCompiles === 0,
                'material: and its programs were built before either pass ran',
                `${live.materialCompiles} late material compile(s)`);
        }
    }
    // The claim `keys` alone cannot make: same geometry, same stock variants, one
    // shaded by a material. A digest blind to that path would call the two
    // worlds identical and let a stamp from one vouch for the other.
    // Read off the ORACLE side, which is the one that reports keys; the equality
    // above has already tied each document's digest to its entities'.
    const plain = runs.get('plain').get('entities');
    const shaded = runs.get('material').get('entities');
    console.log('');
    check(plain.keysLo === shaded.keysLo && plain.keysHi === shaded.keysHi,
        'the plain and material worlds need the SAME stock variants',
        `{${keySet(plain).join(', ')}} against {${keySet(shaded).join(', ')}}`);
    check(plain.materialAsks === 0 && shaded.materialAsks > 0,
        'and differ only in the material-owned path',
        `${plain.materialAsks} against ${shaded.materialAsks} ask(s)`);
    check(plain.digestLo !== shaded.digestLo || plain.digestHi !== shaded.digestHi,
        'so the digest must tell them apart — the stock key set cannot',
        `${plain.digestHi.toString(16)}${plain.digestLo.toString(16)}`
        + ` against ${shaded.digestHi.toString(16)}${shaded.digestLo.toString(16)}`);

    console.log('');
    process.exit(failed === 0 ? 0 : 1);
}

main();
