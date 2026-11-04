// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-physics3d-physx.mjs — the PhysX backend does what the Jolt one does.
 *
 * The same smoke check-physics3d runs, against physics3d-physx.wasm: both modules
 * answer one interface, and every assertion in it is about physics rather than
 * about an engine, so a project switching backend keeps every behaviour it was
 * promised. Fails on a missing or stale binary under ESTELLA_REQUIRE_WASM.
 *
 *   node tools/check-physics3d-physx.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireCurrentModule } from './moduleBinary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE = path.join(ROOT, 'sdk', 'tests', 'physics3d-smoke.mjs');
const WASM = path.join(ROOT, 'build', 'wasm', 'web', 'physics3d-physx.wasm');

requireCurrentModule({
    gate: 'check-physics3d-physx',
    wasm: WASM,
    rel: 'build/wasm/web/physics3d-physx.wasm',
    sources: [path.join(ROOT, 'src', 'esengine', 'bindings', 'modules', 'physics3d_physx'), SMOKE],
    build: 'node build-tools/cli.js build -t physics3d-physx',
});

const run = spawnSync(process.execPath, [SMOKE], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, PHYSICS3D_MODULE: 'physics3d-physx' },
});
if (run.status !== 0) {
    console.error(run.stdout ?? '');
    console.error(run.stderr ?? '');
    console.error('\ncheck-physics3d-physx: the PhysX world did not behave as the geometry says.');
    process.exit(1);
}

const passes = (run.stdout.match(/^PASS/gm) ?? []).length;
console.log(`check-physics3d-physx: ${passes} behaviour(s) hold on PhysX — the same ones the Jolt module answers.`);
