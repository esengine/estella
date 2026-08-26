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
     * own size and unfiltered, so no resampling happens at all. Costs black bars
     * wherever a whole multiple does not fill the surface.
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
    /** Whether the present may interpolate. False = a whole-pixel copy. */
    linear: boolean;
    /** True when render size equals the destination rect — the present is a no-op copy. */
    oneToOne: boolean;
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
        return { renderWidth: sw, renderHeight: sh, x: 0, y: 0, width: sw, height: sh, linear: true, oneToOne: true };
    }

    // The render target keeps the SURFACE's aspect, not the design resolution's:
    // the scale mode has already decided how much world a wide window shows, and
    // letterboxing here as well would crop what it just widened.
    const renderHeight = clampDim(worldHeight);
    const renderWidth = clampDim(renderHeight * (sw / sh));

    if (policy === RenderResolution.IntegerMultiple) {
        // The largest whole multiple that still fits. Below 1 there is none, and
        // a downscale cannot be whole-pixel — so it falls back to filling, and
        // says so through `linear` rather than pretending to be crisp.
        const k = Math.floor(Math.min(sw / renderWidth, sh / renderHeight));
        if (k >= 1) {
            const w = renderWidth * k;
            const h = renderHeight * k;
            return {
                renderWidth, renderHeight,
                x: Math.floor((sw - w) / 2), y: Math.floor((sh - h) / 2),
                width: w, height: h,
                linear: false,
                oneToOne: k === 1,
            };
        }
    }

    return {
        renderWidth, renderHeight,
        x: 0, y: 0, width: sw, height: sh,
        linear: true,
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
