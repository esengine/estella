// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-batch-storage.test.ts
 * @brief   The batch slots outlive the frame that fills them — and hand back
 *          exactly what the frame-scoped ones did.
 *
 * @details A frame poses the skeletons the last frame posed, so it writes the
 *          same vectors to the same sizes. Destroying them in between made every
 *          frame grow back into the capacity it had just freed. Keeping them is
 *          only safe if two things stay true, and neither is visible in a wall
 *          clock: a slot the last frame filled must not be readable as this
 *          one's, and a slot reopened must carry nothing of what it held.
 *
 *          So the geometry is held to a digest taken from a build that did not
 *          have them — a parity claim is worth what its witness is independent
 *          of — and the storage itself is read through `spine_probe_storage`,
 *          because "it stopped reallocating" is a statement about capacity and
 *          not about time.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { withScratch } from '../src/wasm/wasmScratch';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');

/**
 * `hash` is FNV-1a over every batch's vertex bytes, index bytes and state, in
 * order — recorded from the build before this change, at the pose below.
 */
const ASSETS = [
    {
        name: 'spineboy', skel: 'spineboy-38/spineboy-pro.skel', atlas: 'spineboy-38/spineboy.atlas',
        hash: '2046a073', batches: [{ vertices: 278, indices: 1023, texture: 1, blend: 0 }],
    },
    {
        name: 'raptor', skel: 'raptor-38/raptor-pro.skel', atlas: 'raptor-38/raptor.atlas',
        hash: 'a25dcd8b', batches: [{ vertices: 588, indices: 2085, texture: 1, blend: 0 }],
    },
    {
        name: 'coin', skel: 'coin-38/coin-pro.skel', atlas: 'coin-38/coin.atlas',
        hash: '034b3ea2',
        batches: [
            { vertices: 12, indices: 18, texture: 1, blend: 0 },
            { vertices: 38, indices: 96, texture: 1, blend: 1 },
        ],
    },
] as const;

const HAS_ASSETS = existsSync(SPINE38_WASM)
    && ASSETS.every((a) => existsSync(resolve(FIXTURES, a.skel)));

/** The four u32 counters `spine_probe_storage` writes, in order. */
const STORAGE = ['slots', 'active', 'vertexFloats', 'indices'] as const;
type Storage = Record<(typeof STORAGE)[number], number>;

/** Every slot of coin's but the additive one, so that batch lands in slot 0. */
const COIN_NORMAL_SLOTS = ['clipping', 'coin-side', 'coin-front-texture', 'coin-side-round', 'shine'];
const COIN_ADDITIVE_SLOT = 'coin-front-shine';

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
/** The pool as it was before anything had ever extracted through it. */
let atRest: Storage;

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
    atRest = storage();
});

function storage(): Storage {
    return withScratch(raw, (alloc) => {
        const ptr = alloc(STORAGE.length * 4);
        api.probeStorage(ptr);
        const out = {} as Storage;
        STORAGE.forEach((name, i) => { out[name] = raw.HEAPU32[(ptr >> 2) + i]; });
        return out;
    });
}

/** A skeleton whose atlas page is bound to `texture`, and one instance of it. */
function posed(asset: { skel: string; atlas: string }, texture = 1): number {
    const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, asset.skel)));
    const atlasText = readFileSync(resolve(FIXTURES, asset.atlas), 'utf-8');
    const skelHandle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
    });
    for (let i = 0, pages = api.getAtlasPageCount(skelHandle); i < pages; i++) {
        api.setAtlasPageTexture(skelHandle, i, texture, 1024, 1024);
    }
    const instanceId = api.createInstance(skelHandle);
    const [first] = JSON.parse(api.getAnimations(instanceId)) as string[];
    if (!api.playAnimation(instanceId, first, true, 0)) throw new Error(`no animation "${first}"`);
    api.update(instanceId, 0.35);
    return instanceId;
}

interface Batch { vertices: number; indices: number; texture: number; blend: number }

