// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { uiLayoutRect, computeEffectiveOrthoSize, EDITOR_VIEW_ENTITY } from '../src/camera/uiLayoutRect';
import { CanvasScaleMode } from '../src/wasm/wasm.generated';

// A 1280x720 canvas (design aspect 16:9), Expand scale mode.
const canvas = {
    designResolution: { x: 1280, y: 720 },
    scaleMode: CanvasScaleMode.Expand,
    matchWidthOrHeight: 0.5,
};
// A viewport at the design aspect, so the design box is exactly 1280x720 world units.
const W = 1280, H = 720;

describe('uiLayoutRect', () => {
    it('a scene camera uses its own (already design-scaled) extents', () => {
        const cam = { entity: 3, cameraX: 100, cameraY: 50, halfW: 640, halfH: 360 };
        expect(uiLayoutRect(cam, canvas, W, H)).toEqual({
            left: -540, right: 740, bottom: -310, top: 410,
        });
    });

    it('the editor box is the fixed design box — invariant to zoom (the bug)', () => {
        // Same editor view at two very different zooms (raw extents differ 8x)...
        const zoomedIn = { entity: EDITOR_VIEW_ENTITY, cameraX: 0, cameraY: 0, halfW: 160, halfH: 90 };
        const zoomedOut = { entity: EDITOR_VIEW_ENTITY, cameraX: 0, cameraY: 0, halfW: 1280, halfH: 720 };
        const a = uiLayoutRect(zoomedIn, canvas, W, H);
        const b = uiLayoutRect(zoomedOut, canvas, W, H);
        expect(a).toEqual(b); // zoom must NOT move/resize the UI layout box
        expect(a).toEqual({ left: -640, right: 640, bottom: -360, top: 360 });
    });

    it('the editor box is anchored in the world, not glued to the pan', () => {
        // Panning the navigation view must not drag the UI box with it: the box is a
        // fixed frame the design-frame overlay is drawn to, and UI pans with the scene.
        const cam = { entity: EDITOR_VIEW_ENTITY, cameraX: 200, cameraY: -100, halfW: 160, halfH: 90 };
        expect(uiLayoutRect(cam, canvas, W, H)).toEqual({
            left: -640, right: 640, bottom: -360, top: 360,
        });
    });

    it('a scene camera carries its box with it (the HUD tracks the camera)', () => {
        const near = { entity: 3, cameraX: 0, cameraY: 0, halfW: 640, halfH: 360 };
        const far = { entity: 3, cameraX: 5000, cameraY: -800, halfW: 640, halfH: 360 };
        const a = uiLayoutRect(near, canvas, W, H);
        const b = uiLayoutRect(far, canvas, W, H);
        expect(b.right - b.left).toBe(a.right - a.left);
        expect(b.top - b.bottom).toBe(a.top - a.bottom);
        expect((b.left + b.right) / 2).toBe(5000);
        expect((b.bottom + b.top) / 2).toBe(-800);
    });

    it('the editor box is the design box regardless of viewport aspect (WYSIWYG with the frame)', () => {
        // A square viewport must NOT reshape the UI box — it stays the authored 1280×720, so
        // edge-anchored UI sits at the design-resolution corners, matching the design frame.
        const cam = { entity: EDITOR_VIEW_ENTITY, cameraX: 0, cameraY: 0, halfW: 160, halfH: 90 };
        expect(uiLayoutRect(cam, canvas, 1000, 1000)).toEqual({
            left: -640, right: 640, bottom: -360, top: 360,
        });
    });

    it('a selected device previews UI at the device aspect (device simulator)', () => {
        // A portrait device (aspect 0.5) on a 16:9 Expand canvas: Expand keeps the design
        // width and reveals height, so the UI box grows tall (letterbox top/bottom) — the
        // UI adapts exactly as the device/letterbox frame shows, not the design box.
        const cam = { entity: EDITOR_VIEW_ENTITY, cameraX: 0, cameraY: 0, halfW: 160, halfH: 90 };
        expect(uiLayoutRect(cam, canvas, 1000, 1000, 0.5)).toEqual({
            left: -640, right: 640, bottom: -1280, top: 1280,
        });
    });

    it('the editor falls back to its own extents when the scene has no canvas', () => {
        const cam = { entity: EDITOR_VIEW_ENTITY, cameraX: 0, cameraY: 0, halfW: 160, halfH: 90 };
        expect(uiLayoutRect(cam, null, W, H)).toEqual({
            left: -160, right: 160, bottom: -90, top: 90,
        });
    });
});

describe('computeEffectiveOrthoSize', () => {
    const base = 540, designAspect = 1920 / 1080; // 16:9 design, half-height 540

    it('FixedHeight ignores aspect', () => {
        expect(computeEffectiveOrthoSize(base, designAspect, 2.0, CanvasScaleMode.FixedHeight, 0)).toBe(540);
    });
    it('Expand letterboxes (max) on a wider screen', () => {
        expect(computeEffectiveOrthoSize(base, designAspect, 2.0, CanvasScaleMode.Expand, 0)).toBeCloseTo(540, 0);
    });
    it('Shrink crops (min) on a wider screen', () => {
        expect(computeEffectiveOrthoSize(base, designAspect, 2.0, CanvasScaleMode.Shrink, 0)).toBeCloseTo(480, 0);
    });
});
