// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Per-frame and memory budgets at corpus scale.
 *
 * The frame budgets are CPU-side only: a headless app has no renderer, so
 * draw-call generation and GPU upload are not here — they need the electron
 * harness and are a separate tier. What IS here is the half that runs before
 * any of that, and the half a big scene makes expensive.
 *
 * The memory budgets are the ones worth having, because bytes do not care which
 * machine measured them. The wasm heap is exact — it is a byte length, not a
 * sample. The JS heap is not: V8 decides when to give memory back, so its budget
 * is set wide enough to catch a leak and no narrower.
 */
import { describe, it, beforeAll, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    createHeadlessApp,
    loadEsengineModule,
    resetWorldTo,
    type App,
    type SceneData,
} from 'esengine/node';

import { WASM_DIR, HAS_WASM } from '../helpers/loadWasm';
import { budgeted, budgetedValue, calibrate, corpusDir } from './harness';

const GROUP = 'Runtime — frames and memory';
const DT = 1 / 60;
const EMPTY: SceneData = { version: 1, name: 'empty', entities: [] };

let app: App;
let module: Awaited<ReturnType<typeof loadEsengineModule>>;
let sprites: SceneData;
let everything: SceneData;

/** One frame of the CPU-side loop: systems, then the C++ transform propagation. */
async function tick(): Promise<void> {
    await app.tick(DT);
    const registry = app.world.getCppRegistry();
    if (registry) module.transform_update(registry);
}

async function ticks(n: number): Promise<void> {
    for (let i = 0; i < n; i++) await tick();
}

/** heapUsed after a collection — the only reading that means anything. */
function settledHeapMB(): number {
    const gc = (globalThis as { gc?: () => void }).gc;
    for (let i = 0; i < 3; i++) gc?.();
    return process.memoryUsage().heapUsed / 1e6;
}

/**
 * Bytes the engine has actually allocated inside wasm.
 *
 * NOT `HEAPU8.byteLength`: emscripten hands the module ~17MB up front and the
 * whole corpus fits inside it, so the heap's length never moves and a budget on
 * it would read zero however much storage a change added.
 */
const wasmBytesMB = (): number => (module.es_getMallocBytes?.() ?? 0) / 1e6;

beforeAll(async () => {
    const root = corpusDir();
    await calibrate(root);
    module = await loadEsengineModule(WASM_DIR);
    app = createHeadlessApp(module);
    sprites = JSON.parse(await readFile(path.join(root, 'assets/scenes/sprites.esscene'), 'utf8'));
    everything = JSON.parse(await readFile(path.join(root, 'assets/scenes/everything.esscene'), 'utf8'));
}, 300_000);

describe.skipIf(!HAS_WASM)(GROUP, () => {
    it('ticks the 10k-sprite scene', async () => {
        resetWorldTo(app.world, sprites);
        await budgeted({
            name: 'frame: 60 update ticks over 10,000 sprites',
            group: GROUP,
            unit: 'loop',
            budget: 10,
            why: 'A second of simulation with nothing moving: system dispatch, query iteration and '
                + 'the C++ transform propagation. Sixty ticks rather than one, because one tick is '
                + 'short enough to be measuring the clock. GPU submission is not in here.',
            runs: 3,
            warmup: 1,
        }, () => ticks(60));
    }, 600_000);

    it('ticks the everything scene', async () => {
        resetWorldTo(app.world, everything);
        await budgeted({
            name: 'frame: 60 update ticks over the everything scene',
            group: GROUP,
            unit: 'loop',
            budget: 16,
            why: 'The same second on the worst scene in the corpus. The gap between this and the '
                + 'sprite scene is what the other component families cost per frame.',
            runs: 3,
            warmup: 1,
        }, () => ticks(60));
    }, 600_000);

    it('holds the 10k-sprite scene in bounded wasm storage', async () => {
        // A module of its own, so this is the cost of the scene and not of
        // whatever an earlier test left allocated.
        const fresh = await loadEsengineModule(WASM_DIR);
        const freshApp = createHeadlessApp(fresh);
        await freshApp.tick(DT);
        const empty = (fresh.es_getMallocBytes?.() ?? 0) / 1e6;
        resetWorldTo(freshApp.world, sprites);
        await freshApp.tick(DT);

        await budgetedValue({
            name: 'heap: wasm bytes for 10,000 sprites',
            group: GROUP,
            unit: 'MB',
            budget: 8,
            why: 'Component storage for 10,000 entities, measured on a module nothing else has '
                + 'touched. Exact bytes, not a sample — the same number on every machine, so it '
                + 'is the strictest budget here.',
        }, () => (fresh.es_getMallocBytes?.() ?? 0) / 1e6 - empty);
    }, 600_000);

    it('holds the 10k-sprite scene in a bounded JS heap', async () => {
        resetWorldTo(app.world, EMPTY);
        await ticks(2);
        const empty = settledHeapMB();
        resetWorldTo(app.world, sprites);
        await ticks(2);
        await budgetedValue({
            name: 'heap: JS growth for 10,000 sprites',
            group: GROUP,
            unit: 'MB',
            budget: 14,
            why: 'The JS-side entity bookkeeping the world keeps beside the wasm storage. Wide by '
                + 'design: V8 decides when to release, so this catches a leak and not a regression.',
        }, () => settledHeapMB() - empty);
    }, 600_000);

    it('gives the scene back when it is closed', async () => {
        // The Play/Stop shape: open a scene, close it, repeat. Measured from
        // cycle 3, so one-time caches are already paid for and what is left is
        // what the cycle itself retains.
        const CYCLES = 20;
        let floorAt3 = 0;
        let wasmAt3 = 0;
        for (let i = 0; i < CYCLES; i++) {
            resetWorldTo(app.world, sprites);
            await ticks(2);
            resetWorldTo(app.world, EMPTY);
            await ticks(2);
            if (i === 2) {
                floorAt3 = settledHeapMB();
                wasmAt3 = wasmBytesMB();
            }
        }

        await budgetedValue({
            name: 'heap: wasm retained over 20 open/close cycles',
            group: GROUP,
            unit: 'MB',
            budget: 2,
            why: 'Opening and closing a scene twenty times must end where it started. Component '
                + 'pools keep their capacity by design — that is a flat floor, reached by cycle '
                + 'three. Anything that keeps climbing after it is storage nobody reclaims.',
        }, () => wasmBytesMB() - wasmAt3);

        await budgetedValue({
            name: 'heap: JS retained over 20 open/close cycles',
            group: GROUP,
            unit: 'MB',
            budget: 8,
            why: 'The same seventeen cycles on the JS side. A per-cycle leak of even a few hundred '
                + 'kilobytes is a session that runs out of memory; a flat line here is the contract.',
        }, () => settledHeapMB() - floorAt3);

        expect(app.world.getAllEntities().length).toBe(0);
    }, 900_000);
});
