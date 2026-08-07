// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  uiLayoutRect.ts
 * @brief Pure geometry: the world-space box UI is laid out within, plus the
 *        design-resolution ortho scaling behind it. No engine / WASM / DOM
 *        coupling (only the generated CanvasScaleMode enum), so it unit-tests in
 *        isolation like viewportMath. CameraPlugin builds on top of it.
 */

import { CanvasScaleMode } from '../wasm/wasm.generated';

/**
 * Half-height (world units) of the visible area after fitting a design resolution
 * into an actual aspect per @p scaleMode. `orthoForWidth` is the half-height that
 * makes the design *width* exactly fit; `orthoForHeight` the design height.
 */
export function computeEffectiveOrthoSize(
    baseOrthoSize: number,
    designAspect: number,
    actualAspect: number,
    scaleMode: number,
    matchWidthOrHeight: number,
): number {
    const orthoForWidth = baseOrthoSize * designAspect / actualAspect;
    const orthoForHeight = baseOrthoSize;

    switch (scaleMode) {
        case CanvasScaleMode.FixedWidth: return orthoForWidth;
        case CanvasScaleMode.FixedHeight: return orthoForHeight;
        case CanvasScaleMode.Expand: return Math.max(orthoForWidth, orthoForHeight);
        case CanvasScaleMode.Shrink: return Math.min(orthoForWidth, orthoForHeight);
        case CanvasScaleMode.Match: {
            const t = matchWidthOrHeight;
            return Math.pow(orthoForWidth, 1 - t) * Math.pow(orthoForHeight, t);
        }
        default: return orthoForHeight;
    }
}

/**
 * Synthetic camera `entity` id of the editor navigation view (never a real ECS
 * entity — see CameraPlugin.editorCameraInfo). Distinguishes the free-zoom editor
 * view from scene cameras when deciding the UI layout box.
 */
export const EDITOR_VIEW_ENTITY = -1;

/** The minimal camera fields the UI box needs (a subset of CameraInfo). */
export interface CameraExtents {
    entity: number;
    cameraX: number;
    cameraY: number;
    halfW: number;
    halfH: number;
}

/**
 * The design-resolution fit UI and the camera share — the project `ScreenScaling`
 * when it opts in, else the scene's `Canvas` (see CameraPlugin.resolveFitSource).
 * One source for both, so what the editor lays out and what ships cannot differ.
 */
export interface CanvasScale {
    designResolution: { x: number; y: number };
    scaleMode: number;
    matchWidthOrHeight: number;
}

export interface WorldRect {
    left: number;
    right: number;
    bottom: number;
    top: number;
}

/**
 * World anchor of the editor's UI box — the origin. The design frame is a fixed
 * place in the world, not something glued to the navigation view: anchored here it
 * stays concentric with the viewport's design-frame overlay, and pans/zooms with
 * the scene like every other piece of content. (In play the box tracks the camera
 * instead; see {@link uiLayoutRect}.)
 */
export const EDITOR_UI_ANCHOR = { x: 0, y: 0 } as const;

/**
 * The world-space box the UI subtree is laid out within (UINode `px` are world
 * units in this box), for the primary camera. Its SIZE is the area UI lays out in;
 * its CENTER is where that area sits in the world, which places screen roots (a UI
 * root with no transform parent) — so in play the HUD tracks the camera.
 *
 * Scene cameras already bake the fit's design resolution into halfW/halfH, so their
 * box is simply those extents centered on the camera — UINode px map 1:1 to design
 * px and the UI is stable. The editor view instead renders the world at a *free
 * zoom* with a raw orthoSize (editorCameraInfo passes a null fit, for predictable
 * navigation), so laying UI out in its zoomed extents would rescale and reflow every
 * element on each zoom. For it, recover the *fixed* design-resolution box from the
 * fit and anchor it at {@link EDITOR_UI_ANCHOR}: the UI then lays out identically at
 * any zoom or pan, and still scales visually with the scene because it renders
 * through the same zoomed viewProjection.
 *
 * With no fit (no Canvas and no project fit) the editor falls back to its own
 * extents — there is nothing to lay out, so it doesn't matter.
 */
export function uiLayoutRect(
    cam: CameraExtents,
    fit: CanvasScale | null,
    width: number,
    height: number,
    previewAspect = 0,
): WorldRect {
    let halfW = cam.halfW;
    let halfH = cam.halfH;
    let centerX = cam.cameraX;
    let centerY = cam.cameraY;

    if (cam.entity === EDITOR_VIEW_ENTITY && fit && width > 0 && height > 0) {
        // Lay UI out against the *preview screen*, independent of the editor panel's aspect —
        // so the editor is WYSIWYG with the design-frame overlay. `previewAspect > 0` fits the
        // design resolution into a simulated device's aspect (the device simulator: UI adapts
        // per scaleMode, exactly as the letterbox/device frame shows); `0` uses the design
        // aspect, where every scaleMode collapses to the exact authored box (edge-anchored UI
        // at the design-resolution corners). The free editor camera renders this fixed box
        // through its zoomed viewProjection, so UI scales with zoom without reflowing.
        const designAspect = fit.designResolution.x / fit.designResolution.y;
        const aspect = previewAspect > 0 ? previewAspect : designAspect;
        halfH = computeEffectiveOrthoSize(
            fit.designResolution.y / 2, designAspect, aspect, fit.scaleMode, fit.matchWidthOrHeight,
        );
        halfW = halfH * aspect;
        centerX = EDITOR_UI_ANCHOR.x;
        centerY = EDITOR_UI_ANCHOR.y;
    }

    return {
        left: centerX - halfW,
        right: centerX + halfW,
        bottom: centerY - halfH,
        top: centerY + halfH,
    };
}
