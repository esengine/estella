// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The present plan exists for ONE number: world units per rendered pixel.
 *        At exactly 1 a sprite samples its texture 1:1 and the clamp at its own
 *        edge never shows; at anything else every sprite boundary is a candidate
 *        seam. So the tests assert that number, and assert the surface policy
 *        FAILS it — a plan that could not tell the two apart would prove nothing.
 */
import { describe, it, expect } from 'vitest';
import {
    planPresent, worldPerRenderedPixel, RenderResolution,
} from '../src/camera/presentPlan';

/** The surfaces a 1080-tall design actually meets: a panel, a window, a big screen. */
const SURFACES: [number, number][] = [
    [1244, 700],    // editor play panel
    [1600, 900],    // a windowed export
    [1920, 1080],   // the design resolution itself
    [2560, 1440],   // a bigger screen
    [1366, 768],    // a laptop
];

describe('planPresent — the invariant', () => {
    it('Design makes one world unit exactly one rendered pixel, on every surface', () => {
        for (const [w, h] of SURFACES) {
            const plan = planPresent(RenderResolution.Design, 1080, w, h);
            expect(worldPerRenderedPixel(plan, 1080)).toBe(1);
        }
    });

    it('IntegerMultiple holds it too — a whole multiple does not change the render size', () => {
        for (const [w, h] of SURFACES) {
            const plan = planPresent(RenderResolution.IntegerMultiple, 1080, w, h);
            expect(worldPerRenderedPixel(plan, 1080)).toBe(1);
        }
    });

    it('...and Surface does NOT, which is the bug these policies exist for', () => {
        // Same measurement, same inputs. If it passed here the assertion above
        // would be measuring nothing.
        const off = SURFACES.filter(([, h]) => h !== 1080);
        expect(off.length).toBeGreaterThan(0);
        for (const [w, h] of off) {
            const plan = planPresent(RenderResolution.Surface, 1080, w, h);
            expect(worldPerRenderedPixel(plan, 1080)).not.toBe(1);
        }
    });

    it('the ratio the old path was stuck with is the one measured off the report', () => {
        // 1080 design shown in a ~700px panel: 1.54 world units per pixel, which
        // is where the reported seams came from.
        const plan = planPresent(RenderResolution.Surface, 1080, 1244, 700);
        expect(worldPerRenderedPixel(plan, 1080)).toBeCloseTo(1.543, 3);
    });
});

describe('planPresent — the render target', () => {
    it('keeps the SURFACE aspect, so a wide window is not cropped', () => {
        // The scale mode already widened the camera for a wide surface; taking the
        // design aspect here would crop exactly what it just added.
        const plan = planPresent(RenderResolution.Design, 1080, 2560, 1080);
        expect(plan.renderHeight).toBe(1080);
        expect(plan.renderWidth).toBe(2560);
    });

    it('follows the world height, not the design height — every scale mode is served', () => {
        // FixedWidth mode hands a different world height per aspect. The plan must
        // track it, or worldPerPixel is 1 only in FixedHeight.
        const plan = planPresent(RenderResolution.Design, 1350, 1600, 900);
        expect(plan.renderHeight).toBe(1350);
        expect(worldPerRenderedPixel(plan, 1350)).toBe(1);
    });

    it('never returns a zero-sized target', () => {
        for (const [w, h] of [[0, 0], [1, 1], [-5, 3]] as [number, number][]) {
            const plan = planPresent(RenderResolution.Design, 1080, w, h);
            expect(plan.renderWidth).toBeGreaterThan(0);
            expect(plan.renderHeight).toBeGreaterThan(0);
            expect(plan.width).toBeGreaterThan(0);
            expect(plan.height).toBeGreaterThan(0);
        }
    });

    it('falls back to the surface when the world height is nonsense', () => {
        for (const bad of [0, -1, NaN]) {
            const plan = planPresent(RenderResolution.Design, bad, 800, 600);
            expect(plan).toMatchObject({ renderWidth: 800, renderHeight: 600, oneToOne: true });
        }
    });
});

describe('planPresent — IntegerMultiple', () => {
    it('presents at a whole multiple, unfiltered, centred', () => {
        // 540 world units tall into a 1080-tall surface: exactly 2x.
        const plan = planPresent(RenderResolution.IntegerMultiple, 540, 1920, 1080);
        expect(plan.renderHeight).toBe(540);
        expect(plan.renderWidth).toBe(960);
        expect(plan.height).toBe(1080);
        expect(plan.width).toBe(1920);
        expect(plan.linear).toBe(false);
        expect(plan.x).toBe(0);
        expect(plan.y).toBe(0);
    });

    it('letterboxes what a whole multiple cannot fill, and centres the bars', () => {
        // 540 into 900: 1x fits, 2x does not. 360px of bar, 180 top and bottom.
        const plan = planPresent(RenderResolution.IntegerMultiple, 540, 1600, 900);
        expect(plan.renderHeight).toBe(540);
        expect(plan.height).toBe(540);
        expect(plan.y).toBe(180);
        expect(plan.x).toBe((1600 - plan.width) / 2);
        expect(plan.linear).toBe(false);
    });

    it('the whole-multiple rect is exactly k times the render size, both axes', () => {
        // The property, not one arithmetic case: a non-integer ratio anywhere is a
        // resample, which is the thing this policy promises never to do.
        for (const [w, h] of SURFACES) {
            const plan = planPresent(RenderResolution.IntegerMultiple, 360, w, h);
            if (!plan.linear) {
                expect(plan.width / plan.renderWidth).toBe(plan.height / plan.renderHeight);
                expect(Number.isInteger(plan.width / plan.renderWidth)).toBe(true);
            }
        }
    });

    it('says linear rather than pretending, when it must shrink', () => {
        // A render taller than the surface has no whole multiple. Claiming crisp
        // here would be the promise `pixelPerfect` already makes and cannot keep.
        const plan = planPresent(RenderResolution.IntegerMultiple, 2160, 1244, 700);
        expect(plan.linear).toBe(true);
        expect(worldPerRenderedPixel(plan, 2160)).toBe(1);
    });
});
