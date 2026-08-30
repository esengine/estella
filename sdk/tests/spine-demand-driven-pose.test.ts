// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-demand-driven-pose.test.ts
 * @brief   The three facts meeting, in the one place they are allowed to.
 *
 * @details A revision says whether the debt is paid, a residency says whether it
 *          may be owed, and a camera says whether anyone wants it this pass.
 *          None of them is a scheduler on its own, and this is where they
 *          combine: an entity nobody promised an extent for, or whose world pose
 *          carries state, pays at the advance; a certified stateless one keeps
 *          the debt until a camera asks for it.
 *
 *          The animation never stops. What is deferred is the world-space
 *          solve, and re-entering after any number of unseen frames must draw
 *          what posing every frame would have drawn — byte for byte, not
 *          approximately.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { certifyBounds } from '../src/spine/spineBounds';
import type { SpineCullingEnvelope } from '../src/spine/spineBounds';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { Entity } from '../src/types';
import { drawnGeometry } from './helpers/clipGeometry';
import { fakeSpineModule, fakeSpineEra } from './helpers/fakeSpineModule';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const HAS_WASM = hasSideModule('spine38')
    && existsSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel'));
const DT = 1 / 60;
const CERTIFIED = certifyBounds({ minX: -300, minY: -20, maxX: 300, maxY: 800 });

let raw: SpineWasmModule;
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
    skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel')));
    atlasText = readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy.atlas'), 'utf-8');
});

function era(id: string, culling: SpineCullingEnvelope): SpineEraBinding {
    return {
        id, culling,
        value: { skelData, atlasText, isBinary: true, textures: new Map() },
        pair: { skeleton: `${id}.skel`, atlas: `${id}.atlas` },
        retain: () => ({ release: () => {} }),
    };
}

/** A core that answers visibility as the test says, and records what it drew. */
function camera(visible: boolean): { core: never; submits: number } {
    const state = { submits: 0 };
    const heap = new Uint32Array(64);
    const api = {
        renderer_submitSkeletalBatchByEntity: () => { state.submits++; },
        renderer_entityVisibleToCamera: (
            _r: unknown, _e: number, _l: number,
            _a: number, _b: number, _c: number, _d: number, out: number,
        ) => { heap[out >> 2] = visible ? 1 : 0; },
        _malloc: () => 4, _free: () => {},
        HEAPU8: new Uint8Array(heap.buffer), HEAPU32: heap,
    };
    return { core: api as never, get submits() { return state.submits; } } as never;
}

function bound(culling: SpineCullingEnvelope, id = 'demand#1'): SpineRuntime {
    const runtime = new SpineRuntime('3.8', raw);
    runtime.loadEntity(1 as Entity, era(id, culling));
    runtime.setAnimation(1 as Entity, 'walk', true);
    runtime.observe(true);
    return runtime;
}

/** What a frame of this entity draws, read straight from the module. */
function drawn(runtime: SpineRuntime): string {
    const controller = (runtime as unknown as { controller_: {
        getMeshBatchCount(id: number): number;
        getMeshBatchVertexCount(id: number, b: number): number;
        getMeshBatchIndexCount(id: number, b: number): number;
    } }).controller_;
    const instanceId = (runtime as unknown as { entities_: Map<Entity, { instanceId: number }> })
        .entities_.get(1 as Entity)!.instanceId;
    const api = (controller as unknown as { api_: Record<string, (...a: never[]) => never> }).api_;
    const batches = api.getMeshBatchCount(instanceId as never) as unknown as number;
    return drawnGeometry({
        batches,
        vertexCount: (b) => api.getMeshBatchVertexCount(instanceId as never, b as never) as unknown as number,
        indexCount: (b) => api.getMeshBatchIndexCount(instanceId as never, b as never) as unknown as number,
        read(b) {
            const vertices = api.getMeshBatchVertexCount(instanceId as never, b as never) as unknown as number;
            const indices = api.getMeshBatchIndexCount(instanceId as never, b as never) as unknown as number;
            const vp = raw._malloc(vertices * 8 * 4 + 4);
            const ip = raw._malloc(indices * 2 + 2);
            const tp = raw._malloc(4);
            const bp = raw._malloc(4);
            api.getMeshBatchData(instanceId as never, b as never, vp as never, ip as never, tp as never, bp as never);
            const out = {
                vertices: new Float32Array(raw.HEAPU8.buffer.slice(vp, vp + vertices * 8 * 4)),
                indices: new Uint16Array(raw.HEAPU8.buffer.slice(ip, ip + indices * 2)),
            };
            raw._free(vp); raw._free(ip); raw._free(tp); raw._free(bp);
            return out;
        },
    }).digest;
}

