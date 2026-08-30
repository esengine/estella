// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-observability.test.ts
 * @brief   A frame that can say what it cost, without costing it.
 *
 * @details The trap in profiling a path that crosses an ABI eleven times per
 *          entity is measuring each crossing: a thousand entities then buy
 *          twenty-two thousand clock reads to explain ten milliseconds. So the
 *          rule is counted-fine, timed-coarse — and it is a judgment here, not
 *          an intention: the clock is read a fixed number of times per runtime
 *          per frame, whatever the entity count, and not at all when nobody is
 *          watching.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { SpineTimeWindow } from '../src/spine/spineMetrics';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { Entity } from '../src/types';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine/spineboy-38');
const SKEL = resolve(FIXTURES, 'spineboy-pro.skel');
const ATLAS = resolve(FIXTURES, 'spineboy.atlas');
const HAS_ASSETS = hasSideModule('spine38') && existsSync(SKEL) && existsSync(ATLAS);

let module38: SpineWasmModule;
let skelData: Uint8Array;
let atlasText: string;

beforeAll(async () => {
    if (!HAS_ASSETS) return;
    const factory = (await import(SPINE38_JS)).default as (opts: unknown) => Promise<SpineWasmModule>;
    const bytes = readFileSync(SPINE38_WASM);
    module38 = await factory({
        instantiateWasm(imports: WebAssembly.Imports, cb: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
            void WebAssembly.instantiate(bytes, imports).then((r) => cb(r.instance, r.module));
            return {};
        },
    });
    skelData = new Uint8Array(readFileSync(SKEL));
    atlasText = readFileSync(ATLAS, 'utf-8');
});
afterEach(() => { vi.restoreAllMocks(); });

function era(id: string): SpineEraBinding {
    return {
        id,
        value: {
            skelData, atlasText, isBinary: true,
            textures: new Map([['spineboy.png', { glId: 1, w: 1024, h: 1024 }]]),
        },
        pair: { skeleton: `${id}.skel`, atlas: `${id}.atlas` },
        retain: () => ({ release: () => {} }),
    };
}

function fakeCore() {
    const heap = new Uint8Array(1 << 24);
    let top = 0;
    return {
        renderer_submitSkeletalBatchByEntity: () => {},
        _malloc: (size: number) => { const at = top; top += size; return at; },
        _free: () => { top = 0; },
        HEAPU8: heap,
    };
}

function populated(entities: number, eras = 1): SpineRuntime {
    const runtime = new SpineRuntime('3.8', module38);
    for (let i = 0; i < entities; i++) {
        const entity = (i + 1) as Entity;
        runtime.loadEntity(entity, era(`hero#${i % eras}`));
        runtime.setAnimation(entity, 'walk', true);
    }
    return runtime;
}

const core = fakeCore();
function frame(runtime: SpineRuntime): void {
    runtime.updateAll(1 / 60);
    runtime.extractAndSubmitMeshes(core as never, {} as never);
}

describe.skipIf(!HAS_ASSETS)('a frame can say what it cost', () => {
    it('the counts are the crossings, exactly', () => {
        // The same numbers spine-abi-cost.test.ts asserts from outside, reported
        // from inside: a diagnostic that has to be believed on its own word is
        // one nobody can act on.
        const runtime = populated(10);
        runtime.observe(true);
        frame(runtime);
        const m = runtime.metrics()!;

        expect(m.entities).toBe(10);
        expect(m.residencies).toBe(1);
        expect(m.abi.pose).toBe(10);
        expect(m.abi.batchCount).toBe(10);
        expect(m.abi.vertexCount).toBe(m.meshBatches);
        expect(m.abi.batchData).toBe(m.meshBatches);
        expect(m.abi.malloc).toBe(10 + m.meshBatches * 2);
        expect(m.abi.free).toBe(m.abi.malloc);
        expect(m.abi.submit).toBe(m.meshBatches);
        // The bytes no call count stands in for.
        expect(m.bytes.coreWrite).toBe(m.vertices * 8 * 4 + m.indices * 2);
        expect(m.bytes.wasmRead).toBe(m.bytes.coreWrite);
        runtime.dispose();
    });

    it('the clock is read a fixed number of times, whatever the entity count', () => {
        // The whole design in one judgment: eleven crossings per entity, two
        // clock reads per frame.
        const runtime = populated(200);
        runtime.observe(true);
        frame(runtime);

        const clock = vi.spyOn(performance, 'now');
        frame(runtime);
        expect(clock.mock.calls.length, 'the observer is timing the crossings').toBe(4);
        runtime.dispose();
    });

    it('not watching costs no clock read at all', () => {
        const runtime = populated(200);
        frame(runtime);

        const clock = vi.spyOn(performance, 'now');
        frame(runtime);
        expect(clock.mock.calls.length).toBe(0);
        expect(runtime.metrics()).toBeNull();
        runtime.dispose();
    });

    it('the record is one object, reused every frame', () => {
        // A frame that allocates to say what a frame cost is measuring itself.
        const runtime = populated(50);
        runtime.observe(true);
        frame(runtime);
        const first = runtime.metrics();
        frame(runtime);

        expect(runtime.metrics(), 'a fresh record per frame').toBe(first);
        expect(first!.frame).toBe(2);
        expect(first!.abi.pose, 'the counts carried over from the last frame').toBe(50);
        runtime.dispose();
    });

    it('aggregated per runtime, never per entity', () => {
        const runtime = populated(100, 10);
        runtime.observe(true);
        frame(runtime);
        const m = runtime.metrics()!;

        expect(m.entities).toBe(100);
        expect(m.residencies, 'ten eras, ten native skeletons').toBe(10);
        expect(Object.keys(m)).toEqual([
            'frame', 'entities', 'residencies', 'meshBatches', 'vertices', 'indices',
            'abi', 'pose', 'bytes', 'time',
        ]);
        // `pose` is the frame in DEMAND rather than in calls: what was advanced,
        // what had to be resolved, and what asked and found it already was.
        expect(m.pose.logicalUpdates).toBe(100);
        expect(m.pose.worldMaterializations, 'a world pose was resolved twice').toBe(100);
        expect(m.pose.worldAlreadyCurrent, 'the extraction re-resolved what it asked for').toBe(100);
        runtime.dispose();
    });
});

describe('the window keeps the frame that missed', () => {
    it('reports last, mean, p50, p95 and max — not just an average', () => {
        // Four at 4 and one at 9 average to a budget nobody blew.
        const window = new SpineTimeWindow(120);
        for (const ms of [4, 4, 4, 4, 9]) window.push(ms);

        const stats = window.stats();
        expect(stats.last).toBe(9);
        expect(stats.max).toBe(9);
        expect(stats.p50).toBe(4);
        expect(stats.mean).toBeCloseTo(5, 5);
    });

    it('keeps the last N frames and forgets the rest', () => {
        const window = new SpineTimeWindow(4);
        for (const ms of [99, 1, 1, 1, 1]) window.push(ms);

        expect(window.size).toBe(4);
        expect(window.stats().max, 'a spike outside the window still counted').toBe(1);
    });
});
