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
