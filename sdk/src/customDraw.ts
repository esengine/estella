/**
 * @file    customDraw.ts
 * @brief   Custom draw callback registration for the render pipeline
 */

export type DrawCallback = (elapsed: number) => void;

const callbacks = new Map<string, { fn: DrawCallback; scene: string }>();

export function registerDrawCallback(id: string, fn: DrawCallback, scene?: string): void {
    callbacks.set(id, { fn, scene: scene ?? '' });
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

export function getDrawCallbacks(): ReadonlyMap<string, { fn: DrawCallback; scene: string }> {
    return callbacks;
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
