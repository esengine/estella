// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-bounds-certification.test.ts
 * @brief   Three rectangles, and only one of them may decide anything.
 *
 * @details A skipped world pose is only correct if "nothing can see it" was
 *          decided by an extent nothing can leave. A scan is not that: mixing
 *          two animations is not the union of their extents, runtime code moves
 *          bones the export never did, and an extreme between two samples is
 *          simply not seen. So the scan produces an OBSERVATION, a promise is
 *          something somebody makes, and the gate takes only the promise.
 *
 *          A false positive here wastes time. A false negative makes something
 *          disappear. These hold the default on the first side.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import { SpineModuleController } from '../src/spine/SpineController';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import {
    setupBounds, scanObservedBounds, certifyBounds, envelopeFor,
    mayDeferWorldPose, worldBounds, contains,
} from '../src/spine/spineBounds';
import type { SpineAABB, SpineBoundsSource } from '../src/spine/spineBounds';
import { syntheticSkeleton } from './helpers/syntheticSpine';
import type { SyntheticOptions } from './helpers/syntheticSpine';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const HAS_WASM = hasSideModule('spine38')
    && existsSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel'));

let raw: SpineWasmModule;
let controller: SpineModuleController;
let source: SpineBoundsSource;

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
    controller = new SpineModuleController(raw, wrapSpineModule(raw));
    source = controller as unknown as SpineBoundsSource;
});

function spineboy(): number {
    const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel')));
    const atlasText = readFileSync(resolve(FIXTURES, 'spineboy-38/spineboy.atlas'), 'utf-8');
    const handle = controller.loadSkeleton(skelData, atlasText, true);
    if (handle < 0) throw new Error(controller.getLastError());
    controller.setAtlasPageTexture(handle, 0, 1, 2048, 2048);
    return handle;
}

function synthetic(options: SyntheticOptions): number {
    const { json, atlas } = syntheticSkeleton(options);
    const handle = controller.loadSkeleton(new TextEncoder().encode(json), atlas, false);
    if (handle < 0) throw new Error(controller.getLastError());
    controller.setAtlasPageTexture(handle, 0, 1, 64, 64);
    return handle;
}

const STRIP: SyntheticOptions = { quads: 4, relation: 'inside' };

