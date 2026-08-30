// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-frame-boundary.test.ts
 * @brief   When a spine frame is over, and who is in a position to say so.
 *
 * @details A frame poses once and EXTRACTS once per camera, and no camera knows
 *          it was the last. So the pass that measures itself cannot also be the
 *          one that closes the frame: its clock has to accumulate, and the
 *          window it feeds has to be fed from the start of the next frame,
 *          which is the first moment the previous one is whole.
 *
 *          Both halves are invisible at one camera, which is why they were
 *          wrong: a split screen reported half its readback and twice its
 *          samples, and every single-camera scene agreed with itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { certifyBounds } from '../src/spine/spineBounds';
import { fakeSpineModule, fakeSpineEra } from './helpers/fakeSpineModule';
import type { Entity } from '../src/types';

const CERTIFIED = certifyBounds({ minX: -100, minY: -100, maxX: 100, maxY: 100 });
const DT = 1 / 60;

afterEach(() => { vi.restoreAllMocks(); });

/** A core that draws everything and records nothing. */
function camera() {
    const heap = new Uint32Array(64);
    return {
        renderer_submitSkeletalBatchByEntity: () => {},
        renderer_entityVisibleToCamera: (
            _r: unknown, _e: number, _l: number,
            _a: number, _b: number, _c: number, _d: number, out: number,
        ) => { heap[out >> 2] = 1; },
        _malloc: () => 4,
        _free: () => {},
        HEAPU8: new Uint8Array(heap.buffer),
        HEAPU32: heap,
    } as never;
}

/** The clock, so the two passes have KNOWN and DIFFERENT lengths: equal ones
 *  would make "the last pass" and "the sum" indistinguishable. */
function clock(): void {
    vi.spyOn(performance, 'now')
        .mockReturnValueOnce(0).mockReturnValueOnce(1)      // pose: 1ms
        .mockReturnValueOnce(10).mockReturnValueOnce(13)    // camera A: 3ms
        .mockReturnValueOnce(20).mockReturnValueOnce(25)    // camera B: 5ms
        .mockReturnValue(100);
}

function watched(): SpineRuntime {
    const fake = fakeSpineModule();
    const runtime = new SpineRuntime('3.8', fake.module);
    runtime.loadEntity(1 as Entity, fakeSpineEra('hero#1', new Uint8Array([1]), CERTIFIED));
    runtime.observe(true);
    return runtime;
}

describe('a frame drawn by more than one camera', () => {
    it('costs both of its readback passes, not whichever ran last', () => {
        clock();
        const runtime = watched();
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(camera(), {} as never);
        runtime.extractAndSubmitMeshes(camera(), {} as never);

        const time = runtime.metrics()!.time;
        expect(time.pose).toBe(1);
        expect(time.readback, 'one camera was reported as the whole frame').toBe(8);
        expect(time.total).toBe(9);
        runtime.dispose();
    });

    it('feeds the window one sample per frame, whatever the camera count', () => {
        clock();
        const runtime = watched();
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(camera(), {} as never);
        runtime.extractAndSubmitMeshes(camera(), {} as never);
        expect(runtime.windows().readback.size,
            'a frame was sampled while it could still grow').toBe(0);

        // The next frame beginning is the first moment the last one is whole.
        runtime.updateAll(DT);
        const window = runtime.windows().readback;
        expect(window.size, 'each camera pushed a sample of its own').toBe(1);
        expect(window.stats().last).toBe(8);
        expect(runtime.windows().total.stats().last).toBe(9);
        runtime.dispose();
    });

    it('feeds all three windows at one boundary, so they describe one set of frames', () => {
        const runtime = watched();
        for (let i = 0; i < 5; i++) {
            runtime.updateAll(DT);
            runtime.extractAndSubmitMeshes(camera(), {} as never);
        }

        const { pose, readback, total } = runtime.windows();
        expect([pose.size, readback.size, total.size],
            'a window holds a different set of frames from the one beside it')
            .toEqual([4, 4, 4]);
        runtime.dispose();
    });

    it('starts the next frame\'s counts over, however the last one ended', () => {
        const runtime = watched();
        runtime.updateAll(DT);
        runtime.extractAndSubmitMeshes(camera(), {} as never);
        runtime.extractAndSubmitMeshes(camera(), {} as never);
        expect(runtime.metrics()!.pose.meshExtractions).toBe(2);

        runtime.updateAll(DT);
        expect(runtime.metrics()!.pose.meshExtractions,
            'a frame inherited the last one\'s extractions').toBe(0);
        expect(runtime.metrics()!.time.readback).toBe(0);
        runtime.dispose();
    });
});
