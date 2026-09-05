// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The screen-space domain, and what it refuses to depend on.
 *
 * Screen UI has one coordinate authority and a camera is not part of it. These
 * are the properties every consumer — layout, picking, dragging, text, the
 * overlay projection — reads the same answer from.
 */
import { describe, it, expect } from 'vitest';
import { screenLayoutRect, NO_INSETS } from '../src/ui/core/screen-layout';
import { CanvasScaleMode } from '../src/wasm/wasm.generated';

const FIT = {
    designResolution: { x: 960, y: 640 },
    scaleMode: CanvasScaleMode.FixedHeight,
    matchWidthOrHeight: 0.5,
};

describe('the screen layout domain', () => {
    it('is the design box, centred on the origin', () => {
        const r = screenLayoutRect(FIT, 960, 640);
        expect(r.valid).toBe(true);
        expect(r.left).toBeCloseTo(-480);
        expect(r.right).toBeCloseTo(480);
        expect(r.bottom).toBeCloseTo(-320);
        expect(r.top).toBeCloseTo(320);
        // Centred means centred: a box that drifts is a box something moved.
        expect(r.left + r.right).toBeCloseTo(0);
        expect(r.bottom + r.top).toBeCloseTo(0);
    });

    it('keeps the fitted axis and widens the other with the viewport', () => {
        const wide = screenLayoutRect(FIT, 1280, 640);
        expect(wide.top - wide.bottom).toBeCloseTo(640);
        expect(wide.right - wide.left).toBeCloseTo(1280);
        const tall = screenLayoutRect(FIT, 480, 640);
        expect(tall.top - tall.bottom).toBeCloseTo(640);
        expect(tall.right - tall.left).toBeCloseTo(480);
    });

    it('says how many device pixels a layout pixel covers', () => {
        expect(screenLayoutRect(FIT, 960, 640).scale).toBeCloseTo(1);
        expect(screenLayoutRect(FIT, 1920, 1280).scale).toBeCloseTo(2);
    });

    it('takes safe insets off the CONTENT box and leaves the projection whole', () => {
        const r = screenLayoutRect(FIT, 960, 640, { left: 40, right: 20, top: 60, bottom: 0 });
        // The full box still covers the framebuffer — a fade is not notch-safe.
        expect(r.left).toBeCloseTo(-480);
        expect(r.right).toBeCloseTo(480);
        expect(r.safeLeft).toBeCloseTo(-440);
        expect(r.safeRight).toBeCloseTo(460);
        expect(r.safeTop).toBeCloseTo(260);
        expect(r.safeBottom).toBeCloseTo(-320);
    });

    it('reports insets in layout pixels, not device ones', () => {
        // Same physical notch, twice the density: half the layout pixels.
        const one = screenLayoutRect(FIT, 960, 640, { ...NO_INSETS, top: 60 });
        const two = screenLayoutRect(FIT, 1920, 1280, { ...NO_INSETS, top: 60 });
        expect(one.top - one.safeTop).toBeCloseTo(60);
        expect(two.top - two.safeTop).toBeCloseTo(30);
    });

    it('has no way to be told about a camera', () => {
        // The signature is the guarantee: design fit, viewport, insets (defaulted,
        // so `length` counts three). Nothing a camera could arrive through, so no
        // consumer can pass one and no later edit can quietly start reading one.
        expect(screenLayoutRect.length).toBe(3);
        const a = screenLayoutRect(FIT, 960, 640);
        const b = screenLayoutRect(FIT, 960, 640);
        expect(a).toEqual(b);
    });

    it('answers invalid for a viewport that does not exist yet', () => {
        expect(screenLayoutRect(FIT, 0, 640).valid).toBe(false);
        expect(screenLayoutRect(FIT, 960, 0).valid).toBe(false);
    });

    it('falls back to the viewport when a project declares no design box', () => {
        const r = screenLayoutRect(null, 800, 600);
        expect(r.right - r.left).toBeCloseTo(800);
        expect(r.top - r.bottom).toBeCloseTo(600);
        expect(r.scale).toBeCloseTo(1);
    });
});
