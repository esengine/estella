// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-clip-stages.bench.ts
 * @brief   What clipping costs, against the geometry that decides it.
 *
 * @details coin says clip-heavy Spine is clipping-bound — 2.48 ms of its 2.53 —
 *          and nothing more, because its 39-vertex polygon, its clipped
 *          attachments and its triangle count all move together. So the fixtures
 *          here are authored: the same strip of quads every time, with only the
 *          clip polygon's SHAPE or its RELATION to the strip changing.
 *
 *          Two depths bracket it. S_start opens the region — the polygon made
 *          clockwise and decomposed into convex pieces — and cuts nothing;
 *          S_clip cuts. Their difference is the cut, and S_start minus the
 *          depth below it is what a clip region costs before any triangle.
 *
 *          Fixtures are asserted in tests/spine-clip-stages, which is what makes
 *          "few cross" and "all cross" mean anything. `SPINE_CLIP_REPORT=1`
 *          prints the counters each row was measured on.
 *
 *          What it answered, µs per entity per frame (min of two runs):
 *
 *              case            edges  inTri | open    cut   store | ns/(tri*edge)
 *              all outside         5     32 | 0.064  1.604  0.005 |     10.0
 *              all inside          5     32 | 0.068  2.032  0.065 |     12.7
 *              one quad crossing   5     32 | 0.067  1.706  0.100 |     10.7
 *              every quad cross    5     32 | 0.065  2.259  0.166 |     14.1
 *              convex 8            9     32 | 0.158  4.075  0.171 |     14.1
 *              convex 16          17     32 | 0.406  7.752  0.101 |     14.2
 *              concave 8          15     32 | 0.208  6.494  0.338 |     13.5
 *              concave 16         41     32 | 0.716 16.559  0.918 |     12.6
 *              coin               40      2 | 2.001  2.055  0.111 |     25.7
 *
 *          Storing the result is never the term: 5% of a clip at worst, and the
 *          clipper's own scratch stops growing after one shape.
 *
 *          Where the triangles fall barely is one either. Same triangles, same
 *          polygon: geometry that clips away to NOTHING costs 71% of geometry
 *          that is entirely cut. Being inside a clip region is the tax; crossing
 *          its boundary is a surcharge on top.
 *
 *          The axis is the polygon's EDGES, because the cut runs one pass per
 *          edge per triangle: 14 ns x inputTriangles x edges holds within 10%
 *          from 5 edges to 41. Concave sits on the same line rather than a worse
 *          one — decomposition just multiplies the edges (an 8-point star
 *          becomes 3 pieces and 15 edges, a 16-point one 9 pieces and 41).
 *
 *          Opening the region is a separate, super-linear term in the ORIGINAL
 *          vertex count: 0.065 / 0.158 / 0.406 / 2.001 µs at 4 / 8 / 16 / 39
 *          vertices. For coin that is HALF its clipping cost — to prepare a
 *          polygon that goes on to cut two triangles.
 */
