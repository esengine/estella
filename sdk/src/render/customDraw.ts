// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    customDraw.ts
 * @brief   Custom draw callback registration for the render pipeline
 */

/** The camera facts used by the draw pass invoking a callback. */
export interface DrawFrameInfo {
    /** Canonical view-projection matrix for this render pass. Valid for the callback. */
    readonly viewProjection: Float32Array;
    /** Framebuffer viewport dimensions used by Draw.begin. */
    readonly width: number;
    readonly height: number;
}

export type DrawCallback = (elapsed: number, frame: DrawFrameInfo) => void;

type DrawEntry = { fn: DrawCallback; scene: string; registry?: unknown };
const callbacks = new Map<string, DrawEntry>();

export function registerDrawCallback(id: string, fn: DrawCallback, scene?: string): void {
    callbacks.set(id, { fn, scene: scene ?? '' });
}

/** An engine-owned overlay belongs to one world's render passes. @internal */
export function registerScopedDrawCallback(id: string, registry: unknown, fn: DrawCallback): void {
    callbacks.set(id,{fn,scene:'',registry});
}

export function unregisterDrawCallback(id: string): void {
    callbacks.delete(id);
}

export function clearDrawCallbacks(): void {
    callbacks.clear();
}

export function clearSceneDrawCallbacks(sceneName: string): void {
    for (const [id, entry] of callbacks) {
        if (entry.scene === sceneName) {
            callbacks.delete(id);
        }
    }
}

export function getDrawCallbacks(): ReadonlyMap<string, DrawEntry> {
    return callbacks;
}

// =============================================================================
// Over-screen draw callbacks
// =============================================================================
//
// These run once a frame, AFTER the screen overlay: what they draw lies over the
// scene, the post chain and the screen's UI alike — an editor's handles, which
// nothing the game draws may cover. They are given the view of the last camera
// the frame drew, as the post-scene callbacks are given theirs.

const overScreenCallbacks = new Map<string, DrawCallback>();

export function registerOverScreenDrawCallback(id: string, fn: DrawCallback): void {
    overScreenCallbacks.set(id, fn);
}

export function unregisterOverScreenDrawCallback(id: string): void {
    overScreenCallbacks.delete(id);
}

export function getOverScreenDrawCallbacks(): ReadonlyMap<string, DrawCallback> {
    return overScreenCallbacks;
}

// =============================================================================
// Pre-scene draw callbacks
// =============================================================================
//
// These run BEFORE the scene's sprites are flushed (see RenderPipeline), so what
// they draw is occluded by scene entities — the seam an editor underlay (grid,
// world-space guides) needs. The post-scene `DrawCallback`s above draw on top.
// Callbacks receive the camera's pixel viewport so they can derive aspect / zoom.

export interface PreSceneDrawInfo {
    /** Camera viewport width in pixels (drives aspect). */
    width: number;
    /** Camera viewport height in pixels. */
    height: number;
    /** Seconds since app start (same clock as the post-scene callbacks). */
    elapsed: number;
}

export type PreSceneDrawCallback = (info: PreSceneDrawInfo) => void;

const preSceneCallbacks = new Map<string, PreSceneDrawCallback>();

export function registerPreSceneDrawCallback(id: string, fn: PreSceneDrawCallback): void {
    preSceneCallbacks.set(id, fn);
}

export function unregisterPreSceneDrawCallback(id: string): void {
    preSceneCallbacks.delete(id);
}

export function getPreSceneDrawCallbacks(): ReadonlyMap<string, PreSceneDrawCallback> {
    return preSceneCallbacks;
}
