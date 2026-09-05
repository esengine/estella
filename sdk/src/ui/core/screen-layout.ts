// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    screen-layout.ts
 * @brief   The one screen-space fact every consumer of it reads.
 *
 * @details Screen UI is laid out in a pixel domain decided by the design
 *          resolution, the viewport, the scale mode and the device — and by
 *          nothing else. No camera position, no camera projection, no world
 *          units. A camera moving must not move a HUD, and the only way to
 *          guarantee that is for the coordinates never to have come from one.
 *
 *          Two rects, not one. The VIEWPORT box is the whole framebuffer and is
 *          what the overlay projects; the SAFE box is the part a layout should
 *          keep its content inside. Merging them shrinks a full-screen fade into
 *          the notch-safe rect, which is not what a fade is.
 */
import { defineResource } from '../../ecs/resource';
import { computeEffectiveOrthoSize, type CanvasScale } from '../../camera/uiLayoutRect';

/** Insets, in layout pixels, the device asks content to stay clear of. */
export interface ScreenInsets {
    left: number;
    bottom: number;
    right: number;
    top: number;
}

export const NO_INSETS: ScreenInsets = { left: 0, bottom: 0, right: 0, top: 0 };

/**
 * The layout-pixel domain, centred on the origin. `left`/`right` are what a
 * screen root is placed within; `scale` is how many device pixels one layout
 * pixel covers, which is what a text renderer needs and a camera cannot say.
 */
export interface ScreenLayoutData {
    /** False before a viewport is known — nothing has a screen to lay out on. */
    valid: boolean;
    left: number;
    bottom: number;
    right: number;
    top: number;
    /** The same box as the safe area allows: content, not the projection. */
    safeLeft: number;
    safeBottom: number;
    safeRight: number;
    safeTop: number;
    /** Device pixels per layout pixel. */
    scale: number;
    /** The framebuffer this domain projects onto. */
    viewportW: number;
    viewportH: number;
}

const NO_SCREEN: ScreenLayoutData = {
    valid: false,
    left: 0, bottom: 0, right: 0, top: 0,
    safeLeft: 0, safeBottom: 0, safeRight: 0, safeTop: 0,
    scale: 1, viewportW: 0, viewportH: 0,
};

export const ScreenLayout = defineResource<ScreenLayoutData>({ ...NO_SCREEN }, 'ScreenLayout');

/**
 * The layout box for a viewport. `fit` is the project's design resolution and
 * scale mode; absent, the viewport is its own design box and one layout pixel is
 * one device pixel.
 *
 * @param insets device-reported safe-area insets, in DEVICE pixels.
 */
export function screenLayoutRect(
    fit: CanvasScale | null,
    viewportW: number,
    viewportH: number,
    insets: ScreenInsets = NO_INSETS,
): ScreenLayoutData {
    if (viewportW <= 0 || viewportH <= 0) {
        return { ...NO_SCREEN };
    }
    const aspect = viewportW / viewportH;
    let halfH: number;
    if (fit && fit.designResolution.y > 0 && fit.designResolution.x > 0) {
        const designAspect = fit.designResolution.x / fit.designResolution.y;
        halfH = computeEffectiveOrthoSize(
            fit.designResolution.y / 2, designAspect, aspect, fit.scaleMode, fit.matchWidthOrHeight,
        );
    } else {
        halfH = viewportH / 2;
    }
    const halfW = halfH * aspect;
    // One number: the box is fitted to the viewport's aspect, so both axes carry
    // the same ratio and a non-uniform scale cannot arise here.
    const scale = viewportH / (halfH * 2);
    return {
        valid: true,
        left: -halfW, right: halfW, bottom: -halfH, top: halfH,
        safeLeft: -halfW + insets.left / scale,
        safeRight: halfW - insets.right / scale,
        safeBottom: -halfH + insets.bottom / scale,
        safeTop: halfH - insets.top / scale,
        scale,
        viewportW, viewportH,
    };
}
