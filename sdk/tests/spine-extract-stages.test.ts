// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-extract-stages.test.ts
 * @brief   The staged walk is the same walk — and it is not on a frame path.
 *
 * @details A decomposition is only worth acting on while its stages still add
 *          back to the thing they decompose. So the last stage is held to the
 *          production extraction's own output: same batches, same vertices, same
 *          indices, for the same pose. If the staged walk ever drifts from the
 *          shipped one, the numbers it produces stop meaning anything and this
 *          says so.
 *
 *          And the instrumentation must stay where it was put: a real frame
 *          crosses into the module eleven times per entity, and none of those
 *          crossings may be a probe.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { withScratch } from '../src/wasm/wasmScratch';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { Entity } from '../src/types';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const ASSETS = [
    { name: 'spineboy', skel: 'spineboy-38/spineboy-pro.skel', atlas: 'spineboy-38/spineboy.atlas' },
    { name: 'raptor', skel: 'raptor-38/raptor-pro.skel', atlas: 'raptor-38/raptor.atlas' },
    { name: 'coin', skel: 'coin-38/coin-pro.skel', atlas: 'coin-38/coin.atlas' },
];
const HAS_ASSETS = existsSync(SPINE38_WASM)
    && ASSETS.every((a) => existsSync(resolve(FIXTURES, a.skel)));

/** The nine counters `spine_probe_counts` writes, in order. */
const COUNTERS = [
    'slots', 'regionAttachments', 'meshAttachments', 'clipStarts', 'clippedEmits',
    'verticesGenerated', 'verticesEmitted', 'indicesEmitted', 'emits',
    'clipPolygons', 'clipPolygonVertices', 'clipPolygonEdges',
    'clipInputTriangles', 'clipOutputTriangles', 'clipBoundsRejects', 'clipInsideAccepts',
] as const;
type Counts = Record<(typeof COUNTERS)[number], number>;

const STAGE_EMIT = 5;

let raw: SpineWasmModule;
let api: SpineWrappedAPI;

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

});

function posed(asset: { skel: string; atlas: string }): { skelHandle: number; instanceId: number } {
    const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, asset.skel)));
    const atlasText = readFileSync(resolve(FIXTURES, asset.atlas), 'utf-8');
    const skelHandle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
    });
    for (let i = 0, pages = api.getAtlasPageCount(skelHandle); i < pages; i++) {
        api.setAtlasPageTexture(skelHandle, i, 1, 1024, 1024);
    }
    const instanceId = api.createInstance(skelHandle);
    const [first] = JSON.parse(api.getAnimations(instanceId)) as string[];
    if (!api.playAnimation(instanceId, first, true, 0)) throw new Error(`no animation "${first}"`);
    api.update(instanceId, 0.35);
    return { skelHandle, instanceId };
}

function countsOf(): Counts {
    return withScratch(raw, (alloc) => {
        const ptr = alloc(COUNTERS.length * 4);
        api.probeCounts(ptr);
        const out = {} as Counts;
        COUNTERS.forEach((name, i) => { out[name] = raw.HEAPU32[(ptr >> 2) + i]; });
        return out;
    });
}

/** What the SHIPPED path produced for the pose it is looking at. */
function production(instanceId: number): { batches: number; vertices: number; indices: number } {
    const batches = api.getMeshBatchCount(instanceId);
    let vertices = 0;
    let indices = 0;
    for (let b = 0; b < batches; b++) {
        vertices += api.getMeshBatchVertexCount(instanceId, b);
        indices += api.getMeshBatchIndexCount(instanceId, b);
    }
    return { batches, vertices, indices };
}

