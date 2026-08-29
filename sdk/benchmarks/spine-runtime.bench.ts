// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-runtime.bench.ts
 * @brief   What a frame of spine costs through the RUNTIME, not the ABI adapter.
 *
 * @details spine.bench.ts times the module: parse, pose, read back. This times
 *          the pass a scene actually runs — `updateAll` and
 *          `extractAndSubmitMeshes` over a runtime's entities, with the
 *          per-entity bookkeeping and the copy into the engine's heap included,
 *          which is where a frame's cost is actually paid.
 *
 *          Two axes beyond entity count: whether the entities share one era
 *          (the residency the runtime keeps) and whether the frame reads poses
 *          back. The crossing counts behind these numbers are asserted in
 *          tests/spine-abi-cost.test.ts — this is how long they take.
 */
import { describe, bench, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from '../tests/helpers/loadWasm';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { Entity } from '../src/types';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, 'fixtures/spine/spineboy-38');
const HAS_ASSETS = existsSync(SPINE38_WASM) && existsSync(resolve(FIXTURES, 'spineboy-pro.skel'));

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
    skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'spineboy-pro.skel')));
    atlasText = readFileSync(resolve(FIXTURES, 'spineboy.atlas'), 'utf-8');
});

function era(id: string): SpineEraBinding {
    return {
        id,
        value: {
            skelData, atlasText, isBinary: true,
            textures: new Map([['spineboy.png', { glId: 1, w: 1024, h: 1024 }]]),
        },
        retain: () => ({ release: () => {} }),
    };
}

/** An engine core that takes the geometry and drops it: what is timed here is
 *  the walk and the copy, not a renderer. */
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

function populated(entities: number, eras: number): SpineRuntime {
    const runtime = new SpineRuntime('3.8', module38);
    for (let i = 0; i < entities; i++) {
        const entity = (i + 1) as Entity;
        runtime.loadEntity(entity, era(`hero#${i % eras}`));
        runtime.setAnimation(entity, 'walk', true);
    }
    return runtime;
}

const DT = 1 / 60;
const FRAMES = 60;
const core = fakeCore();

/** One populated runtime per case, so the measured loop is only the frame. */
function frames(runtime: SpineRuntime, submit: boolean): void {
    for (let f = 0; f < FRAMES; f++) {
        runtime.updateAll(DT);
        if (submit) runtime.extractAndSubmitMeshes(core as never, {} as never);
    }
}

describe.skipIf(!HAS_ASSETS)('Spine runtime frame: pose only', () => {
    for (const entities of [100, 500, 1000]) {
        let runtime: SpineRuntime;
        bench(`${entities} entities x${FRAMES} frames`, () => { frames(runtime, false); }, {
            setup: () => { runtime = populated(entities, 1); },
            teardown: () => { runtime.dispose(); },
        });
    }
});

describe.skipIf(!HAS_ASSETS)('Spine runtime frame: pose + submit', () => {
    for (const entities of [100, 500, 1000]) {
        let runtime: SpineRuntime;
        bench(`${entities} entities x${FRAMES} frames`, () => { frames(runtime, true); }, {
            setup: () => { runtime = populated(entities, 1); },
            teardown: () => { runtime.dispose(); },
        });
    }
});

describe.skipIf(!HAS_ASSETS)('Spine runtime frame: residency sharing', () => {
    for (const [label, eras] of [['one era', 1], ['10 eras', 10], ['an era each', 500]] as const) {
        let runtime: SpineRuntime;
        bench(`500 entities, ${label}, x${FRAMES} frames`, () => { frames(runtime, true); }, {
            setup: () => { runtime = populated(500, eras); },
            teardown: () => { runtime.dispose(); },
        });
    }
});
