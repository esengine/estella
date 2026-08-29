// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-clip-start.bench.ts
 * @brief   Why opening a clip region costs 0.4 µs at sixteen vertices and 2.0 at
 *          thirty-nine.
 *
 * @details Half of coin's clipping is spent before a triangle is cut, and the
 *          growth is not linear in the vertex count. `clipStart` is a sequence
 *          of separable calls — world vertices, winding, triangulate, decompose,
 *          finish each piece — so this runs it to six depths and subtracts,
 *          which prices a step without a clock inside the step.
 *
 *          The convex ladder is the one that decides it. If a 39-vertex polygon
 *          that decomposes to ONE piece is already superlinear, the answer is in
 *          preparation, not in the concavity everyone would blame. coin is here
 *          as the witness that any of it matters on a shipped asset, not as a
 *          point to fit the curve through: it has one polygon and one pose.
 *
 *          `SPINE_CLIP_START_REPORT=1` prints the counters each row ran on, and
 *          tests/spine-clip-start holds the last depth to what the shipped
 *          `clipStart` produces — the ladder had to transcribe spine's static
 *          `_makeClockwise`, and the opposite winding would measure another
 *          algorithm without saying so.
 *
 *          What it answered, µs per open (min of two runs):
 *
 *              case         world  wind  triangulate  decomp  pieces  total
 *              convex 4     0.004 0.003        0.021   0.029   0.006  0.062
 *              convex 8     0.006 0.004        0.082   0.048   0.007  0.150
 *              convex 16    0.010 0.008        0.270   0.085   0.002  0.387
 *              convex 39    0.009 0.027        1.724   0.192   0.051  2.007
 *              concave 16   0.011 0.009        0.318   0.305   0.028  0.680
 *              concave 39   0.010 0.030        2.011   1.649   0.066  3.733
 *              coin         0.009 0.024        1.732   0.217  -0.036  2.015
 *
 *          Triangulating the polygon is 86% of it at thirty-nine vertices, and
 *          it is quadratic: 1.05 to 1.33 ns per n² across the whole ladder,
 *          convex and concave alike. Computing the world vertices — the step a
 *          deforming clip attachment would make expensive — is 0.4%.
 *
 *          The convex ladder is what makes that actionable. A 39-vertex polygon
 *          that decomposes to ONE piece still pays 1.72 µs to be ear-clipped
 *          into 37 triangles, and the only consumer of those triangles is a
 *          decomposition whose answer is the polygon itself.
 *
 *          Concavity's share of the OPEN is the decomposition, not the
 *          triangulation: 0.085 -> 0.305 µs at sixteen vertices, 0.192 -> 1.649
 *          at thirty-nine. So a concave polygon pays at both ends — here, and
 *          again per triangle through the effective edges it multiplies.
 *
 *          coin lands on the synthetic 39-gon to within 0.4%, which is what says
 *          none of this is an artefact of authored shapes.
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
const FIXTURES = resolve(__dirname, 'fixtures/spine');
const HAS_WASM = existsSync(SPINE38_WASM);

const OPENS = 2000;
const STAGES = [
    { depth: 0, label: 'C0 scratch sized' },
    { depth: 1, label: 'C1 + world vertices' },
    { depth: 2, label: 'C2 + winding' },
    { depth: 3, label: 'C3 + triangulate' },
    { depth: 4, label: 'C4 + decompose' },
    { depth: 5, label: 'C5 + finish each piece' },
    { depth: 6, label: 'C6 + publish bounds' },
] as const;

/** The polygon is the whole experiment; the strip it clips is incidental. */
const POLYGON = (polygonVertices: number, concave = false): SyntheticOptions =>
    ({ quads: 4, relation: 'inside', polygonVertices, concave });

const CASES: Array<{ name: string; options?: SyntheticOptions; skel?: string; atlas?: string }> = [
    { name: 'convex 4', options: POLYGON(4) },
    { name: 'convex 8', options: POLYGON(8) },
    { name: 'convex 16', options: POLYGON(16) },
    { name: 'convex 39', options: POLYGON(39) },
    { name: 'concave 8', options: POLYGON(8, true) },
    { name: 'concave 16', options: POLYGON(16, true) },
    { name: 'concave 39', options: POLYGON(39, true) },
    { name: 'coin', skel: 'coin-38/coin-pro.skel', atlas: 'coin-38/coin.atlas' },
];

const COUNTERS = ['rawVertices', 'triangles', 'pieces', 'effectiveEdges', 'scratch'] as const;

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
const instances = new Map<string, number>();

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
        const real = test.skel !== undefined;
        if (real && !existsSync(resolve(FIXTURES, test.skel!))) continue;
        const skelData = real
            ? new Uint8Array(readFileSync(resolve(FIXTURES, test.skel!)))
            : new TextEncoder().encode(syntheticSkeleton(test.options!).json);
        const atlas = real
            ? readFileSync(resolve(FIXTURES, test.atlas!), 'utf-8')
            : syntheticSkeleton(test.options!).atlas;
        const handle = withScratch(raw, (alloc) => {
            const ptr = alloc(skelData.length);
            raw.HEAPU8.set(skelData, ptr);
            return api.loadSkeleton(ptr, skelData.length, atlas, atlas.length, real);
        });
        if (handle < 0) throw new Error(`${test.name}: ${api.getLastError()}`);
        for (let i = 0, pages = api.getAtlasPageCount(handle); i < pages; i++) {
            api.setAtlasPageTexture(handle, i, 1, 2048, 2048);
        }
        const instanceId = api.createInstance(handle);
        if (real) {
            const [first] = JSON.parse(api.getAnimations(instanceId)) as string[];
            if (!api.playAnimation(instanceId, first, true, 0)) throw new Error(`${test.name}: no "${first}"`);
        }
        api.update(instanceId, real ? 0.35 : 0);
        if (!api.probeClipStart(instanceId, 6)) throw new Error(`${test.name}: no clip region`);
        instances.set(test.name, instanceId);
    }

    if (process.env.SPINE_CLIP_START_REPORT) report();
});

function countsOf(): Record<string, number> {
    return withScratch(raw, (alloc) => {
        const ptr = alloc(9 * 4);
        api.probeClipStartCounts(ptr);
        const out: Record<string, number> = {};
        COUNTERS.forEach((name, i) => { out[name] = raw.HEAPU32[(ptr >> 2) + i]; });
        return out;
    });
}

function report(): void {
    const rows = [...instances.keys()].map((name) => {
        api.probeClipStart(instances.get(name)!, 6);
        const c = countsOf();
        return {
            case: name, ...c,
            edgesPerVertex: (c.effectiveEdges / Math.max(1, c.rawVertices)).toFixed(2),
        };
    });
    const keys = Object.keys(rows[0]);
    const width = (k: string) => Math.max(k.length, ...rows.map((r) => String((r as never)[k]).length));
    const line = (cells: unknown[]) => cells.map((c, i) => String(c).padStart(width(keys[i]))).join('  ');
    console.log(line(keys));
    for (const row of rows) console.log(line(keys.map((k) => (row as never)[k])));
}

function pass(name: string, depth: number): void {
    const instanceId = instances.get(name)!;
    for (let i = 0; i < OPENS; i++) api.probeClipStart(instanceId, depth);
}

describe.skipIf(!HAS_WASM)(`Spine clip-start stages: x${OPENS} opens`, () => {
    for (const test of CASES) {
        for (const stage of STAGES) {
            bench(`${stage.label} — ${test.name}`, () => { pass(test.name, stage.depth); });
        }
    }
});
