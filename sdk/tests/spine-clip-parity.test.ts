// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-clip-parity.test.ts
 * @brief   The clip fast paths draw what the cut drew.
 *
 * @details They are only allowed to be faster. One of them deliberately changes
 *          the BUFFER — a mesh wholly inside a convex region keeps its own
 *          shared vertices instead of the clipper's per-triangle rebuild — so
 *          bytes are the wrong witness and triangles are the right one: every
 *          triangle, in order, as the three (x, y, u, v, rgba) it draws.
 *
 *          The digests below were recorded from a build that had neither fast
 *          path, so what they witness is not this build agreeing with itself.
 *          `SPINE_CLIP_PARITY_REPORT=1` prints them, and `SPINE_WASM_OVERRIDE`
 *          points the run at another module — which is how they were taken.
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
import { drawnGeometry } from './helpers/clipGeometry';
import type { DrawnGeometry } from './helpers/clipGeometry';

const OVERRIDE = process.env.SPINE_WASM_OVERRIDE;
const SPINE38_JS = OVERRIDE ? `${OVERRIDE}.js` : resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = OVERRIDE ? `${OVERRIDE}.wasm` : resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const HAS_WASM = existsSync(SPINE38_WASM);
const QUADS = 16;

/** FNV-1a over every triangle's three vertices, in draw order. */
const CASES: Array<{ name: string; options?: SyntheticOptions; skel?: string; atlas?: string; animation?: string; hash: string }> = [
    { name: 'all outside', options: { quads: QUADS, relation: 'outside' }, hash: '811c9dc5' },
    { name: 'all inside', options: { quads: QUADS, relation: 'inside' }, hash: '1472f54c' },
    { name: 'one quad crossing', options: { quads: QUADS, relation: 'one-crossing' }, hash: '119ddde2' },
    { name: 'every quad crossing', options: { quads: QUADS, relation: 'all-crossing' }, hash: 'f666e43f' },
    { name: 'inside a concave region', options: { quads: QUADS, relation: 'inside', polygonVertices: 16, concave: true }, hash: '1472f54c' },
    { name: 'concave 16 crossing', options: { quads: QUADS, relation: 'all-crossing', polygonVertices: 16, concave: true }, hash: '3a5b4493' },
    { name: 'coin', skel: 'coin-38/coin-pro.skel', atlas: 'coin-38/coin.atlas', hash: '4dcc1457' },
    // The whole body inside a clip region it is entirely outside of: 339 input
    // triangles a frame, every one of them cut away to nothing.
    { name: 'spineboy portal', skel: 'spineboy-38/spineboy-pro.skel', atlas: 'spineboy-38/spineboy.atlas', animation: 'portal', hash: 'f7d4b73c' },
];

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

function instanceOf(test: (typeof CASES)[number]): number {
    const real = test.skel !== undefined;
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
        api.setAtlasPageTexture(handle, i, 1, 1024, 1024);
    }
    const instanceId = api.createInstance(handle);
    if (real) {
        const [first] = JSON.parse(api.getAnimations(instanceId)) as string[];
        const animation = test.animation ?? first;
        if (!api.playAnimation(instanceId, animation, true, 0)) throw new Error(`no "${animation}"`);
    }
    api.update(instanceId, real ? 0.3 : 0);
    return instanceId;
}

function fnv1a(seed: number, bytes: Uint8Array): number {
    let hash = seed;
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
    return hash >>> 0;
}

/** Every triangle a frame draws, expanded to the vertices it draws them with. */
function drawn(instanceId: number): DrawnGeometry {
    const batches = api.getMeshBatchCount(instanceId);
    return drawnGeometry({
        batches,
        vertexCount: (b) => api.getMeshBatchVertexCount(instanceId, b),
        indexCount: (b) => api.getMeshBatchIndexCount(instanceId, b),
        read(b) {
            const vertices = api.getMeshBatchVertexCount(instanceId, b);
            const indices = api.getMeshBatchIndexCount(instanceId, b);
            return withScratch(raw, (alloc) => {
                const vp = alloc(vertices * 8 * 4 + 4);
                const ip = alloc(indices * 2 + 2);
                const tp = alloc(4);
                const bp = alloc(4);
                api.getMeshBatchData(instanceId, b, vp, ip, tp, bp);
                return {
                    vertices: new Float32Array(raw.HEAPU8.buffer.slice(vp, vp + vertices * 8 * 4)),
                    indices: new Uint16Array(raw.HEAPU8.buffer.slice(ip, ip + indices * 2)),
                };
            });
        },
    });
}

describe.skipIf(!HAS_WASM)('the clip fast paths draw what the cut drew', () => {
    it.each(CASES)('$name: the same triangles, in the same order', (test) => {
        const got = drawn(instanceOf(test));
        if (process.env.SPINE_CLIP_PARITY_REPORT) {
            console.log(`${test.name.padEnd(26)} ${got.digest} tri=${got.triangles} `
                + `area=${got.area.toFixed(4)} verts=${got.vertices.length}`);
        }
        expect(got.digest, `${test.name}: the fast paths changed what is drawn`).toBe(test.hash);
    });
});
