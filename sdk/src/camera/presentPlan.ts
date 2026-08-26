// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    presentPlan.ts
 * @brief   Where the scene is rendered, and where that image lands on the surface.
 *
 * A quad that scales itself can only clamp at its OWN texture's edge — the
 * neighbouring sprite is a different texture — so every boundary breaks and N
 * sprites give N candidate seams. Scaling one whole image has no interior
 * boundary to break, which is why these are two numbers and not one.
 *
 * The invariant every policy but {@link RenderResolution.Surface} holds:
 * `renderHeight === worldHeight`, so one world unit is one rendered pixel and
 * every sprite samples 1:1.
 *
 * NO IMPORTS, no engine state: a build tool and a test read this the same way the
 * render loop does.
 */

/** How the scene's own resolution is chosen. */
export enum RenderResolution {
    /**
     * Render straight to the surface. Every sprite scales itself, so a
     * non-integer texel-to-pixel ratio shows a seam at every sprite boundary.
     * The behaviour every project had before this existed, and the default.
     */
    Surface = 0,
    /**
     * Render at the size the camera's world height asks for, then scale that
     * image to fill the surface. One uniform resample, no seams; slightly soft
     * at non-integer ratios.
     */
    Design = 1,
    /**
     * As {@link Design}, but the image is presented at a WHOLE multiple of its
     * own size. That rect IS the instruction — the engine reads whole-multiple-ness
     * off it and copies rather than interpolates, so nothing carries a second
     * answer. Costs black bars wherever a whole multiple does not fill the surface.
     */
    IntegerMultiple = 2,
}

/** What the render loop needs: a target size, a destination rect, and a filter. */
export interface PresentPlan {
    /** Size of the offscreen target the scene is drawn into. */
    renderWidth: number;
    renderHeight: number;
    /** Where that image lands on the surface, in surface pixels. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** True when render size equals the destination rect — the present is a no-op copy. */
    oneToOne: boolean;
}

/** A camera's viewport as a fraction of some surface, y-UP from the bottom. */
export interface ViewportFraction {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * A viewport fraction in pixels of the surface it is measured against, y-DOWN.
 *
 * The flip and the rounding drift, so they live here. WHICH surface stays the
 * caller's: input measures the window (a pointer is there), drawing measures the
 * render target (pixels go there).
 */
export function viewportPixels(
    rect: ViewportFraction,
    surfaceWidth: number,
    surfaceHeight: number,
): { x: number; y: number; w: number; h: number } {
    return {
        x: Math.round(rect.x * surfaceWidth),
        y: Math.round((1 - rect.y - rect.h) * surfaceHeight),
        w: Math.round(rect.w * surfaceWidth),
        h: Math.round(rect.h * surfaceHeight),
    };
}

function clampDim(v: number): number {
    return Math.max(1, Math.round(v));
}

/**
 * Plan a frame's render target and its present rect.
 *
 * @param worldHeight World units the camera shows vertically — `2 *` the
 *   effective ortho size, AFTER the scale mode adapted it to the aspect.
 * @param surfaceWidth Destination width in px: the camera's viewport, which is
 *   the window for a full-screen camera and a slice of it for split-screen.
 */
export function planPresent(
    policy: RenderResolution,
    worldHeight: number,
    surfaceWidth: number,
    surfaceHeight: number,
): PresentPlan {
    const sw = clampDim(surfaceWidth);
    const sh = clampDim(surfaceHeight);

    // A surface-sized render, and a world height nobody asked to match, are the
    // same answer: draw where you present. Also the fallback for a nonsense
    // world height, because a zero-tall render target is not a picture.
    if (policy === RenderResolution.Surface || !(worldHeight > 0)) {
        return { renderWidth: sw, renderHeight: sh, x: 0, y: 0, width: sw, height: sh, oneToOne: true };
    }

    // The render target keeps the SURFACE's aspect, not the design resolution's:
    // the scale mode has already decided how much world a wide window shows, and
    // letterboxing here as well would crop what it just widened.
    const renderHeight = clampDim(worldHeight);
    const renderWidth = clampDim(renderHeight * (sw / sh));

    if (policy === RenderResolution.IntegerMultiple) {
        // The largest whole multiple that still fits. Below 1 there is none and a
        // downscale cannot be whole-pixel, so it falls back to filling — the rect
        // stops being a whole multiple, which is the engine reading the truth.
        const k = Math.floor(Math.min(sw / renderWidth, sh / renderHeight));
        if (k >= 1) {
            const w = renderWidth * k;
            const h = renderHeight * k;
            return {
                renderWidth, renderHeight,
                x: Math.floor((sw - w) / 2), y: Math.floor((sh - h) / 2),
                width: w, height: h,
                oneToOne: k === 1,
            };
        }
    }

    return {
        renderWidth, renderHeight,
        x: 0, y: 0, width: sw, height: sh,
        oneToOne: renderWidth === sw && renderHeight === sh,
    };
}

/**
 * World units per rendered pixel under a plan — 1 exactly is what a seam-free
 * frame needs, and what the render policies exist to produce.
 */
export function worldPerRenderedPixel(plan: PresentPlan, worldHeight: number): number {
    return plan.renderHeight > 0 ? worldHeight / plan.renderHeight : 0;
}

/**
 * Whether a plan's present is a whole multiple of its render size — the property
 * the engine derives from the same two rects to decide whether to interpolate.
 * Here so a test can assert the rect rather than a claim about it.
 */
export function presentIsWholeMultiple(plan: PresentPlan): boolean {
    if (plan.oneToOne) return false;
    const kx = plan.width / plan.renderWidth;
    const ky = plan.height / plan.renderHeight;
    return Number.isInteger(kx) && kx === ky;
}
