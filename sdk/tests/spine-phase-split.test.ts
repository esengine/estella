// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-phase-split.test.ts
 * @brief   A pose is two things, and the composition is the one it was.
 *
 * @details Advancing the animation and resolving world transforms were one call
 *          because nothing needed them apart. Splitting them is only allowed to
 *          be a split: the pair must be the whole, for geometry, for events, for
 *          mixing, for every constraint kind the fixtures carry.
 *
 *          And the claim the rest of this design rests on: for a skeleton whose
 *          world pose carries no state, resolving it ONCE after many advances is
 *          the pose that resolving it after each of them would have produced.
 *          That is what makes a deferred pose a deferral rather than a
 *          different animation, and the runtime says which skeletons it holds
 *          for rather than a caller guessing from a version number.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { withScratch } from '../src/wasm/wasmScratch';
import { drawnGeometry } from './helpers/clipGeometry';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');

/** Every constraint kind the corpus has, and a clipped one. */
const ASSETS = [
    { name: 'spineboy (7 ik, 7 transform)', skel: 'spineboy-38/spineboy-pro.skel', atlas: 'spineboy-38/spineboy.atlas', animation: 'walk' },
    { name: 'raptor (9 ik)', skel: 'raptor-38/raptor-pro.skel', atlas: 'raptor-38/raptor.atlas', animation: 'walk' },
    { name: 'stretchyman (4 ik, 2 transform, 4 path)', skel: 'stretchyman-38/stretchyman-pro.skel', atlas: 'stretchyman-38/stretchyman.atlas', animation: 'sneak' },
    { name: 'coin (clipped)', skel: 'coin-38/coin-pro.skel', atlas: 'coin-38/coin.atlas', animation: 'animation' },
    { name: 'tank (concave clip)', skel: 'tank-38/tank-pro.skel', atlas: 'tank-38/tank.atlas', animation: 'shoot' },
];
const HAS_WASM = existsSync(SPINE38_WASM)
    && ASSETS.every((a) => existsSync(resolve(FIXTURES, a.skel)));
const DT = 1 / 60;

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

const handles = new Map<string, number>();

function skeletonOf(asset: (typeof ASSETS)[number]): number {
    const cached = handles.get(asset.skel);
    if (cached !== undefined) return cached;
    const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, asset.skel)));
    const atlasText = readFileSync(resolve(FIXTURES, asset.atlas), 'utf-8');
    const handle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
    });
    if (handle < 0) throw new Error(api.getLastError());
    for (let i = 0, pages = api.getAtlasPageCount(handle); i < pages; i++) {
        api.setAtlasPageTexture(handle, i, 1, 2048, 2048);
    }
    handles.set(asset.skel, handle);
    return handle;
}

function playing(asset: (typeof ASSETS)[number]): number {
    const instanceId = api.createInstance(skeletonOf(asset));
    if (!api.playAnimation(instanceId, asset.animation, true, 0)) {
        throw new Error(`${asset.name}: no "${asset.animation}"`);
    }
    return instanceId;
}

function drawn(instanceId: number): string {
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
    }).digest;
}

/** Everything the module queued this advance, in order. */
function drainEvents(instanceId: number): string[] {
    const out: string[] = [];
    for (let i = 0, n = api.getEventCount(instanceId); i < n; i++) {
        out.push(`${api.getEventAnimationName(i)}:${api.getEventName(i)}`);
    }
    return out;
}

describe.skipIf(!HAS_WASM)('a pose is two things and the pair is the whole', () => {
    it.each(ASSETS)('$name: the two phases draw what the one call drew', (asset) => {
        const fused = playing(asset);
        const split = playing(asset);
        for (let frame = 0; frame < 40; frame++) {
            api.update(fused, DT);
            api.advanceAndApply(split, DT);
            api.materializeWorldPose(split, DT);
            expect(drawn(split), `frame ${frame} drifted`).toBe(drawn(fused));
        }
    });

    it.each(ASSETS)('$name: the world pose is owed after an advance, not paid by it', (asset) => {
        // The tests above compare split against fused, and a break hitting both
        // leaves them agreeing — so this reads at ONE animation time. Advancing
        // does change what is drawn; where the bones ARE is the debt it leaves.
        const instanceId = playing(asset);
        api.materializeWorldPose(instanceId, DT);
        for (let frame = 0; frame < 30; frame++) api.advanceAndApply(instanceId, DT);

        const owed = drawn(instanceId);
        api.materializeWorldPose(instanceId, DT);
        expect(drawn(instanceId), 'either advancing already resolved the world or materializing did not')
            .not.toBe(owed);
    });

    it('the events an advance queues are the events the whole call queued', () => {
        const fused = playing(ASSETS[0]);
        const split = playing(ASSETS[0]);
        api.enableEvents(fused);
        api.enableEvents(split);

        const fusedEvents: string[][] = [];
        const splitEvents: string[][] = [];
        for (let frame = 0; frame < 120; frame++) {
            api.update(fused, DT);
            fusedEvents.push(drainEvents(fused));
            // Materialized AFTER draining, which is the order a deferred pose
            // would use: the events belong to the advance, not to the world.
            api.advanceAndApply(split, DT);
            splitEvents.push(drainEvents(split));
            api.materializeWorldPose(split, DT);
        }
        expect(fusedEvents.flat().length, 'the walk queued no events at all').toBeGreaterThan(0);
        expect(splitEvents).toEqual(fusedEvents);
    });

    it('a mix in flight survives the split', () => {
        const fused = playing(ASSETS[0]);
        const split = playing(ASSETS[0]);
        api.setDefaultMix(skeletonOf(ASSETS[0]), 0.4);
        api.update(fused, DT);
        api.advanceAndApply(split, DT);
        api.materializeWorldPose(split, DT);
        expect(api.playAnimation(fused, 'run', true, 0)).toBeTruthy();
        expect(api.playAnimation(split, 'run', true, 0)).toBeTruthy();

        for (let frame = 0; frame < 30; frame++) {
            api.update(fused, DT);
            api.advanceAndApply(split, DT);
            api.materializeWorldPose(split, DT);
            expect(drawn(split), `mixing frame ${frame} drifted`).toBe(drawn(fused));
        }
        api.setDefaultMix(skeletonOf(ASSETS[0]), 0);
    });

    it.each(ASSETS)('$name: one materialization after many advances is the pose', (asset) => {
        // What a deferred pose has to be. Sixty advances with the world never
        // resolved, then resolved once, is the pose sixty resolutions leave —
        // none of these skeletons carry world state between frames.
        const eager = playing(asset);
        const deferred = playing(asset);
        for (let frame = 0; frame < 60; frame++) {
            api.update(eager, DT);
            api.advanceAndApply(deferred, DT);
        }
        api.materializeWorldPose(deferred, DT);
        expect(drawn(deferred), 'a deferred pose is a different animation').toBe(drawn(eager));
    });

    it('the runtime says which skeletons may not defer, not the caller', () => {
        // 3.8 has no constraint that carries state across a pose, and says so
        // itself — a manager that reasoned from a version number would have to
        // know which release introduced physics.
        for (const asset of ASSETS) {
            expect(api.requiresContinuousWorldPose(skeletonOf(asset)),
                `${asset.name} claims its world pose carries state`).toBe(0);
        }
    });
});
