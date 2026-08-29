// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-clip-stages.test.ts
 * @brief   The synthetic clip fixtures are the geometry they claim to be.
 *
 * @details A cost model built on "few triangles cross" is worth nothing if the
 *          fixture that was supposed to make few triangles cross made all of
 *          them. Each relation is held here to what the clipper reports it did,
 *          and the counters that model is fitted from are held to the shapes
 *          they count.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { withScratch } from '../src/wasm/wasmScratch';
import { syntheticSkeleton } from './helpers/syntheticSpine';
import type { SyntheticOptions } from './helpers/syntheticSpine';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const HAS_WASM = existsSync(SPINE38_WASM);

/** The thirteen counters `spine_probe_counts` writes, in order. */
const COUNTERS = [
    'slots', 'regionAttachments', 'meshAttachments', 'clipStarts', 'clippedEmits',
    'verticesGenerated', 'verticesEmitted', 'indicesEmitted', 'emits',
    'clipPolygons', 'clipPolygonVertices', 'clipPolygonEdges', 'clipInputTriangles', 'clipOutputTriangles',
    'clipBoundsRejects', 'clipInsideAccepts',
] as const;
type Counts = Record<(typeof COUNTERS)[number], number>;
const STAGE_EMIT = 5;
const QUADS = 16;

let raw: SpineWasmModule;
let api: SpineWrappedAPI;

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
});

function instanceOf(options: SyntheticOptions): number {
    const { json, atlas } = syntheticSkeleton(options);
    const skelData = new TextEncoder().encode(json);
    const handle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlas, atlas.length, false);
    });
    if (handle < 0) throw new Error(api.getLastError());
    for (let i = 0, pages = api.getAtlasPageCount(handle); i < pages; i++) {
        api.setAtlasPageTexture(handle, i, 1, 64, 64);
    }
    const instanceId = api.createInstance(handle);
    api.update(instanceId, 0);
    return instanceId;
}

function countsOf(instanceId: number): Counts {
    api.probeExtract(instanceId, STAGE_EMIT, 1);
    return withScratch(raw, (alloc) => {
        const ptr = alloc(COUNTERS.length * 4);
        api.probeCounts(ptr);
        const out = {} as Counts;
        COUNTERS.forEach((name, i) => { out[name] = raw.HEAPU32[(ptr >> 2) + i]; });
        return out;
    });
}

describe.skipIf(!HAS_WASM)('the synthetic clip fixtures are what they claim', () => {
    it('a strip of quads is the triangles it says it is', () => {
        const c = countsOf(instanceOf({ quads: QUADS, relation: 'one-crossing' }));
        expect(c.meshAttachments).toBe(1);
        expect(c.clipStarts).toBe(1);
        expect(c.clipInputTriangles, 'a quad is two triangles').toBe(QUADS * 2);
    });

    it('a boundary that ends inside one quad crosses only that one', () => {
        const c = countsOf(instanceOf({ quads: QUADS, relation: 'one-crossing' }));
        // Half the strip survives whole; the quad the edge ends in comes back as
        // a fan, so the total is a little over half the input.
        expect(c.clipOutputTriangles).toBeGreaterThan(QUADS);
        expect(c.clipOutputTriangles).toBeLessThan(QUADS * 2);
    });

    it('a band across the whole strip crosses every quad', () => {
        const one = countsOf(instanceOf({ quads: QUADS, relation: 'one-crossing' }));
        const all = countsOf(instanceOf({ quads: QUADS, relation: 'all-crossing' }));
        expect(all.clipInputTriangles).toBe(one.clipInputTriangles);
        // Every triangle is cut and re-triangulated, so this is the relation that
        // amplifies: more output than went in, from the same input.
        expect(all.clipOutputTriangles).toBeGreaterThan(all.clipInputTriangles);
        expect(all.clipOutputTriangles).toBeGreaterThan(one.clipOutputTriangles);
    });

    it('a convex polygon is one piece and a concave one is several', () => {
        const convex = countsOf(instanceOf({ quads: QUADS, relation: 'all-crossing', polygonVertices: 8 }));
        const concave = countsOf(instanceOf({
            quads: QUADS, relation: 'all-crossing', polygonVertices: 8, concave: true,
        }));
        expect(convex.clipPolygonVertices).toBe(8);
        expect(concave.clipPolygonVertices).toBe(8);
        expect(convex.clipPolygons, 'a convex polygon needed decomposing').toBe(1);
        expect(concave.clipPolygons, 'a concave polygon came back as one piece').toBeGreaterThan(1);
        expect(concave.clipPolygonEdges).toBeGreaterThan(convex.clipPolygonEdges);
    });

    it('the clipper stops growing its own scratch once a shape has run', () => {
        const instanceId = instanceOf({ quads: QUADS, relation: 'all-crossing' });
        const storage = () => withScratch(raw, (alloc) => {
            const ptr = alloc(6 * 4);
            api.probeClipStorage(ptr);
            return Array.from({ length: 6 }, (_, i) => raw.HEAPU32[(ptr >> 2) + i]);
        });
        countsOf(instanceId);
        const warm = storage();
        expect(warm.some((c) => c > 0), 'the clipper reports no scratch at all').toBe(true);

        for (let frame = 0; frame < 5; frame++) countsOf(instanceId);
        expect(storage(), 'the clipper grew its scratch again on a steady shape').toEqual(warm);
    });
});