describe.skipIf(!HAS_WASM)('only a promise may authorise a skipped pose', () => {
    it('a setup extent is a fact about the data and authorises nothing', () => {
        const handle = spineboy();
        const setup = setupBounds(source, handle);
        expect(setup, 'the runtime reports no authored extent').not.toBeNull();
        // There is no way to reach `certified` from it: the only maker takes a
        // rectangle and somebody's decision, never another envelope.
        expect(mayDeferWorldPose({ kind: 'unknown' }, false)).toBe(false);
    });

    it('an observation is not a promise however much it scanned', () => {
        const handle = spineboy();
        const observed = scanObservedBounds(source, handle, 'era#1');
        expect(observed.kind).toBe('observed');
        expect(mayDeferWorldPose(observed, false), 'a scan authorised a skipped pose').toBe(false);
    });

    it('what a scan sees is outside what the skeleton was authored at', () => {
        // The witness that scanning is worth doing at all, and the reason the
        // setup extent cannot stand in for it.
        const handle = spineboy();
        const setup = setupBounds(source, handle)!;
        const observed = scanObservedBounds(source, handle, 'era#1');
        if (observed.kind !== 'observed') throw new Error('not a scan');
        expect(contains(setup, observed.bounds), 'a walk stayed inside the setup extent').toBe(false);
    });

    it('every animation is visited, and the count says so', () => {
        // Not "the box came out big enough" — a scan that quietly ran one
        // animation would still produce a plausible box.
        const handle = synthetic({ ...STRIP, farAnimation: true });
        const instanceId = controller.createInstance(handle);
        const animations = controller.getAnimations(instanceId);
        controller.destroyInstance(instanceId);

        const observed = scanObservedBounds(source, handle, 'era#1');
        if (observed.kind !== 'observed') throw new Error('not a scan');
        expect(animations.length).toBe(2);
        expect(observed.coverage.animations, 'the scan skipped an animation').toBe(animations.length);
        expect(observed.coverage.samples).toBeGreaterThan(animations.length);
    });

    it('an animation that travels widens what the scan saw', () => {
        const near = scanObservedBounds(source, synthetic(STRIP), 'era#1');
        const far = scanObservedBounds(source, synthetic({ ...STRIP, farAnimation: true }), 'era#1');
        if (near.kind !== 'observed' || far.kind !== 'observed') throw new Error('not a scan');
        expect(contains(far.bounds, near.bounds), 'the travelling animation was not seen').toBe(true);
        expect(far.bounds.maxY).toBeGreaterThan(near.bounds.maxY);
    });

    it('every skin is visited, and the biggest one is inside what was seen', () => {
        // A certificate hangs off an era, and an era is (skeleton, atlas) — not
        // a skin. So a scan that only saw the default one would let an entity
        // wearing another be culled against a box its geometry leaves.
        const handle = synthetic({ ...STRIP, hugeSkin: true });
        const observed = scanObservedBounds(source, handle, 'era#1');
        if (observed.kind !== 'observed') throw new Error('not a scan');
        expect(observed.coverage.skins, 'the scan saw one skin').toBe(2);

        const instanceId = controller.createInstance(handle);
        controller.setSkin(instanceId, 'huge');
        controller.update(instanceId, 0);
        const posed = controller.getBounds(instanceId);
        controller.destroyInstance(instanceId);
        const wearing: SpineAABB = {
            minX: posed.x, minY: posed.y,
            maxX: posed.x + posed.width, maxY: posed.y + posed.height,
        };
        expect(contains(observed.bounds, wearing), 'the huge skin leaves what the scan saw').toBe(true);
    });

    it('an observation retires with the generation it was taken from', () => {
        const observed = scanObservedBounds(source, spineboy(), 'era#1');
        expect(envelopeFor(observed, 'era#1').kind).toBe('observed');
        expect(envelopeFor(observed, 'era#2').kind, 'a scan of the last generation was kept')
            .toBe('unknown');

        // A promise is about the asset, so it does not retire with the bytes.
        const promised = certifyBounds({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
        expect(envelopeFor(promised, 'era#2').kind).toBe('certified');
    });

    it('a promise authorises a skip, and only alongside the runtime\'s own', () => {
        const promised = certifyBounds({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
        expect(mayDeferWorldPose(promised, false)).toBe(true);
        expect(mayDeferWorldPose(promised, true), 'a stateful skeleton was allowed to defer').toBe(false);
        expect(mayDeferWorldPose({ kind: 'unknown' }, false), 'no envelope authorised a skip').toBe(false);
    });

    it('the world extent of a rotated local one contains it', () => {
        // Under rotation the result's corners are not the transformed corners,
        // so all four are taken and re-bounded.
        const local: SpineAABB = { minX: -10, minY: -20, maxX: 30, maxY: 40 };
        const angle = Math.PI / 4;
        const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
        const world = worldBounds(local, [cos, sin, -sin, cos, 100, 200]);
        for (const [x, y] of [[local.minX, local.minY], [local.maxX, local.minY],
                              [local.maxX, local.maxY], [local.minX, local.maxY]] as const) {
            const wx = cos * x - sin * y + 100;
            const wy = sin * x + cos * y + 200;
            expect(wx).toBeGreaterThanOrEqual(world.minX);
            expect(wx).toBeLessThanOrEqual(world.maxX);
            expect(wy).toBeGreaterThanOrEqual(world.minY);
            expect(wy).toBeLessThanOrEqual(world.maxY);
        }
        expect(world.maxX - world.minX).toBeGreaterThan(local.maxX - local.minX);
    });
});
