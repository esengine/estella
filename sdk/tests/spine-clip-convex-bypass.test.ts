// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-clip-convex-bypass.test.ts
 * @brief   A polygon proved convex is its own only piece — proved every frame,
 *          on the vertices that frame produced.
 *
 * @details The decomposition of a convex polygon is the polygon. Deriving that
 *          through an ear clip is quadratic and answering it directly is linear,
 *          so the proof replaces the derivation — and the whole risk lives in
 *          the proof. A false negative costs the work this was meant to skip; a
 *          false positive draws the wrong thing.
 *
 *          So the shapes that must be declined are here beside the ones that
 *          must be taken, and the polygon that starts convex and DEFORMS into a
 *          concave one is here to say the answer is not remembered. What is
 *          drawn is held byte-for-byte against a build without the bypass, in
 *          tests/spine-clip-parity.
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
const STAGE_EMIT = 5;
const QUADS = 8;

/** The counters this file reads, by their slot in `spine_probe_counts`. */
const PIECES = 9;
const EDGES = 11;
const BYPASSES = 22;
const DECOMPOSITIONS = 23;

const POLYGON = (polygonVertices: number, concave = false): SyntheticOptions =>
    ({ quads: QUADS, relation: 'all-crossing', polygonVertices, concave });

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

interface Opened { pieces: number; edges: number; bypasses: number; decompositions: number }

function opened(instanceId: number): Opened {
    api.probeExtract(instanceId, STAGE_EMIT, 1);
    return withScratch(raw, (alloc) => {
        const ptr = alloc(24 * 4);
        api.probeCounts(ptr);
        const at = ptr >> 2;
        return {
            pieces: raw.HEAPU32[at + PIECES],
            edges: raw.HEAPU32[at + EDGES],
            bypasses: raw.HEAPU32[at + BYPASSES],
            decompositions: raw.HEAPU32[at + DECOMPOSITIONS],
        };
    });
}

describe.skipIf(!HAS_WASM)('a convex region is its own only piece', () => {
    it.each([4, 8, 16, 39])('a convex %i-gon is opened without being triangulated', (vertices) => {
        const open = opened(instanceOf(POLYGON(vertices)));
        expect(open.bypasses).toBe(1);
        expect(open.decompositions, 'the ear clipper ran on a polygon already known convex').toBe(0);
        expect(open.pieces).toBe(1);
        expect(open.edges, 'the piece is the polygon, closed').toBe(vertices + 1);
    });

    it.each([8, 16, 39])('a concave %i-gon is still decomposed', (vertices) => {
        const open = opened(instanceOf(POLYGON(vertices, true)));
        expect(open.bypasses, 'a concave region took the convex path').toBe(0);
        expect(open.decompositions).toBe(1);
        expect(open.pieces).toBeGreaterThan(1);
    });

    it('a polygon that deforms from convex to concave is proved again each frame', () => {
        // The one that says nothing is remembered. Same attachment, same
        // instance: convex at rest, concave half a second later.
        const instanceId = instanceOf({ ...POLYGON(16), deformToConcave: true });
        expect(api.playAnimation(instanceId, 'idle', false, 0)).toBeTruthy();

        api.update(instanceId, 0);
        const rest = opened(instanceId);
        expect(rest.bypasses, 'the polygon is not convex at rest').toBe(1);
        expect(rest.pieces).toBe(1);

        api.update(instanceId, 0.5);
        const deformed = opened(instanceId);
        expect(deformed.bypasses, 'a remembered answer survived the deform').toBe(0);
        expect(deformed.decompositions).toBe(1);
        expect(deformed.pieces, 'the deform did not make it concave').toBeGreaterThan(1);
    });

    it('the same polygon authored either way round opens the same', () => {
        // Convexity is a property of the shape; the winding normalisation runs
        // before the proof, and this is what says the two are not coupled.
        const forward = opened(instanceOf(POLYGON(16)));
        const reversed = opened(instanceOf({ ...POLYGON(16), reverseWinding: true }));
        expect(reversed).toEqual(forward);
    });

    it.each(['near-repeated-point', 'near-collinear'] as const)('a %s polygon is declined', (degenerate) => {
        // Convex regions, both declined: a cross product this small has no sign
        // worth trusting. Near-degenerate rather than exactly so, because an
        // exact zero is caught by any test and says nothing about a tolerance.
        const open = opened(instanceOf({ quads: QUADS, relation: 'all-crossing', degenerate }));
        expect(open.bypasses, 'a shape the proof cannot be sure of was accepted').toBe(0);
        expect(open.decompositions).toBe(1);
    });

    it('a pentagram is not convex however consistently it turns', () => {
        // Every turn agrees in sign, so the cross products alone call it convex.
        // What says otherwise is that its edge directions cross each axis four
        // times rather than twice — a simple polygon turns once, a star twice.
        const open = opened(instanceOf({
            quads: QUADS, relation: 'all-crossing', selfIntersecting: true,
        }));
        expect(open.bypasses, 'a self-intersecting polygon was proved convex').toBe(0);
        expect(open.decompositions).toBe(1);
    });

    it('coin opens without being triangulated', () => {
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

        const open = opened(instanceId);
        expect(open.bypasses, "coin's 39-vertex polygon was ear-clipped anyway").toBe(1);
        expect(open.decompositions).toBe(0);
        expect(open.pieces).toBe(1);
        expect(open.edges).toBe(40);
    });
});
