// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-camera-visibility.test.ts
 * @brief   Whether this camera would draw it — asked of the renderer, acted on
 *          by nobody yet.
 *
 * @details The engine culls per CAMERA, not per frame: `collectAll` runs once
 *          for each, with that camera's frustum and its culling mask, and the
 *          draw list is cleared between them. There is no camera bitmask to
 *          propagate — `cullBit` on a draw is which LAYER it belongs to.
 *
 *          So visibility is a per-camera question and the union over cameras
 *          falls out of the revision model rather than being computed: the first
 *          camera that wants an entity resolves its pose, and the rest find the
 *          debt paid. Nothing here needs a bitmask, and nothing invents one.
 *
 *          This cut only asks. Behaviour is identical — the same entities are
 *          resolved, extracted and submitted as before — which is what keeps the
 *          scheduling decision in the cut that will make it.
 */
import { describe, it, expect } from 'vitest';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { fakeSpineModule, fakeSpineEra } from './helpers/fakeSpineModule';
import { certifyBounds } from '../src/spine/spineBounds';
import type { Entity } from '../src/types';

const PROMISE = certifyBounds({ minX: -100, minY: -100, maxX: 100, maxY: 100 });

/** A core that answers the visibility question however the test wants. */
function core(answer: ((entity: number, layer: number) => boolean) | null): {
    core: never; asked: Array<{ entity: number; layer: number; rect: number[] }>;
} {
    const asked: Array<{ entity: number; layer: number; rect: number[] }> = [];
    const heap = new Uint32Array(64);
    const api: Record<string, unknown> = {
        renderer_submitSkeletalBatchByEntity: () => {},
        _malloc: () => 4,
        _free: () => {},
        HEAPU8: new Uint8Array(heap.buffer),
        HEAPU32: heap,
    };
    if (answer) {
        api.renderer_entityVisibleToCamera = (
            _r: unknown, entity: number, layer: number,
            minX: number, minY: number, maxX: number, maxY: number, out: number,
        ): void => {
            asked.push({ entity, layer, rect: [minX, minY, maxX, maxY] });
            heap[out >> 2] = answer(entity, layer) ? 1 : 0;
        };
    }
    return { core: api as never, asked };
}

function runtimeWith(culling = PROMISE): { runtime: SpineRuntime; fake: ReturnType<typeof fakeSpineModule> } {
    const fake = fakeSpineModule();
    const runtime = new SpineRuntime('3.8', fake.module);
    runtime.loadEntity(1 as Entity, fakeSpineEra('era#1', new Uint8Array([1]), culling));
    runtime.setAnimation(1 as Entity, 'walk', true);
    runtime.observe(true);
    return { runtime, fake };
}

describe('what this camera would draw, asked of the renderer', () => {
    it('a certified entity is asked about, in its own extent', () => {
        const { runtime } = runtimeWith();
        const { core: engine, asked } = core(() => true);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(engine, {} as never);

        expect(asked).toHaveLength(1);
        expect(asked[0].rect, 'the promise was not the extent that was asked about')
            .toEqual([-100, -100, 100, 100]);
        expect(runtime.metrics()!.pose.renderCulled).toBe(0);
        runtime.dispose();
    });

    it('an entity this camera cannot see costs it nothing', () => {
        const { runtime } = runtimeWith();
        const { core: engine } = core(() => false);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(engine, {} as never);

        const m = runtime.metrics()!;
        expect(m.pose.renderCulled).toBe(1);
        expect(m.pose.logicalUpdates, 'the animation stopped advancing').toBe(1);
        expect(m.pose.worldMaterializations, 'a pose nobody wanted was resolved').toBe(0);
        expect(m.pose.meshExtractions).toBe(0);
        runtime.dispose();
    });

    it('an uncertified entity is not asked about at all', () => {
        // Its extent is unknown, so its visibility is unknown; there is nothing
        // to ask with, and "unknown" may never be read as "invisible".
        const { runtime } = runtimeWith({ kind: 'unknown' });
        const { core: engine, asked } = core(() => false);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(engine, {} as never);

        expect(asked, 'an uncertified extent was used to ask about visibility').toHaveLength(0);
        expect(runtime.metrics()!.pose.renderCulled).toBe(0);
        runtime.dispose();
    });

    it('an observed extent is not asked about either', () => {
        // The rule from the certification cut, reaching the render path: an
        // observation is not a promise, so it is not an extent to cull against.
        const { runtime } = runtimeWith({
            kind: 'observed', source: 'animation-scan', sampleStep: 1 / 30, era: 'era#1',
            bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
            coverage: { animations: 1, skins: 1, samples: 30 },
        });
        const { core: engine, asked } = core(() => false);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(engine, {} as never);

        expect(asked, 'a scan was used as the extent to cull against').toHaveLength(0);
        runtime.dispose();
    });

    it('a core that cannot answer is not treated as a no', () => {
        const { runtime } = runtimeWith();
        const { core: engine } = core(null);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(engine, {} as never);
        expect(runtime.metrics()!.pose.renderCulled).toBe(0);
        runtime.dispose();
    });

    it('the entity scale is carried into the extent it is asked about', () => {
        const { runtime } = runtimeWith();
        runtime.setEntityProps(1 as Entity, { skeletonScale: 3 });
        const { core: engine, asked } = core(() => true);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(engine, {} as never);
        expect(asked[0].rect, 'a scaled skeleton was culled against its unscaled extent')
            .toEqual([-300, -300, 300, 300]);
        runtime.dispose();
    });

    it('the layer is the one the entity draws on', () => {
        const { runtime } = runtimeWith();
        runtime.setEntityProps(1 as Entity, { layer: 7 });
        const { core: engine, asked } = core(() => true);
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(engine, {} as never);
        expect(asked[0].layer, "the camera was asked about the wrong layer").toBe(7);
        runtime.dispose();
    });

    it('two cameras are two passes, and the one that wants it pays', () => {
        // The union, without a bitmask: each camera runs its own submit, and the
        // revision model means only the first one that wants it pays.
        const { runtime } = runtimeWith();
        const invisible = core(() => false);
        const visible = core(() => true);
        runtime.updateAll(1 / 60);

        runtime.extractAndSubmitMeshes(invisible.core, {} as never);
        runtime.extractAndSubmitMeshes(visible.core, {} as never);

        const m = runtime.metrics()!;
        expect(m.pose.renderCulled, 'only one of the two cameras declined it').toBe(1);
        expect(m.pose.worldMaterializations, 'the camera that wanted it did not pay once').toBe(1);
        expect(m.pose.meshExtractions).toBe(1);
        runtime.dispose();
    });
});
