// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-pose-demand.test.ts
 * @brief   How many of a frame's poses anyone asked for.
 *
 * @details Posing is the largest thing left in a Spine frame and it is spent
 *          per bound entity, unconditionally. Before anything is skipped, the
 *          waste has to be a number and the structure has to be checked: a
 *          visibility test that needs THIS frame's pose to decide whether to
 *          compute this frame's pose saves nothing.
 *
 *          So this freezes two facts. What the runtime does today — every bound
 *          entity, every frame, whatever the camera can see — and what could
 *          decide otherwise: the authored extent, answerable from the data with
 *          no instance and no pose, against which the posed extent is measured
 *          here so its conservatism is a number rather than a hope.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { Entity } from '../src/types';
import { withScratch } from '../src/wasm/wasmScratch';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const HAS_WASM = existsSync(SPINE38_WASM)
    && existsSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel'));

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
let skelData: Uint8Array;
let atlasText: string;

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
    skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel')));
    atlasText = readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy.atlas'), 'utf-8');
});

function loadSkeleton(): number {
    const handle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
    });
    if (handle < 0) throw new Error(api.getLastError());
    api.setAtlasPageTexture(handle, 0, 1, 2048, 2048);
    return handle;
}

interface Rect { x: number; y: number; width: number; height: number }

function authoredBounds(skeletonHandle: number): Rect | null {
    return withScratch(raw, (alloc) => {
        const ptr = alloc(16);
        const ok = api.getSkeletonBounds(skeletonHandle, ptr, ptr + 4, ptr + 8, ptr + 12);
        if (!ok) return null;
        const f32 = raw.HEAPF32;
        const at = ptr >> 2;
        return { x: f32[at], y: f32[at + 1], width: f32[at + 2], height: f32[at + 3] };
    });
}

function posedBounds(instanceId: number): Rect {
    return withScratch(raw, (alloc) => {
        const ptr = alloc(16);
        api.getBounds(instanceId, ptr, ptr + 4, ptr + 8, ptr + 12);
        const f32 = raw.HEAPF32;
        const at = ptr >> 2;
        return { x: f32[at], y: f32[at + 1], width: f32[at + 2], height: f32[at + 3] };
    });
}

/** A runtime whose per-entity work can be counted from the outside. */
function countingRuntime(): { runtime: SpineRuntime; calls: Record<string, number> } {
    const calls: Record<string, number> = { update: 0, batchCount: 0, submit: 0 };
    const cwrap = raw.cwrap.bind(raw);
    const watched = Object.create(raw) as SpineWasmModule;
    watched.cwrap = ((name: string, ret: unknown, args: unknown) => {
        const fn = cwrap(name, ret as never, args as never);
        return (...called: unknown[]) => {
            if (name === 'spine_update') calls.update++;
            if (name === 'spine_getMeshBatchCount') calls.batchCount++;
            return (fn as (...a: unknown[]) => unknown)(...called);
        };
    }) as never;
    return { runtime: new SpineRuntime('3.8', watched), calls };
}

function era(id: string): SpineEraBinding {
    return {
        id,
        value: { skelData, atlasText, isBinary: true, textures: new Map() },
        retain: () => ({ release: () => {} }),
    };
}

const core = {
    renderer_submitSkeletalBatchByEntity: () => {},
    _malloc: () => 0, _free: () => {}, HEAPU8: new Uint8Array(1 << 20),
} as never;

describe.skipIf(!HAS_WASM)('what a spine frame poses, and who asked', () => {
    it('every bound entity is posed and extracted, whatever the camera can see', () => {
        // The baseline the next cut is measured against. There is no visibility
        // test on this path at all — not one that needs the pose first, none.
        const { runtime, calls } = countingRuntime();
        const entities = 50;
        for (let i = 0; i < entities; i++) {
            runtime.loadEntity(i as Entity, era('demand#1'));
            runtime.setAnimation(i as Entity, 'walk', true);
        }
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(core, {} as never);

        expect(calls.update, 'a pose was skipped for some entity').toBe(entities);
        expect(calls.batchCount, 'an extraction was skipped for some entity').toBe(entities);
        runtime.dispose();
    });

    it('the two policies that do skip are the only ones there are', () => {
        // `disabled` leaves the frame entirely; `playing=false` freezes the pose
        // but is still extracted and submitted, because a frozen skeleton is
        // still drawn. Nothing else can decline.
        const { runtime, calls } = countingRuntime();
        for (let i = 0; i < 6; i++) {
            runtime.loadEntity(i as Entity, era('demand#2'));
            runtime.setAnimation(i as Entity, 'walk', true);
        }
        runtime.setEntityProps(0 as Entity, { playing: false });
        runtime.setEntityProps(1 as Entity, { playing: false });
        runtime.setEnabled(2 as Entity, false);

        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(core, {} as never);

        expect(calls.update, 'frozen and disabled entities did not both decline a pose').toBe(3);
        expect(calls.batchCount, 'a frozen entity stopped being drawn').toBe(5);
        runtime.dispose();
    });

    it('the extent a frame is culled by today is the one the pose produced', () => {
        // The circularity a demand-driven pose has to break: this answer costs
        // exactly the world transform it would be consulted to avoid.
        const handle = loadSkeleton();
        const instanceId = api.createInstance(handle);
        api.playAnimation(instanceId, 'walk', true, 0);

        api.update(instanceId, 0.4);
        const walking = posedBounds(instanceId);
        api.update(instanceId, 0.4);
        const later = posedBounds(instanceId);

        expect(walking.width).toBeGreaterThan(0);
        expect(later, 'the posed extent does not move with the pose').not.toEqual(walking);
    });

    it('the authored extent answers before any instance exists', () => {
        const handle = loadSkeleton();
        const authored = authoredBounds(handle);
        expect(authored, 'the runtime cannot report an authored extent').not.toBeNull();
        expect(authored!.width).toBeGreaterThan(0);
        expect(authored!.height).toBeGreaterThan(0);
    });

    it('the authored extent is not conservative on its own', () => {
        // It is the SETUP pose's, so an animation reaches outside it. Reported
        // rather than assumed, because a visibility test built on it needs to
        // know by how much — this is the padding the next cut has to justify.
        const handle = loadSkeleton();
        const authored = authoredBounds(handle)!;
        const instanceId = api.createInstance(handle);
        api.playAnimation(instanceId, 'walk', true, 0);

        let worst = 0;
        for (let frame = 0; frame < 60; frame++) {
            api.update(instanceId, 1 / 60);
            const posed = posedBounds(instanceId);
            worst = Math.max(worst,
                authored.x - posed.x,
                authored.y - posed.y,
                (posed.x + posed.width) - (authored.x + authored.width),
                (posed.y + posed.height) - (authored.y + authored.height));
        }
        const overshoot = worst / Math.max(authored.width, authored.height);
        if (process.env.SPINE_DEMAND_REPORT) {
            console.log(`authored ${JSON.stringify(authored)}  worst overshoot ${worst.toFixed(1)}`
                + ` (${(overshoot * 100).toFixed(1)}% of the authored extent)`);
        }
        expect(worst, 'a walk cycle stayed inside the setup extent').toBeGreaterThan(0);
        expect(overshoot, 'the authored extent is too far off to pad').toBeLessThan(1);
    });
});
