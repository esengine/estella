// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-pose-demand.bench.ts
 * @brief   What a frame would keep if only the entities someone can see were
 *          given a world pose.
 *
 * @details Every bound entity is posed, extracted and submitted, whatever the
 *          camera can see — asserted in tests/spine-pose-demand, which is the
 *          baseline this is measured against. So the question is not whether
 *          skipping is possible but what it is worth, and the answer has to be
 *          measured rather than projected from a per-entity number.
 *
 *          Three tiers, run over the same entities:
 *
 *            full      what the runtime does now: advance, apply, world
 *                      transform, extract, submit
 *            logical   advance and apply only — the animation clock keeps its
 *                      meaning, no world pose is materialised, nothing is drawn
 *            frozen    nothing advances at all
 *
 *          `logical` is what an offscreen entity would cost under demand-driven
 *          posing, and it is measured through the staged pose rather than
 *          guessed: depth 2 IS advance-and-apply. The gap between it and `full`
 *          is the ceiling on what visibility scheduling can recover, before any
 *          of the correctness questions — events owed, bones read, constraints
 *          that cannot take one big step — are answered.
 *
 *          ms per frame, 1000 entities, min of the run:
 *
 *              scene                  today  demand-driven  frozen
 *              all visible             3.14           3.14    3.16
 *              200 visible, 800 not    3.14           1.01    0.62
 *              none visible            3.14           0.49    0.00
 *
 *          A scene where four fifths of the skeletons are off camera pays the
 *          same 3.14 ms as one where none of them are, and would pay 1.01 —
 *          2.13 ms a frame, 3.1x, for a decision nothing currently makes.
 *
 *          What the third column is for: freezing the clock as well buys only
 *          another 0.39 ms of that 2.52. Keeping every animation's time
 *          meaning — events, mixes, track positions — costs 15% of the win,
 *          which is what says the thing worth skipping is the world transform
 *          and never the animation state.
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
const HAS_WASM = existsSync(SPINE38_WASM)
    && existsSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel'));

const ENTITIES = 1000;
const FRAMES = 20;
const DT = 1 / 60;
const POSE_APPLY = 2;

/** How many of the thousand a camera can see. */
const SCENES = [
    { name: 'all visible', visible: ENTITIES },
    { name: '200 visible, 800 not', visible: 200 },
    { name: 'none visible', visible: 0 },
];

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
const instances: number[] = [];

beforeAll(async () => {
    if (!HAS_WASM) return;
    const factory = (await import(SPINE38_JS)).default as (opts: unknown) => Promise<SpineWasmModule>;
    const bytes = readFileSync(SPINE38_WASM);
    raw = await factory({
        instantiateWasm(imports: WebAssembly.Imports, cb: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
            void WebAssembly.instantiate(bytes, imports).then((r) => cb(r.instance, r.module));
            return {};
        },
    });
    api = wrapSpineModule(raw);

    const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel')));
    const atlasText = readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy.atlas'), 'utf-8');
    const handle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
    });
    if (handle < 0) throw new Error(api.getLastError());
    api.setAtlasPageTexture(handle, 0, 1, 2048, 2048);
    for (let i = 0; i < ENTITIES; i++) {
        const id = api.createInstance(handle);
        if (!api.playAnimation(id, 'walk', true, 0)) throw new Error('no walk');
        api.update(id, 0.1 + i * 0.001);
        instances.push(id);
    }
});

/** What a visible entity costs: the whole thing, extraction included. */
function full(from: number, to: number): void {
    for (let i = from; i < to; i++) {
        api.update(instances[i], DT);
        api.getMeshBatchCount(instances[i]);
    }
}

/** What an unseen one would cost: the clock keeps running, nothing is posed. */
function logical(from: number, to: number): void {
    for (let i = from; i < to; i++) api.probePose(instances[i], DT, POSE_APPLY);
}

function scene(visible: number, unseen: (from: number, to: number) => void): void {
    for (let f = 0; f < FRAMES; f++) {
        full(0, visible);
        unseen(visible, ENTITIES);
    }
}

describe.skipIf(!HAS_WASM)(`Spine pose demand: ${ENTITIES} entities x${FRAMES}`, () => {
    for (const s of SCENES) {
        bench(`today — ${s.name}`, () => { scene(s.visible, full); });
        bench(`demand-driven — ${s.name}`, () => { scene(s.visible, logical); });
        bench(`frozen — ${s.name}`, () => { scene(s.visible, () => {}); });
    }
});
