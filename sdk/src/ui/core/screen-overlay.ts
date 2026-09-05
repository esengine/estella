// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    screen-overlay.ts
 * @brief   How the screen domain reaches pixels this frame — read by the draw
 *          and by the pointer, which is why it is a published value.
 *
 * @details {@link ScreenLayout} says WHERE a screen element is; this says how
 *          that place becomes a framebuffer pixel. They are different facts and
 *          only this one can vary with the surface presenting it.
 *
 *          Render and pick must not merely agree — they must read the SAME
 *          matrix. Two derivations that are equal today drift the moment either
 *          side gains a case, and the symptom (a HUD that looks right and clicks
 *          somewhere else) is worse to diagnose than one that never drew.
 *
 *          In a shipped frame the projection is {@link screenProjection} over the
 *          whole surface: no camera, no world. The editor's design view is the
 *          one place it is anything else — there the screen box is shown IN the
 *          scene, zoomed and panned like the content it will sit over, so the
 *          view's own projection presents it. That is a value this carries, not
 *          a branch the renderer takes.
 */
import { defineResource } from '../../ecs/resource';

export interface ScreenOverlayData {
    /** False when nothing has a screen yet — no surface, no layout. */
    active: boolean;
    /** Layout-domain → clip. 16 floats, column-major, as a camera's is. */
    projection: Float32Array;
    /** The pixel rect of the surface this projection covers. */
    vpX: number;
    vpY: number;
    vpW: number;
    vpH: number;
    /** The whole surface, which is what a pointer's coordinates are flipped by. */
    surfaceW: number;
    surfaceH: number;
    /**
     * The pointer, in LAYOUT pixels — the domain a screen element's transform is
     * in, so a drag can subtract the two. Inverted through {@link projection} and
     * nothing else: a UI system reading the camera's world mouse instead draws in
     * the right place and answers a click somewhere else.
     */
    pointerX: number;
    pointerY: number;
    /**
     * Sorting layers this frame shows, as a bitmask (a Canvas contributes its
     * own layer's bit). Which layers a frame shows is a frame-level fact, so the
     * overlay reads it here rather than from whichever camera happens to be
     * first; where a HUD SITS still owes a camera nothing.
     */
    layerMask: number;
}

/** A fresh instance. A factory rather than a shared literal because the matrix
 *  is a buffer: two Apps spreading one default would write each other's frame. */
export function defaultScreenOverlay(): ScreenOverlayData {
    return {
        active: false,
        projection: new Float32Array(16),
        vpX: 0, vpY: 0, vpW: 0, vpH: 0,
        surfaceW: 0, surfaceH: 0,
        pointerX: 0, pointerY: 0,
        layerMask: 0xFFFFFFFF,
    };
}

export const ScreenOverlay = defineResource<ScreenOverlayData>(
    defaultScreenOverlay(), 'ScreenOverlay');
