/**
 * @file    customDraw.ts
 * @brief   Custom draw callback registration for the render pipeline
 */

export type DrawCallback = (elapsed: number) => void;

const callbacks = new Map<string, DrawCallback>();

export function registerDrawCallback(id: string, fn: DrawCallback): void {
    callbacks.set(id, fn);
}

export function unregisterDrawCallback(id: string): void {
    callbacks.delete(id);
}

export function clearDrawCallbacks(): void {
    callbacks.clear();
}

export function getDrawCallbacks(): ReadonlyMap<string, DrawCallback> {
    return callbacks;
}
