// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-abi-cost.test.ts
 * @brief   What one spine entity costs in crossings, per frame — the baseline.
 *
 * @details Now that lifetimes are trustworthy the numbers mean something: no
 *          duplicate parses, no ghost instances, no leaked residency inflating
 *          them. So the first thing to write down is not a time, it is the SHAPE
 *          of the cost: how many times a frame crosses into the module, and what
 *          that number is proportional to.
 *
 *          These are judgments, not a report, because the shape is what a later
 *          batch ABI would change on purpose — and a change nobody noticed is
 *          how a per-entity crossing count grows a factor.
 *
 *          Real module, real skeleton: a fake would answer whatever the harness
 *          decided, including how many batches a pose has.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import type { SpineAssetValue, SpineEraBinding } from '../src/spine/prepareSpine';
import type { Entity } from '../src/types';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine/spineboy-38');
const SKEL = resolve(FIXTURES, 'spineboy-pro.skel');
const ATLAS = resolve(FIXTURES, 'spineboy.atlas');
const HAS_ASSETS = existsSync(SPINE38_WASM) && existsSync(SKEL) && existsSync(ATLAS);

/** Every export call, by name — the module's own `cwrap` is the one door. */
interface Crossings {
    counts: Map<string, number>;
    total(): number;
    reset(): void;
}

/** The module, with every ABI crossing counted. Nothing in the engine is
 *  instrumented: what a runtime reaches for, it reaches for through here. */
function counting(module: SpineWasmModule): { module: SpineWasmModule; crossings: Crossings } {
    const counts = new Map<string, number>();
    const bump = (name: string): void => { counts.set(name, (counts.get(name) ?? 0) + 1); };
    const cwrap = module.cwrap.bind(module);
    const crossings: Crossings = {
        counts,
        total: () => [...counts.values()].reduce((a, b) => a + b, 0),
        reset: () => counts.clear(),
    };
    const wrapped = Object.create(module) as SpineWasmModule & {
        _malloc(size: number): number; _free(ptr: number): void;
    };
    wrapped.cwrap = ((name: string, ret: unknown, args: unknown) => {
        const fn = cwrap(name, ret as never, args as never);
        return (...called: unknown[]) => { bump(name); return (fn as (...a: unknown[]) => unknown)(...called); };
    }) as never;
    const malloc = module._malloc.bind(module);
    const free = module._free.bind(module);
    wrapped._malloc = (size: number) => { bump('_malloc'); return malloc(size); };
    wrapped._free = (ptr: number) => { bump('_free'); free(ptr); };
    return { module: wrapped, crossings };
}

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

/** One era, over the real spineboy documents. `id` is what a residency shares by. */
function era(id: string): SpineEraBinding {
    const value: SpineAssetValue = {
        skelData, atlasText, isBinary: true,
        // One page, faked: what an atlas page IS costs nothing per frame — the
        // module is told a texture id once, at parse.
        textures: new Map([['spineboy.png', { glId: 1, w: 1024, h: 1024 }]]),
    };
    return { id, value, retain: () => ({ release: () => {} }) };
}

/** N entities on `eras` distinct eras, posed for one frame so batches exist. */
function populate(runtime: SpineRuntime, entities: number, eras: number): Entity[] {
    const bound: Entity[] = [];
    for (let i = 0; i < entities; i++) {
        const entity = (i + 1) as Entity;
        runtime.loadEntity(entity, era(`hero#${i % eras}`));
        runtime.setAnimation(entity, 'walk', true);
        bound.push(entity);
    }
    return bound;
}

/**
 * An engine core that accepts geometry and counts it. What is measured is the
 * walk INTO the spine module, so the core's own heap is a scratch buffer and its
 * submit is a tally — a real core would cost the same on either side of this.
 */
function countingCore() {
    const seen = { batches: 0, vertices: 0 };
    const heap = new Uint8Array(1 << 22);
    let top = 0;
    return {
        seen,
        core: {
            renderer_submitSkeletalBatchByEntity: (
                _registry: unknown, _vp: number, vertexCount: number,
            ) => { seen.batches++; seen.vertices += vertexCount; },
            _malloc: (size: number) => { const at = top; top += size; return at; },
            _free: () => { top = 0; },
            HEAPU8: heap,
        },
    };
}

/** One frame of the pass a scene actually runs. */
function frame(
    runtime: SpineRuntime, core: ReturnType<typeof countingCore> | null,
): { batches: number; vertices: number } {
    runtime.updateAll(1 / 60);
    if (!core) return { batches: 0, vertices: 0 };
    core.seen.batches = 0;
    core.seen.vertices = 0;
    runtime.extractAndSubmitMeshes(core.core as never, {} as never);
    return { ...core.seen };
}

/** The table, printed on demand: `SPINE_ABI_REPORT=1 pnpm --filter ./sdk test
 *  spine-abi-cost`. The judgments below are what holds the shape; this is for
 *  reading the size of it. */