describe.skipIf(!HAS_WASM)('the clip fast paths answer without cutting', () => {
    it('a region the strip is not in is rejected on bounds alone', () => {
        const c = countsOf(instanceOf({ quads: QUADS, relation: 'outside' }));
        expect(c.clipBoundsRejects).toBe(1);
        expect(c.clipInputTriangles, 'the clipper ran on geometry that cannot survive').toBe(0);
        expect(c.emits, 'geometry that clipped away still reached the sink').toBe(0);
    });

    it('a strip wholly inside a convex region keeps its own topology', () => {
        const c = countsOf(instanceOf({ quads: QUADS, relation: 'inside' }));
        expect(c.clipInsideAccepts).toBe(1);
        expect(c.clipInputTriangles, 'the clipper ran on geometry it cannot change').toBe(0);
        // The whole point of the second path: the clipper rebuilds every triangle
        // from its own three vertices, and a mesh that shared them stops sharing.
        // 34 vertices went in and 34 come out, not 96.
        expect(c.verticesEmitted).toBe(c.verticesGenerated);
        expect(c.indicesEmitted).toBe(QUADS * 2 * 3);
    });

    it('a strip wholly inside a CONCAVE region is still cut', () => {
        // Three vertices inside a concave polygon do not put the triangle inside
        // it, so this path is convex-only on purpose; nothing being removed is
        // what says the fixture really is within the region.
        const c = countsOf(instanceOf({
            quads: QUADS, relation: 'inside', polygonVertices: 16, concave: true,
        }));
        expect(c.clipPolygons, 'the fixture is not concave any more').toBeGreaterThan(1);
        expect(c.clipInsideAccepts, 'a concave region took the convex fast path').toBe(0);
        expect(c.clipOutputTriangles, 'the fixture is not wholly inside after all')
            .toBe(c.clipInputTriangles);
        expect(c.verticesEmitted, 'the slow path kept the sharing it cannot keep')
            .toBe(c.clipOutputTriangles * 3);
    });

    it('a concave region cuts geometry that is entirely within it', () => {
        // The strip spans x -400..400, the notch is at x 600..1000: nothing of
        // the strip is outside the region, and it is still cut, because the
        // pieces it decomposes into have boundaries the strip crosses.
        const c = countsOf(instanceOf({ quads: QUADS, relation: 'notched' }));
        expect(c.clipPolygons, 'the notch did not make it concave').toBeGreaterThan(1);
        expect(c.clipBoundsRejects).toBe(0);
        expect(c.clipInsideAccepts, 'a concave region took the convex fast path').toBe(0);
        expect(c.clipInputTriangles).toBe(QUADS * 2);
        expect(c.clipOutputTriangles).toBeGreaterThan(c.clipInputTriangles);
    });

    it('a shipped asset spends a frame cutting geometry that cannot survive', () => {
        // spineboy's portal animation opens a clip region its whole body is
        // outside of: 339 triangles a frame, cut to produce nothing. The bounds
        // test earns its place on a shipped asset, not only an authored one.
        const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel')));
        const atlasText = readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy.atlas'), 'utf-8');
        const handle = withScratch(raw, (alloc) => {
            const ptr = alloc(skelData.length);
            raw.HEAPU8.set(skelData, ptr);
            return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
        });
        api.setAtlasPageTexture(handle, 0, 1, 2048, 2048);
        const instanceId = api.createInstance(handle);
        expect(api.playAnimation(instanceId, 'portal', true, 0)).toBeTruthy();
        api.update(instanceId, 0.3);

        const c = countsOf(instanceId);
        expect(c.clipStarts).toBe(1);
        expect(c.clipBoundsRejects, 'nothing was rejected on bounds').toBeGreaterThan(10);
        expect(c.clipInputTriangles, 'the cut still ran on geometry that cannot survive').toBe(0);
    });

    it('a region that is met, not missed, still goes through the cut', () => {
        for (const relation of ['one-crossing', 'all-crossing'] as const) {
            const c = countsOf(instanceOf({ quads: QUADS, relation }));
            expect(c.clipBoundsRejects, `${relation} was rejected on bounds`).toBe(0);
            expect(c.clipInsideAccepts, `${relation} was accepted as inside`).toBe(0);
            expect(c.clipInputTriangles, `${relation} skipped the cut`).toBe(QUADS * 2);
        }
    });
});
