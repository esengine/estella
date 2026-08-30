// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-pose-materialization.test.ts
 * @brief   A world pose is owed, paid once, and owed again when something moves.
 *
 * @details The frame is not the authority; the revision is. Deduplicating by
 *          frame would be right almost always and wrong exactly when it matters:
 *          a frame that resolves the world and THEN retargets an IK constraint
 *          owes another one, and a frame-keyed cache hands the next asker a pose
 *          taken before the change.
 *
 *          Nothing is skipped yet. Every entity's world pose is still demanded
 *          every frame — what this cut establishes is that it is DEMANDED, by
 *          consumers, rather than computed because a loop reached it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { Entity } from '../src/types';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const HAS_WASM = hasSideModule('spine38')
    && existsSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel'));

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

function era(id: string): SpineEraBinding {
    return {
        id,
        value: { skelData, atlasText, isBinary: true, textures: new Map() },
        pair: { skeleton: `${id}.skel`, atlas: `${id}.atlas` },
        retain: () => ({ release: () => {} }),
    };
}

/** A runtime whose world resolutions can be counted from outside it. */
function counting(): { runtime: SpineRuntime; worlds: () => number; reset: () => void } {
    let worlds = 0;
    const cwrap = raw.cwrap.bind(raw);
    const watched = Object.create(raw) as SpineWasmModule;
    watched.cwrap = ((name: string, ret: unknown, args: unknown) => {
        const fn = cwrap(name, ret as never, args as never);
        return (...called: unknown[]) => {
            if (name === 'spine_materializeWorldPose') worlds++;
            return (fn as (...a: unknown[]) => unknown)(...called);
        };
    }) as never;
    return { runtime: new SpineRuntime('3.8', watched), worlds: () => worlds, reset: () => { worlds = 0; } };
}

const core = {
    renderer_submitSkeletalBatchByEntity: () => {},
    _malloc: () => 0, _free: () => {}, HEAPU8: new Uint8Array(1 << 20),
} as never;

describe.skipIf(!HAS_WASM)('a world pose is owed, and paid once', () => {
    it('a frame asks three times and pays once', () => {
        const { runtime, worlds, reset } = counting();
        runtime.loadEntity(1 as Entity, era('mat#1'));
        runtime.setAnimation(1 as Entity, 'walk', true);
        runtime.updateAll(1 / 60);
        reset();

        // The update already resolved it; every later consumer this frame finds
        // the debt paid.
        expect(runtime.ensurePose(1 as Entity), 'the world was resolved twice').toBe(false);
        expect(runtime.ensurePose(1 as Entity)).toBe(false);
        runtime.extractAndSubmitMeshes(core, {} as never);
        expect(worlds()).toBe(0);
        runtime.dispose();
    });

    it('retargeting a constraint owes another one, in the same frame', () => {
        // What a frame-keyed cache gets wrong. Nothing advanced; the animation
        // is at the same time; and the world it implies is a different one.
        const { runtime, worlds, reset } = counting();
        runtime.loadEntity(1 as Entity, era('mat#2'));
        runtime.setAnimation(1 as Entity, 'walk', true);
        runtime.updateAll(1 / 60);
        reset();

        expect(runtime.setIKTarget(1 as Entity, 'aim-ik', 100, 200, 1)
            || runtime.setAttachment(1 as Entity, 'head', 'head')).toBe(true);
        expect(runtime.ensurePose(1 as Entity), 'a consumer was handed the pose from before the change')
            .toBe(true);
        expect(worlds()).toBe(1);
        expect(runtime.ensurePose(1 as Entity), 'and then paid for it twice').toBe(false);
        runtime.dispose();
    });

    it('a frozen entity keeps the world it has, however many frames pass', () => {
        // playing=false has always meant a frozen pose that is still drawn.
        // Under revisions that is free rather than re-resolved every frame.
        const { runtime, worlds, reset } = counting();
        runtime.loadEntity(1 as Entity, era('mat#3'));
        runtime.setAnimation(1 as Entity, 'walk', true);
        runtime.updateAll(1 / 60);
        runtime.setEntityProps(1 as Entity, { playing: false });
        reset();

        for (let frame = 0; frame < 30; frame++) {
            runtime.updateAll(1 / 60);
            runtime.extractAndSubmitMeshes(core, {} as never);
        }
        expect(worlds(), 'a frozen pose was resolved again').toBe(0);
        runtime.dispose();
    });

    it('an advance owes a new one every frame', () => {
        const { runtime, worlds, reset } = counting();
        runtime.loadEntity(1 as Entity, era('mat#4'));
        runtime.setAnimation(1 as Entity, 'walk', true);
        reset();

        for (let frame = 0; frame < 10; frame++) runtime.updateAll(1 / 60);
        expect(worlds(), 'an advancing entity stopped being resolved').toBe(10);
        runtime.dispose();
    });

    it('a disabled entity is not resolved at all', () => {
        const { runtime, worlds, reset } = counting();
        runtime.loadEntity(1 as Entity, era('mat#5'));
        runtime.setAnimation(1 as Entity, 'walk', true);
        runtime.setEnabled(1 as Entity, false);
        reset();

        runtime.updateAll(1 / 60);
        expect(runtime.ensurePose(1 as Entity)).toBe(false);
        expect(worlds()).toBe(0);
        runtime.dispose();
    });

    it('what a frame did is reported in demand, not in calls', () => {
        const { runtime } = counting();
        for (let i = 0; i < 5; i++) {
            runtime.loadEntity(i as Entity, era('mat#6'));
            runtime.setAnimation(i as Entity, 'walk', true);
        }
        runtime.observe(true);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(core, {} as never);

        const m = runtime.metrics()!;
        expect(m.pose.logicalUpdates).toBe(5);
        expect(m.pose.worldMaterializations).toBe(5);
        expect(m.pose.worldAlreadyCurrent, 'the extraction found five debts already paid').toBe(5);
        expect(m.pose.meshExtractions).toBe(5);
        runtime.dispose();
    });
});
