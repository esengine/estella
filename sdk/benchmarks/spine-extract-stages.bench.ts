// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-extract-stages.bench.ts
 * @brief   What `extractBatches` is made of.
 *
 * @details `spine_getMeshBatchCount` poses and refills every vertex buffer
 *          before it can answer, and it is a quarter of a thousand-entity frame.
 *          This prices the steps of that walk the same way the readback split
 *          was priced — by running it to five depths and subtracting — rather
 *          than by putting a clock inside a loop that runs per slot.
 *
 *          The staged walk is a separate compile-time instantiation
 *          (SpineRuntimeC.cpp, `renderImpl<STAGE, COUNT>`); the one a frame runs
 *          has no stage check and no counter in it. Every depth costs exactly
 *          one crossing per instance, so the boundary cancels in the differences.
 *
 *          S5c minus S5 is the storage, and it was never the reallocation:
 *          making the slots outlive the frame drove that to zero and moved this
 *          number by nothing. It was the per-element writing — eight pushes per
 *          vertex, three thousand per skeleton — and appending in blocks instead
 *          took the gap from 6.08 ms per frame to 0.49 at a thousand entities.
 */
import { describe, bench, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from '../tests/helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { withScratch } from '../src/wasm/wasmScratch';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, 'fixtures/spine');
const SKELETON = process.env.SPINE_STAGE_ASSET ?? 'spineboy-38/spineboy-pro.skel';
const ATLAS = SKELETON.replace(/[^/]+$/, '').concat(
    SKELETON.includes('raptor') ? 'raptor.atlas' : SKELETON.includes('coin') ? 'coin.atlas' : 'spineboy.atlas');
const HAS_ASSETS = existsSync(SPINE38_WASM) && existsSync(resolve(FIXTURES, SKELETON));

const ENTITIES = 1000;
const FRAMES = 20;

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
const instances: number[] = [];

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


    const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, SKELETON)));
    const atlasText = readFileSync(resolve(FIXTURES, ATLAS), 'utf-8');
    const skelHandle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
    });
    for (let i = 0, pages = api.getAtlasPageCount(skelHandle); i < pages; i++) {
        api.setAtlasPageTexture(skelHandle, i, 1, 1024, 1024);
    }
    const [animation] = JSON.parse(api.getAnimations(api.createInstance(skelHandle))) as string[];
    for (let i = 0; i < ENTITIES; i++) {
        const id = api.createInstance(skelHandle);
        if (!api.playAnimation(id, animation, true, 0)) throw new Error(`no animation "${animation}"`);
        api.update(id, 0.1 + i * 0.001);
        instances.push(id);
    }
});

/** One frame's worth of extraction, stopped at `stage`. */
function pass(stage: number, useCollector: number): void {
    for (let f = 0; f < FRAMES; f++) {
        for (const id of instances) api.probeExtract(id, stage, useCollector);
    }
}

describe.skipIf(!HAS_ASSETS)(`Spine extraction stages: ${ENTITIES} entities x${FRAMES}`, () => {
    bench('S0 setup (the crossing and the instance lookup)', () => { pass(0, 0); });
    bench('S1 + draw-order traversal', () => { pass(1, 0); });
    bench('S2 + world vertices and tint', () => { pass(2, 0); });
    bench('S3 + open the clip regions', () => { pass(3, 0); });
    bench('S4 + cut the triangles', () => { pass(4, 0); });
    bench('S5 + emit, counted and dropped', () => { pass(5, 0); });
    bench('S5c + emit into the frame\'s batch vectors', () => { pass(5, 1); });
});
