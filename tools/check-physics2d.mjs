// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-physics2d.mjs — the 2D physics module does what a world should.
 *
 * Three smokes sat in sdk/tests with nothing to schedule them: the character
 * mover (resting height, skin width, floor snap, ceiling), the joint and mouse
 * features, and sensor overlap. They pass — which is the point. Nothing was
 * checking, so the day they stop passing would have been a day nobody noticed.
 *
 * The last check here is on the SET: a smoke this file does not name, and no
 * other gate runs, fails — the hole this gate exists to close cannot reopen by
 * someone adding a fourth file.
 *
 *   node tools/check-physics2d.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = path.join(ROOT, 'sdk', 'tests');
const WASM = path.join(ROOT, 'build', 'wasm', 'web', 'physics.wasm');

/** The smokes this gate schedules, and the module each needs. */
const SMOKES = ['mover-smoke.mjs', 'physics-features-smoke.mjs', 'sensor-smoke.mjs'];

// Every smoke has to be scheduled by SOMEONE. Others run elsewhere (the 3D one
// is check-physics3d's), so a file is only orphaned when no gate names it.
const gateText = readdirSync(path.join(ROOT, 'tools'))
    .filter((f) => f.startsWith('check-') && f.endsWith('.mjs') && f !== 'check-physics2d.mjs')
    .map((f) => readFileSync(path.join(ROOT, 'tools', f), 'utf8'))
    .join('\n');
const orphans = readdirSync(TESTS)
    .filter((f) => f.endsWith('-smoke.mjs'))
    .filter((f) => !SMOKES.includes(f) && !gateText.includes(f));
if (orphans.length > 0) {
    console.error('Smoke tests nothing schedules:\n');
    for (const o of orphans) console.error(`  sdk/tests/${o}`);
    console.error('\nAdd it to SMOKES here, or to the gate that owns its module. A smoke'
        + ' nobody runs passes until the day it matters.');
    process.exit(1);
}

// An unbuilt module is not a failed behaviour. The job that HAS the binary sets
// ESTELLA_REQUIRE_WASM, so a build that stops arriving there fails rather than
// skipping quietly.
if (!existsSync(WASM)) {
    if (process.env.ESTELLA_REQUIRE_WASM) {
        console.error('check-physics2d: ESTELLA_REQUIRE_WASM is set but build/wasm/web/physics.wasm is absent.\n');
        console.error('  node build-tools/cli.js build -t physics');
        process.exit(1);
    }
    console.log('check-physics2d: build/wasm/web/physics.wasm is not built — skipped'
        + ' (build it with `node build-tools/cli.js build -t physics`; CI sets ESTELLA_REQUIRE_WASM).');
    process.exit(0);
}

let total = 0;
for (const smoke of SMOKES) {
    const run = spawnSync(process.execPath, [path.join(TESTS, smoke)], { cwd: ROOT, encoding: 'utf8' });
    if (run.status !== 0) {
        console.error(run.stdout ?? '');
        console.error(run.stderr ?? '');
        console.error(`\ncheck-physics2d: ${smoke} — the 2D world did not behave as it says.`);
        process.exit(1);
    }
    total += (run.stdout.match(/^PASS/gm) ?? []).length;
}

console.log(`check-physics2d: ${total} behaviour(s) hold across ${SMOKES.length} smoke(s)`
    + ' — mover rest/skin/snap/ceiling, joints and the mouse drag, sensor overlap.');