describe.skipIf(!HAS_WASM)('the three facts, combined once', () => {
    it('certified, stateless and unseen costs an advance and nothing else', () => {
        const runtime = bound(CERTIFIED);
        const offscreen = camera(false);
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(offscreen.core, {} as never);

        const m = runtime.metrics()!;
        expect(m.pose.logicalUpdates, 'the animation stopped').toBe(1);
        expect(m.pose.worldMaterializations).toBe(0);
        expect(m.pose.meshExtractions).toBe(0);
        expect(offscreen.submits).toBe(0);
        runtime.dispose();
    });

    it('certified and seen pays once, however many consumers ask', () => {
        const runtime = bound(CERTIFIED);
        const onscreen = camera(true);
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(onscreen.core, {} as never);
        runtime.ensurePose(1 as Entity);

        const m = runtime.metrics()!;
        expect(m.pose.worldMaterializations).toBe(1);
        expect(m.pose.worldAlreadyCurrent, 'a second asker paid again').toBeGreaterThan(0);
        runtime.dispose();
    });

    it('an uncertified entity behaves exactly as it did', () => {
        const runtime = bound({ kind: 'unknown' });
        const offscreen = camera(false);
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(offscreen.core, {} as never);

        const m = runtime.metrics()!;
        expect(m.pose.worldMaterializations, 'an uncertified pose was deferred').toBe(1);
        expect(m.pose.meshExtractions, 'an uncertified entity was culled').toBe(1);
        expect(m.pose.renderCulled, 'an uncertified extent was culled against').toBe(0);
        runtime.dispose();
    });

    it('an observed entity behaves exactly as it did', () => {
        const runtime = bound({
            kind: 'observed', source: 'animation-scan', sampleStep: DT, era: 'demand#1',
            bounds: { minX: -300, minY: -20, maxX: 300, maxY: 800 },
            coverage: { animations: 11, skins: 1, samples: 400 },
        });
        const offscreen = camera(false);
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(offscreen.core, {} as never);

        const m = runtime.metrics()!;
        expect(m.pose.worldMaterializations, 'a scan authorised a deferral at the effect').toBe(1);
        expect(m.pose.meshExtractions).toBe(1);
        runtime.dispose();
    });

    it('re-entering draws what posing every frame would have drawn', () => {
        // The whole design in one assertion, and byte-for-byte: sixty unseen
        // frames, then a camera wants it, against a reference that never stopped.
        const lazy = bound(CERTIFIED, 'demand#lazy');
        const eager = bound({ kind: 'unknown' }, 'demand#eager');
        const offscreen = camera(false);
        const onscreen = camera(true);

        for (let frame = 0; frame < 60; frame++) {
            lazy.updateAll(DT);
            lazy.extractAndSubmitMeshes(offscreen.core, {} as never);
            eager.updateAll(DT);
            eager.extractAndSubmitMeshes(onscreen.core, {} as never);
        }
        expect(lazy.metrics()!.pose.worldMaterializations, 'the unseen one was resolved anyway').toBe(0);

        lazy.updateAll(DT);
        lazy.extractAndSubmitMeshes(onscreen.core, {} as never);
        eager.updateAll(DT);
        eager.extractAndSubmitMeshes(onscreen.core, {} as never);

        expect(drawn(lazy), 'a deferred pose came back as a different animation')
            .toBe(drawn(eager));
        lazy.dispose();
        eager.dispose();
    });

    it('the events of an unseen sixty frames are the events of a seen sixty', () => {
        const unseen = bound(CERTIFIED, 'demand#unseen');
        const seen = bound(CERTIFIED, 'demand#seen');
        unseen.enableEvents(1 as Entity);
        seen.enableEvents(1 as Entity);
        const offscreen = camera(false);
        const onscreen = camera(true);

        const drain = (runtime: SpineRuntime): string[] =>
            runtime.collectAllEvents().map(
                ({ raw }) => `${raw.animation}:${raw.name}:${raw.type}`);
        const unseenEvents: string[][] = [];
        const seenEvents: string[][] = [];
        for (let frame = 0; frame < 120; frame++) {
            unseen.updateAll(DT);
            unseenEvents.push(drain(unseen));
            unseen.extractAndSubmitMeshes(offscreen.core, {} as never);
            seen.updateAll(DT);
            seenEvents.push(drain(seen));
            seen.extractAndSubmitMeshes(onscreen.core, {} as never);
        }
        expect(unseenEvents.flat().length, 'the walk produced no events at all').toBeGreaterThan(0);
        expect(unseenEvents, 'visibility changed what an animation announced').toEqual(seenEvents);
        unseen.dispose();
        seen.dispose();
    });

    it('a world pose that carries state is resolved even when nobody sees it', () => {
        // Continuous world is not always-render: the pose keeps being resolved
        // because deferring it would change it, and the camera that cannot see
        // it still costs nothing to draw.
        const fake = fakeSpineModule();
        fake.continuousWorldPose = true;
        const runtime = new SpineRuntime('4.2', fake.module);
        runtime.loadEntity(1 as Entity, fakeSpineEra('physics#1', new Uint8Array([1]), CERTIFIED));
        runtime.setAnimation(1 as Entity, 'walk', true);
        runtime.observe(true);

        const offscreen = camera(false);
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(offscreen.core, {} as never);

        const m = runtime.metrics()!;
        expect(m.pose.worldMaterializations, 'a stateful world pose was deferred').toBe(1);
        expect(m.pose.renderCulled).toBe(1);
        expect(m.pose.meshExtractions, 'a stateful skeleton was drawn to a camera that cannot see it')
            .toBe(0);
        runtime.dispose();
    });

    it('a frozen entity that is seen is drawn without being resolved again', () => {
        const runtime = bound(CERTIFIED);
        const onscreen = camera(true);
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(onscreen.core, {} as never);
        runtime.setEntityProps(1 as Entity, { playing: false });

        runtime.observe(true);
        for (let frame = 0; frame < 30; frame++) {
            runtime.updateAll(DT);
            runtime.extractAndSubmitMeshes(onscreen.core, {} as never);
        }
        const m = runtime.metrics()!;
        expect(m.pose.worldMaterializations, 'a frozen pose was resolved again').toBe(0);
        expect(m.pose.meshExtractions, 'a frozen entity stopped being drawn').toBe(1);
        runtime.dispose();
    });
});