describe.skipIf(!HAS_ASSETS)('the staged walk is the shipped walk', () => {
    it.each(ASSETS)('$name: the last stage produces what a frame produces', (asset) => {
        const { instanceId } = posed(asset);

        const shipped = production(instanceId);
        expect(api.probeExtract(instanceId, STAGE_EMIT, 1)).toBe(1);
        const counts = countsOf();

        expect(counts.verticesEmitted, 'the staged walk drifted from the shipped one')
            .toBe(shipped.vertices);
        expect(counts.indicesEmitted).toBe(shipped.indices);
        // Emits are attachments; batches are what they were grouped into.
        expect(counts.emits).toBeGreaterThanOrEqual(shipped.batches);
        expect(shipped.batches).toBeGreaterThan(0);
    });

    it.each(ASSETS)('$name: what it counted explains what it produced', (asset) => {
        const { instanceId } = posed(asset);
        api.probeExtract(instanceId, STAGE_EMIT, 1);
        const c = countsOf();

        expect(c.slots).toBeGreaterThan(0);
        expect(c.regionAttachments + c.meshAttachments + c.clipStarts).toBeLessThanOrEqual(c.slots);
        expect(c.emits).toBeLessThanOrEqual(c.regionAttachments + c.meshAttachments);
        // Clipping is the only thing that can move emitted away from generated,
        // and it moves it EITHER way: the intersection comes back re-triangulated,
        // so coin emits 50 vertices for the 20 it generated.
        if (c.clippedEmits === 0) expect(c.verticesEmitted).toBe(c.verticesGenerated);
    });

    it('a frame makes no probe call at all', () => {
        // The instrumentation is a separate compile-time instantiation; this is
        // the half of that claim a test can see.
        const probed: string[] = [];
        const cwrap = raw.cwrap.bind(raw);
        const watched = Object.create(raw) as SpineWasmModule;
        watched.cwrap = ((name: string, ret: unknown, args: unknown) => {
            const fn = cwrap(name, ret as never, args as never);
            return (...called: unknown[]) => {
                if (name.startsWith('spine_probe')) probed.push(name);
                return (fn as (...a: unknown[]) => unknown)(...called);
            };
        }) as never;

        const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, ASSETS[0].skel)));
        const atlasText = readFileSync(resolve(FIXTURES, ASSETS[0].atlas), 'utf-8');
        const era: SpineEraBinding = {
            id: 'probe#1',
            value: { skelData, atlasText, isBinary: true, textures: new Map() },
            retain: () => ({ release: () => {} }),
        };
        const runtime = new SpineRuntime('3.8', watched);
        runtime.loadEntity(1 as Entity, era);
        runtime.setAnimation(1 as Entity, 'walk', true);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes({
            renderer_submitSkeletalBatchByEntity: () => {},
            _malloc: () => 0, _free: () => {}, HEAPU8: new Uint8Array(1 << 20),
        } as never, {} as never);

        expect(probed, 'the probe is on the frame path').toEqual([]);
        runtime.dispose();
    });

    it('the geometry each asset carries, for reading', () => {
        // What normalises the stage timings: a millisecond per frame means
        // nothing until it is a millisecond per this much geometry.
        const rows = ASSETS.map((asset) => {
            const { instanceId } = posed(asset);
            api.probeExtract(instanceId, STAGE_EMIT, 1);
            const c = countsOf();
            return {
                asset: asset.name, slots: c.slots,
                regions: c.regionAttachments, meshes: c.meshAttachments,
                clips: c.clipStarts, clipped: c.clippedEmits,
                generated: c.verticesGenerated, emitted: c.verticesEmitted,
                indices: c.indicesEmitted, batches: api.getMeshBatchCount(instanceId),
            };
        });
        if (process.env.SPINE_STAGE_REPORT) {
            const keys = Object.keys(rows[0]);
            const width = (k: string) => Math.max(k.length, ...rows.map((r) => String((r as never)[k]).length));
            const line = (cells: unknown[]) => cells.map((c, i) => String(c).padStart(width(keys[i]))).join('  ');
            console.log(line(keys));
            for (const row of rows) console.log(line(keys.map((k) => (row as never)[k])));
        }
        expect(rows).toHaveLength(3);
    });
});