/** Every batch of one extraction: its state, its extent, and its bytes. */
function read(instanceId: number): { batches: Batch[]; hash: string } {
    const count = api.getMeshBatchCount(instanceId);
    const batches: Batch[] = [];
    let hash = 0x811c9dc5;
    for (let b = 0; b < count; b++) {
        const vertices = api.getMeshBatchVertexCount(instanceId, b);
        const indices = api.getMeshBatchIndexCount(instanceId, b);
        withScratch(raw, (alloc) => {
            const vp = alloc(vertices * 8 * 4 + 4);
            const ip = alloc(indices * 2 + 2);
            const tp = alloc(4);
            const bp = alloc(4);
            api.getMeshBatchData(instanceId, b, vp, ip, tp, bp);
            const texture = raw.HEAPU32[tp >> 2];
            const blend = raw.HEAPU32[bp >> 2] | 0;
            hash = fnv1a(hash, new Uint8Array(raw.HEAPU8.buffer, vp, vertices * 8 * 4));
            hash = fnv1a(hash, new Uint8Array(raw.HEAPU8.buffer, ip, indices * 2));
            hash = fnv1a(hash, new Uint8Array(new Uint32Array([vertices, indices, texture, blend]).buffer));
            batches.push({ vertices, indices, texture, blend });
        });
    }
    return { batches, hash: (hash >>> 0).toString(16).padStart(8, '0') };
}

function fnv1a(seed: number, bytes: Uint8Array): number {
    let hash = seed;
    for (let i = 0; i < bytes.length; i++) {
        hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

describe.skipIf(!HAS_ASSETS)('spine batch storage outlives the frame', () => {
    it('a steady pose reallocates nothing after the first frame', () => {
        expect(atRest, 'the pool held storage before anything extracted through it')
            .toEqual({ slots: 0, active: 0, vertexFloats: 0, indices: 0 });

        // Warmed by the BIGGER skeleton on purpose: a pool sized to the frame it
        // is about to run reads the same whether it kept its storage or freed it
        // and grew back. Warmed above, rebuilding shows up as capacity dropping.
        const big = posed(ASSETS[1]);
        const steady = posed(ASSETS[0]);
        api.getMeshBatchCount(big);
        const warm = storage();
        expect(warm.vertexFloats, 'the warm-up frame did not size the pool')
            .toBeGreaterThanOrEqual(588 * 8);

        for (let frame = 1; frame <= 6; frame++) {
            api.getMeshBatchCount(steady);
            expect(storage(), `frame ${frame} rebuilt storage the pool already held`)
                .toEqual(warm);
        }
    });

    it('persistent slots hand back the geometry the frame-scoped ones did', () => {
        for (const asset of ASSETS) {
            const instanceId = posed(asset);
            const got = read(instanceId);
            expect(got.batches, `${asset.name}: the batches a frame reads changed`)
                .toEqual(asset.batches.map((b) => ({ ...b })));
            expect(got.hash, `${asset.name}: same batches, different bytes`).toBe(asset.hash);
        }
    });

    it('a frame with fewer batches does not show the ones it did not fill', () => {
        const coin = posed(ASSETS[2]);
        const spineboy = posed(ASSETS[0]);

        expect(api.getMeshBatchCount(coin)).toBe(2);
        expect(api.getMeshBatchCount(spineboy)).toBe(1);
        expect(storage().active, 'the slot coin filled is still counted as this frame\'s').toBe(1);
        // The slot coin's second batch left behind is still allocated; a reader
        // that went by the pool rather than by the frame would find it here.
        expect(api.getMeshBatchVertexCount(spineboy, 1)).toBe(0);
        expect(api.getMeshBatchIndexCount(spineboy, 1)).toBe(0);
    });

    it('a reopened slot keeps nothing of the batch it last held', () => {
        const coin = posed(ASSETS[2], 1);
        const before = read(coin);
        expect(before.hash).toBe(ASSETS[2].hash);

        // One additive batch, bound to another texture: slot 0 now holds every
        // field coin's own first batch must overwrite — state, extent and bytes.
        const shineOnly = posed(ASSETS[2], 9);
        for (const slot of COIN_NORMAL_SLOTS) api.setAttachment(shineOnly, slot, '');
        const shine = read(shineOnly);
        expect(shine.batches, 'the fixture no longer produces one additive batch in slot 0')
            .toEqual([{ vertices: 4, indices: 6, texture: 9, blend: 1 }]);

        expect(read(coin), 'coin read back what the slot held before it').toEqual(before);
        expect(api.setAttachment(shineOnly, COIN_ADDITIVE_SLOT, '')).toBe(1);
    });

    it('capacity is scoped to the module, not to the frame', () => {
        const raptor = posed(ASSETS[1]);
        const spineboy = posed(ASSETS[0]);

        api.getMeshBatchCount(raptor);
        const high = storage();
        expect(high.vertexFloats).toBeGreaterThanOrEqual(588 * 8);

        // The smaller frame keeps the larger one's storage rather than trimming
        // it: giving it back is the per-frame free this change removed.
        api.getMeshBatchCount(spineboy);
        expect(storage().vertexFloats).toBe(high.vertexFloats);
        expect(storage().indices).toBe(high.indices);
    });
});
