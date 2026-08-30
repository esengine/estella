// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-clip-start.test.ts
 * @brief   The staged open is the shipped open, on the shapes it says it is.
 *
 * @details The ladder in benchmarks/spine-clip-start runs the same sequence the
 *          shipped `clipStart` runs, one call at a time — and it had to
 *          transcribe spine's `_makeClockwise`, which is static there. A wrong
 *          transcription would hand the triangulator the opposite winding and
 *          quietly measure a different algorithm, so the full depth is held to
 *          what the shipped path produces.
 *
 *          The rest is the axis: a benchmark that says "39 vertices" while
 *          running a four-vertex polygon would fit a curve through nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { Entity } from '../src/types';
import { withScratch } from '../src/wasm/wasmScratch';
import { syntheticSkeleton } from './helpers/syntheticSpine';
import type { SyntheticOptions } from './helpers/syntheticSpine';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const HAS_WASM = hasSideModule('spine38');

const CLIP_START_FULL = 6;
const STAGE_EMIT = 5;
/** The five counts `spine_probe_clip_start_counts` writes before the bounds. */
const COUNTERS = ['rawVertices', 'triangles', 'pieces', 'effectiveEdges', 'scratch'] as const;
type Counts = Record<(typeof COUNTERS)[number], number>;
/** Where `clipPolygons` and `clipPolygonEdges` sit in the extraction's counters. */
const PRODUCTION_PIECES = 9;
const PRODUCTION_EDGES = 11;

const POLYGON = (polygonVertices: number, concave = false): SyntheticOptions =>
    ({ quads: 4, relation: 'inside', polygonVertices, concave });

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
    api.setAtlasPageTexture(handle, 0, 1, 64, 64);
    const instanceId = api.createInstance(handle);
    api.update(instanceId, 0);
    return instanceId;
}

function stagedOpen(instanceId: number, stage = CLIP_START_FULL): Counts & { bounds: number[] } {
    expect(api.probeClipStart(instanceId, stage), 'the instance has no clip region').toBe(1);
    return withScratch(raw, (alloc) => {
        const ptr = alloc(9 * 4);
        api.probeClipStartCounts(ptr);
        const out = {} as Counts & { bounds: number[] };
        COUNTERS.forEach((name, i) => { out[name] = raw.HEAPU32[(ptr >> 2) + i]; });
        out.bounds = [5, 6, 7, 8].map((i) => raw.HEAPF32[(ptr >> 2) + i]);
        return out;
    });
}

/** What the SHIPPED clipStart made of the same polygon. */
function production(instanceId: number): { pieces: number; effectiveEdges: number } {
    api.probeExtract(instanceId, STAGE_EMIT, 1);
    return withScratch(raw, (alloc) => {
        const ptr = alloc(22 * 4);
        api.probeCounts(ptr);
        return {
            pieces: raw.HEAPU32[(ptr >> 2) + PRODUCTION_PIECES],
            effectiveEdges: raw.HEAPU32[(ptr >> 2) + PRODUCTION_EDGES],
        };
    });
}

const SHAPES = [
    { name: 'convex 4', options: POLYGON(4), vertices: 4, pieces: 1 },
    { name: 'convex 8', options: POLYGON(8), vertices: 8, pieces: 1 },
    { name: 'convex 16', options: POLYGON(16), vertices: 16, pieces: 1 },
    { name: 'convex 39', options: POLYGON(39), vertices: 39, pieces: 1 },
    { name: 'concave 8', options: POLYGON(8, true), vertices: 8, pieces: 3 },
    { name: 'concave 16', options: POLYGON(16, true), vertices: 16, pieces: 9 },
    { name: 'concave 39', options: POLYGON(39, true), vertices: 39, pieces: 27 },
];