function report(rows: Array<Record<string, number | string>>): void {
    if (!process.env.SPINE_ABI_REPORT) return;
    const keys = Object.keys(rows[0]);
    const width = (k: string) => Math.max(k.length, ...rows.map((r) => String(r[k]).length));
    const line = (cells: Array<string | number>) =>
        cells.map((c, i) => String(c).padStart(width(keys[i]))).join('  ');
    console.log(line(keys));
    for (const row of rows) console.log(line(keys.map((k) => row[k])));
}

describe.skipIf(!HAS_ASSETS)('what a spine entity costs per frame', () => {
    it('the baseline, for reading', () => {
        const rows: Array<Record<string, number | string>> = [];
        for (const entities of [1, 10, 100, 500, 1000]) {
            for (const workload of ['pose', 'pose+submit'] as const) {
                const { module, crossings } = counting(module38);
                const runtime = new SpineRuntime('3.8', module);
                const core = countingCore();
                populate(runtime, entities, 1);
                const submit = workload === 'pose+submit' ? core : null;
                frame(runtime, submit);
                crossings.reset();
                const { batches, vertices } = frame(runtime, submit);
                rows.push({
                    entities, workload,
                    crossings: crossings.total(),
                    'per entity': +(crossings.total() / entities).toFixed(1),
                    batches, vertices,
                    'scratch B': batches * 2 > 0 ? vertices * 8 * 4 + batches * 64 : 0,
                });
                runtime.dispose();
            }
        }
        report(rows);
        expect(rows).toHaveLength(10);
    });

    it('posing is two crossings per entity, whatever the entity count', () => {
        // Two since a pose became two things it can be asked for separately:
        // advancing the animation, and resolving the world it implies. The
        // second one is what a frame can one day decline to ask for.
        const { module, crossings } = counting(module38);
        const runtime = new SpineRuntime('3.8', module);
        populate(runtime, 10, 1);

        crossings.reset();
        frame(runtime, null);
        const ten = crossings.total();
        crossings.reset();
        populate(runtime, 100, 1);
        crossings.reset();
        frame(runtime, null);
        const hundred = crossings.total();

        expect(ten).toBe(20);
        expect(hundred, 'posing stopped being two calls per entity').toBe(200);
        runtime.dispose();
    });

    it('reading a pose back is 2 + 3 per batch, per entity, per frame', () => {
        // The pose itself is two more, which this counts but does not attribute
        // to the readback: they are the frame's other half.
        // The number a batch ABI would change: today the walk asks how many
        // batches, then three questions per batch, and allocates twice per batch
        // — all of it per entity.
        const { module, crossings } = counting(module38);
        const runtime = new SpineRuntime('3.8', module);
        const core = countingCore();
        populate(runtime, 1, 1);
        frame(runtime, core);

        crossings.reset();
        const { batches } = frame(runtime, core);
        const c = crossings.counts;

        expect(batches).toBeGreaterThan(0);
        expect(c.get('spine_advanceAndApply')).toBe(1);
        expect(c.get('spine_materializeWorldPose'), 'the world was resolved more than once')
            .toBe(1);
        expect(c.get('spine_getMeshBatchCount')).toBe(1);
        expect(c.get('spine_getMeshBatchVertexCount')).toBe(batches);
        expect(c.get('spine_getMeshBatchIndexCount')).toBe(batches);
        expect(c.get('spine_getMeshBatchData')).toBe(batches);
        // Two allocations per batch (vertices + indices) plus the meta pair.
        expect(c.get('_malloc')).toBe(1 + batches * 2);
        // The formula, for the wall: 5 fixed + 7 per batch, per entity, per
        // frame. It was 4 while a pose was one call. A batch ABI is a change to
        // THIS; so was splitting the pose, deliberately.
        expect(crossings.total()).toBe(5 + 7 * batches);
        runtime.dispose();
    });

    it('the whole frame is linear in entities, and nothing amortizes', () => {
        // What the baseline is FOR: at 1000 entities this is the frame's shape.
        // Any per-frame saving has to come from crossing fewer times per entity,
        // because nothing here is shared between them.
        const { module, crossings } = counting(module38);
        const runtime = new SpineRuntime('3.8', module);
        const core = countingCore();

        populate(runtime, 1, 1);
        frame(runtime, core);
        crossings.reset();
        frame(runtime, core);
        const one = crossings.total();

        populate(runtime, 100, 1);
        frame(runtime, core);
        crossings.reset();
        frame(runtime, core);
        const hundred = crossings.total();

        expect(hundred).toBe(one * 100);
        runtime.dispose();
    });

    it('sharing an era saves parses and memory, not one crossing per frame', () => {
        // Worth knowing before optimising the wrong thing: residency sharing is
        // a load-time and footprint win. The frame costs the same either way.
        const { module, crossings } = counting(module38);
        const runtime = new SpineRuntime('3.8', module);
        const core = countingCore();

        populate(runtime, 50, 1);
        frame(runtime, core);
        crossings.reset();
        frame(runtime, core);
        const shared = crossings.total();
        runtime.dispose();

        const apart = counting(module38);
        const second = new SpineRuntime('3.8', apart.module);
        populate(second, 50, 50);
        frame(second, core);
        apart.crossings.reset();
        frame(second, core);

        expect(apart.crossings.total()).toBe(shared);
        second.dispose();
    });
});
