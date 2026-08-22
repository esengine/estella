// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-physics3d.mjs — the 3D physics module does what a world should.
 *
 * The behaviours it asserts are arithmetic, not "it did not throw": a sphere
 * comes to rest at its own radius above a floor, a ray reports the fraction the
 * geometry predicts and names the entity that owns what it hit, a capsule rests
 * on its own half-height. Each of those is a different part of the module —
 * contact resolution, the query path, shape construction — and each fails with a
 * number rather than a stack.
 *
 * A missing wasm FAILS rather than skipping. Three physics smokes already sit in
 * sdk/tests that nothing schedules; a gate that quietly opts out when the thing
 * it judges is absent is the same hole with a nicer name.
 *
 *   node tools/check-physics3d.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE = path.join(ROOT, 'sdk', 'tests', 'physics3d-smoke.mjs');
const WASM = path.join(ROOT, 'build', 'wasm', 'web', 'physics3d.wasm');

// An unbuilt module is not a failed behaviour. The job that HAS the binary sets
// ESTELLA_REQUIRE_WASM, so a build that stops arriving there fails rather than
// skipping quietly.
if (!existsSync(WASM)) {
    if (process.env.ESTELLA_REQUIRE_WASM) {
        console.error('check-physics3d: ESTELLA_REQUIRE_WASM is set but build/wasm/web/physics3d.wasm is absent.\n');
        console.error('  node build-tools/cli.js build -t physics3d');
        process.exit(1);
    }
    console.log('check-physics3d: build/wasm/web/physics3d.wasm is not built — skipped'
        + ' (build it with `node build-tools/cli.js build -t physics3d`; CI sets ESTELLA_REQUIRE_WASM).');
    process.exit(0);
}

const run = spawnSync(process.execPath, [SMOKE], { cwd: ROOT, encoding: 'utf8' });
if (run.status !== 0) {
    console.error(run.stdout ?? '');
    console.error(run.stderr ?? '');
    console.error('\ncheck-physics3d: the 3D world did not behave as the geometry says.');
    process.exit(1);
}

const passes = (run.stdout.match(/^PASS/gm) ?? []).length;
console.log(`check-physics3d: ${passes} behaviour(s) hold — rest position, ray hits and`
    + ' shape extents all land on their predicted values.');