describe.skipIf(!HAS_WASM)('the staged open is the shipped open', () => {
    it.each(SHAPES)('$name: the last depth is what clipStart produces', (shape) => {
        const instanceId = instanceOf(shape.options);
        const staged = stagedOpen(instanceId);
        const shipped = production(instanceId);

        expect(staged.pieces, 'the ladder decomposed to a different shape').toBe(shipped.pieces);
        expect(staged.effectiveEdges).toBe(shipped.effectiveEdges);
        expect(staged.bounds[2]).toBeGreaterThan(staged.bounds[0]);
        expect(staged.bounds[3]).toBeGreaterThan(staged.bounds[1]);
    });

    it.each(SHAPES)('$name: the ladder ran the polygon it says it ran', (shape) => {
        // A curve fitted through a benchmark that quietly ran a four-vertex
        // polygon for every row would look just as convincing.
        const staged = stagedOpen(instanceOf(shape.options));
        expect(staged.rawVertices).toBe(shape.vertices);
        expect(staged.triangles, 'an n-gon triangulates into n-2').toBe(shape.vertices - 2);
        expect(staged.pieces).toBe(shape.pieces);
    });

    it('the same authored count decomposes differently when it is concave', () => {
        const convex = stagedOpen(instanceOf(POLYGON(16)));
        const concave = stagedOpen(instanceOf(POLYGON(16, true)));

        expect(convex.rawVertices).toBe(concave.rawVertices);
        expect(convex.triangles, 'both triangulate into the same count').toBe(concave.triangles);
        expect(convex.pieces).toBe(1);
        expect(concave.pieces).toBeGreaterThan(1);
        expect(concave.effectiveEdges).toBeGreaterThan(convex.effectiveEdges);
    });

    it('coin opens the same way a synthetic 39-gon does', () => {
        // The witness that any of this reaches a shipped asset — and the reason
        // the curve is fitted on the synthetic ladder rather than on coin: coin
        // is one polygon at one pose, which is a point, not a slope.
        const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'coin-38/coin-pro.skel')));
        const atlasText = readFileSync(resolve(FIXTURES, 'coin-38/coin.atlas'), 'utf-8');
        const handle = withScratch(raw, (alloc) => {
            const ptr = alloc(skelData.length);
            raw.HEAPU8.set(skelData, ptr);
            return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
        });
        api.setAtlasPageTexture(handle, 0, 1, 1024, 1024);
        const instanceId = api.createInstance(handle);
        api.playAnimation(instanceId, 'animation', true, 0);
        api.update(instanceId, 0.35);

        const coin = stagedOpen(instanceId);
        expect(coin.rawVertices).toBe(39);
        expect(coin.pieces, 'coin is concave').toBe(1);
        expect(coin.effectiveEdges).toBe(40);
        expect(coin).toMatchObject(
            { rawVertices: 39, triangles: 37, pieces: 1, effectiveEdges: 40 });
    });

    it('a frame opens no clip region through the probe', () => {
        // The ladder and the budget both pose; neither may be on a frame path.
        const probed: string[] = [];
        const cwrap = raw.cwrap.bind(raw);
        const watched = Object.create(raw) as SpineWasmModule;
        watched.cwrap = ((name: string, ret: unknown, args: unknown) => {
            const fn = cwrap(name, ret as never, args as never);
            return (...called: unknown[]) => {
                if (name.startsWith('spine_probe') || name === 'spine_clipBudget') probed.push(name);
                return (fn as (...a: unknown[]) => unknown)(...called);
            };
        }) as never;

        const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'coin-38/coin-pro.skel')));
        const atlasText = readFileSync(resolve(FIXTURES, 'coin-38/coin.atlas'), 'utf-8');
        const era: SpineEraBinding = {
            id: 'clip-start#1',
            value: { skelData, atlasText, isBinary: true, textures: new Map() },
            pair: { skeleton: 'clip-start.skel', atlas: 'clip-start.atlas' },
            retain: () => ({ release: () => {} }),
        };
        const runtime = new SpineRuntime('3.8', watched);
        runtime.loadEntity(1 as Entity, era);
        runtime.setAnimation(1 as Entity, 'animation', true);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes({
            renderer_submitSkeletalBatchByEntity: () => {},
            _malloc: () => 0, _free: () => {}, HEAPU8: new Uint8Array(1 << 20),
        } as never, {} as never);

        expect(probed, 'a diagnostic is on the frame path').toEqual([]);
        runtime.dispose();
    });
});