import { describe, bench, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from '../tests/helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { withScratch } from '../src/wasm/wasmScratch';
import { syntheticSkeleton } from '../tests/helpers/syntheticSpine';
import type { SyntheticOptions } from '../tests/helpers/syntheticSpine';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const HAS_WASM = existsSync(SPINE38_WASM);

const ENTITIES = 200;
const FRAMES = 20;
const QUADS = 16;

const STAGE_VERTICES = 2;
const STAGE_CLIP_START = 3;
const STAGE_CLIP = 4;
const STAGE_EMIT = 5;

/** Same strip, same 512 input triangles; only where the boundary falls moves. */
const RELATIONS: Array<{ name: string; options: SyntheticOptions }> = [
    { name: 'all inside', options: { quads: QUADS, relation: 'inside' } },
    { name: 'all outside', options: { quads: QUADS, relation: 'outside' } },
    { name: 'one quad crossing', options: { quads: QUADS, relation: 'one-crossing' } },
    { name: 'every quad crossing', options: { quads: QUADS, relation: 'all-crossing' } },
];

/** Same relation, same triangles; only the polygon's own complexity moves. */
const POLYGONS: Array<{ name: string; options: SyntheticOptions }> = [
    { name: 'convex 4', options: { quads: QUADS, relation: 'all-crossing', polygonVertices: 4 } },
    { name: 'convex 8', options: { quads: QUADS, relation: 'all-crossing', polygonVertices: 8 } },
    { name: 'convex 16', options: { quads: QUADS, relation: 'all-crossing', polygonVertices: 16 } },
    { name: 'concave 8', options: { quads: QUADS, relation: 'all-crossing', polygonVertices: 8, concave: true } },
    { name: 'concave 16', options: { quads: QUADS, relation: 'all-crossing', polygonVertices: 16, concave: true } },
];

/** The shipped asset the model has to explain, in the same harness. */
const REAL: Array<{ name: string; skel: string; atlas: string }> = [
    { name: 'coin (39-vertex polygon)', skel: 'coin-38/coin-pro.skel', atlas: 'coin-38/coin.atlas' },
];
const FIXTURES = resolve(__dirname, 'fixtures/spine');

const CASES = [...RELATIONS, ...POLYGONS,
    ...REAL.filter((r) => existsSync(resolve(FIXTURES, r.skel))).map((r) => ({ name: r.name, real: r }))];
const COUNTERS = [
    'slots', 'regions', 'meshes', 'clipStarts', 'clippedEmits',
    'vGenerated', 'vEmitted', 'iEmitted', 'emits',
    'polygons', 'polygonVertices', 'polygonEdges', 'inTriangles', 'outTriangles',
] as const;

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
const instances = new Map<string, number[]>();

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

    for (const test of CASES) {
        const real = 'real' in test ? test.real : null;
        const skelData = real
            ? new Uint8Array(readFileSync(resolve(FIXTURES, real.skel)))
            : new TextEncoder().encode(syntheticSkeleton(test.options).json);
        const atlas = real
            ? readFileSync(resolve(FIXTURES, real.atlas), 'utf-8')
            : syntheticSkeleton(test.options).atlas;
        const handle = withScratch(raw, (alloc) => {
            const ptr = alloc(skelData.length);
            raw.HEAPU8.set(skelData, ptr);
            return api.loadSkeleton(ptr, skelData.length, atlas, atlas.length, real !== null);
        });
        if (handle < 0) throw new Error(`${test.name}: ${api.getLastError()}`);
        for (let i = 0, pages = api.getAtlasPageCount(handle); i < pages; i++) {
            api.setAtlasPageTexture(handle, i, 1, 1024, 1024);
        }
        const ids: number[] = [];
        for (let i = 0; i < ENTITIES; i++) {
            const id = api.createInstance(handle);
            if (real) {
                const [first] = JSON.parse(api.getAnimations(id)) as string[];
                if (!api.playAnimation(id, first, true, 0)) throw new Error(`${test.name}: no "${first}"`);
            }
            api.update(id, real ? 0.35 : 0);
            ids.push(id);
        }
        instances.set(test.name, ids);
    }

    if (process.env.SPINE_CLIP_REPORT) report();
});

function countsOf(instanceId: number): Record<string, number> {
    api.probeExtract(instanceId, STAGE_EMIT, 1);
    return withScratch(raw, (alloc) => {
        const ptr = alloc(COUNTERS.length * 4);
        api.probeCounts(ptr);
        const out: Record<string, number> = {};
        COUNTERS.forEach((name, i) => { out[name] = raw.HEAPU32[(ptr >> 2) + i]; });
        return out;
    });
}

/** The geometry behind each row, so a millisecond can be read against it. */
function report(): void {
    const rows = CASES.map((test) => {
        const c = countsOf(instances.get(test.name)![0]);
        return {
            case: test.name, polygons: c.polygons, polyVerts: c.polygonVertices,
            edges: c.polygonEdges, inTri: c.inTriangles, outTri: c.outTriangles,
            amplification: (c.outTriangles / Math.max(1, c.inTriangles)).toFixed(2),
            outVerts: c.vEmitted,
        };
    });
    const keys = Object.keys(rows[0]);
    const width = (k: string) => Math.max(k.length, ...rows.map((r) => String((r as never)[k]).length));
    const line = (cells: unknown[]) => cells.map((c, i) => String(c).padStart(width(keys[i]))).join('  ');
    console.log(line(keys));
    for (const row of rows) console.log(line(keys.map((k) => (row as never)[k])));
    console.log('clipper scratch:', withScratch(raw, (alloc) => {
        const ptr = alloc(6 * 4);
        api.probeClipStorage(ptr);
        return Array.from({ length: 6 }, (_, i) => raw.HEAPU32[(ptr >> 2) + i]).join(' ');
    }));
}

function pass(name: string, stage: number): void {
    const ids = instances.get(name)!;
    for (let f = 0; f < FRAMES; f++) {
        for (const id of ids) api.probeExtract(id, stage, 1);
    }
}

describe.skipIf(!HAS_WASM)(`Spine clip stages: ${ENTITIES} entities x${FRAMES}`, () => {
    for (const test of CASES) {
        bench(`S2 vertices, no clip region — ${test.name}`, () => { pass(test.name, STAGE_VERTICES); });
        bench(`S3 + open the region — ${test.name}`, () => { pass(test.name, STAGE_CLIP_START); });
        bench(`S4 + cut the triangles — ${test.name}`, () => { pass(test.name, STAGE_CLIP); });
        bench(`S5 + store the result — ${test.name}`, () => { pass(test.name, STAGE_EMIT); });
    }
});
