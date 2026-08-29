// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-readback-phases.bench.ts
 * @brief   Which part of reading a pose back is the cost.
 *
 * @details The runtime reports `pose` and `readback` because splitting the
 *          second in-frame needs a clock at every batch boundary — six thousand
 *          reads at a thousand entities, the observer costing what it observes.
 *          So the split is measured HERE, by running the same crossings in the
 *          same order and stopping at five depths:
 *
 *            extract    `getMeshBatchCount` — which POSES AND BUILDS every
 *                       vertex buffer on the module side before it can answer
 *                       (SpineModuleEntry.cpp: extractBatches)
 *            query      how many vertices, how many indices  (2 calls/batch)
 *            read       copy them out of the module          (1 call/batch)
 *            transfer   copy them into the core's heap       (no call, MBs)
 *
 *          Each depth includes the ones above it, so a phase is the difference
 *          between two — which is why they are benched together and read as a
 *          set, never one at a time.
 */
import { describe, bench, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from '../tests/helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { withMalloc, withScratch } from '../src/wasm/wasmScratch';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, 'fixtures/spine/spineboy-38');
const HAS_ASSETS = existsSync(SPINE38_WASM) && existsSync(resolve(FIXTURES, 'spineboy-pro.skel'));

const ENTITIES = 1000;
const FRAMES = 20;
const VERTEX_FLOATS = 8;

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
let instances: number[] = [];
/** The engine core's heap, as far as a copy is concerned. */
let coreHeap: Uint8Array;

beforeAll(async () => {
    if (!HAS_ASSETS) return;
    const factory = (await import(SPINE38_JS)).default as (opts: unknown) => Promise<SpineWasmModule>;
    const bytes = readFileSync(SPINE38_WASM);
    raw = await factory({
        instantiateWasm(imports: WebAssembly.Imports, cb: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
            void WebAssembly.instantiate(bytes, imports).then((r) => cb(r.instance, r.module));
            return {};
        },
    });
    api = wrapSpineModule(raw);

    const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'spineboy-pro.skel')));
    const atlasText = readFileSync(resolve(FIXTURES, 'spineboy.atlas'), 'utf-8');
    const skelHandle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
    });
    const pages = api.getAtlasPageCount(skelHandle);
    for (let i = 0; i < pages; i++) api.setAtlasPageTexture(skelHandle, i, 1, 1024, 1024);
    for (let i = 0; i < ENTITIES; i++) {
        const id = api.createInstance(skelHandle);
        api.playAnimation(id, 'walk', 1, 0);
        instances.push(id);
    }
    coreHeap = new Uint8Array(1 << 26);
});

/** Depth 0 is the pose; each depth after it adds the next stage. */
function pass(depth: 0 | 1 | 2 | 3 | 4): void {
    for (let f = 0; f < FRAMES; f++) {
        for (const id of instances) api.update(id, 1 / 60);
        if (depth === 0) continue;
        for (const id of instances) {
            // Not a query: this is where the module poses and builds the whole
            // frame's geometry for the instance.
            const batches = api.getMeshBatchCount(id);
            if (batches === 0 || depth === 1) continue;
            withMalloc(raw, 8, (metaPtr) => {
                for (let b = 0; b < batches; b++) {
                    const vertexCount = api.getMeshBatchVertexCount(id, b);
                    const indexCount = api.getMeshBatchIndexCount(id, b);
                    if (depth === 2 || vertexCount <= 0 || indexCount <= 0) continue;
                    const vertBytes = vertexCount * VERTEX_FLOATS * 4;
                    const idxBytes = indexCount * 2;
                    withScratch(raw, (alloc) => {
                        const vertPtr = alloc(vertBytes);
                        const idxPtr = alloc(idxBytes);
                        api.getMeshBatchData(id, b, vertPtr, idxPtr, metaPtr, metaPtr + 4);
                        if (depth === 3) return;
                        coreHeap.set(new Uint8Array(raw.HEAPU8.buffer, vertPtr, vertBytes), 0);
                        coreHeap.set(new Uint8Array(raw.HEAPU8.buffer, idxPtr, idxBytes), vertBytes);
                        // Submitting is the renderer's cost, not this walk's; it
                        // is measured against a real core, not faked in here.
                    });
                }
            });
        }
    }
}

describe.skipIf(!HAS_ASSETS)(`Spine readback phases: ${ENTITIES} entities x${FRAMES} frames`, () => {
    bench('pose', () => { pass(0); });
    bench('+ extract (getMeshBatchCount)', () => { pass(1); });
    bench('+ query counts', () => { pass(2); });
    bench('+ read bytes out', () => { pass(3); });
    bench('+ copy into the core heap', () => { pass(4); });
});
