// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    customDraw.ts
 * @brief   Custom draw callback registration for the render pipeline
 */
import type { World } from '../ecs/world';
import type { Vec2, Vec3 } from '../types';
import { log } from '../util/logger';

/** The camera facts used by the draw pass invoking a callback. */
export interface DrawFrameInfo {
    /** Matrix used by Draw for this pass. Valid for the callback. */
    readonly viewProjection: Float32Array;
    /** Subtract this world origin from positions submitted to Draw, when present. */
    readonly origin?: Readonly<Vec3>;
    /** Editor parallax center in the renderer's rebased coordinates. */
    readonly parallaxCenter?: Readonly<Vec2>;
    /** Framebuffer viewport dimensions used by Draw.begin. */
    readonly width: number;
    readonly height: number;
}

export type DrawCallback = (elapsed: number, frame: DrawFrameInfo) => void;

/**
 * Limit a draw callback to this world's cameras and this active scene. Two worlds
 * can use the same name. A registration without a world replaces that name globally.
 * @experimental
 */
export interface DrawCallbackOptions {
    readonly world?: World;
    readonly scene?: string;
}

/** @experimental */
export interface OverScreenDrawOptions extends DrawCallbackOptions {
    /** Draw after absolute callbacks in the scene's render coordinates when the frame has an origin. */
    readonly renderSpace?: boolean;
}

/** @internal */
export interface DrawRegistration<T> {
    readonly name: string;
    readonly fn: T;
    readonly scene: string;
    readonly world?: World;
    readonly renderSpace: boolean;
    readonly registry: ReturnType<World['getCppRegistry']> | undefined;
    release(): void;
}

type DrawKey = string | symbol;

/** Each name has a global installation or one per world. Stable slots preserve drawing order on replacement. */
class DrawCallbacks<T> {
    readonly entries = new Map<DrawKey, DrawRegistration<T>>();
    private ordered_?: ReadonlyArray<[DrawKey, DrawRegistration<T>]>;
    constructor(private readonly phase_: string) {}

    /** Capture the pass order once per change. A callback can release or replace itself while drawing. */
    dispatch(registry: NonNullable<ReturnType<World['getCppRegistry']>>, scenes: ReadonlySet<string> | null,
             begin: () => void, draw: (fn: T) => void, renderSpace?: boolean): boolean {
        const ordered = this.ordered_ ??= Array.from(this.entries);
        let started = false;
        for (const [key, entry] of ordered) {
            if (renderSpace !== undefined && entry.renderSpace !== renderSpace) continue;
            if (this.entries.get(key) !== entry || (entry.world && entry.registry !== registry)) continue;
            if (entry.scene && scenes && !scenes.has(entry.scene)) continue;
            if (!started) { begin(); started = true; }
            try { draw(entry.fn); }
            catch (error) {
                log.error('render', `${this.phase_}callback '${entry.name}' error`, error);
                entry.release();
            }
        }
        return started;
    }

    private readonly slots_ = new Map<DrawKey, Map<World | undefined, DrawKey>>();

    register(name: DrawKey, fn: T, { world, scene = '', renderSpace = false }: OverScreenDrawOptions = {}): () => void {
        let slots = this.slots_.get(name);
        if (!slots) this.slots_.set(name, slots = new Map());
        let key = slots.get(world) ?? slots.get(undefined);
        if (world) {
            slots.delete(undefined);
        } else {
            // An explicit global registration replaces the name everywhere, just like global removal.
            for (const prior of slots.values()) {
                key ??= prior;
                if (prior !== key) this.entries.delete(prior);
            }
            slots.clear();
        }
        const label = typeof name === 'string' ? name : name.description ?? '';
        const slot = key ?? (world ? Symbol(label) : name);
        slots.set(world, slot);
        const entry: DrawRegistration<T> = {
            name: label, fn, scene, world, renderSpace,
            get registry() { return world?.getCppRegistry(); },
            release: () => {
                if (this.entries.get(slot) !== entry) return;
                this.entries.delete(slot);
                this.ordered_ = undefined;
                slots.delete(world);
                if (slots.size === 0) this.slots_.delete(name);
            },
        };
        this.entries.set(slot, entry);
        this.ordered_ = undefined;
        return entry.release;
    }

    remove(name: string): void {
        const slots = this.slots_.get(name);
        if (slots) for (const key of slots.values()) this.entries.get(key)?.release();
    }
}

/** @internal */
export const sceneDrawCallbacks = new DrawCallbacks<DrawCallback>('');

/** Install or replace a named draw callback. The returned function releases this installation. */
export function registerDrawCallback(id: string, fn: DrawCallback, scene?: string | DrawCallbackOptions): () => void {
    return sceneDrawCallbacks.register(id, fn, typeof scene === 'string' ? { scene } : scene);
}

/** An engine overlay has a private name and follows its world even when the registry connects later. @internal */
export function registerWorldDrawCallback(name: symbol, world: World, fn: DrawCallback): () => void {
    return sceneDrawCallbacks.register(name, fn, { world });
}

export function unregisterDrawCallback(id: string): void {
    sceneDrawCallbacks.remove(id);
}

export function clearDrawCallbacks(): void {
    for (const entry of sceneDrawCallbacks.entries.values()) entry.release();
}

/** A core teardown also clears legacy game callbacks registered without an owner. @internal */
export function clearWorldDrawCallbacks(world: World, includeGlobal = false): void {
    for (const entry of sceneDrawCallbacks.entries.values()) if (entry.world === world || (includeGlobal && !entry.world)) entry.release();
    for (const entry of preSceneCallbacks.entries.values()) if (entry.world === world) entry.release();
    for (const entry of overScreenCallbacks.entries.values()) if (entry.world === world) entry.release();
}

export function clearSceneDrawCallbacks(sceneName: string): void {
    for (const entry of sceneDrawCallbacks.entries.values()) if (entry.scene === sceneName) entry.release();
}

export function getDrawCallbacks(): ReadonlyMap<DrawKey, DrawRegistration<DrawCallback>> {
    return sceneDrawCallbacks.entries;
}

// =============================================================================
// Over-screen draw callbacks
// =============================================================================
//
// Run once a frame AFTER the screen overlay, through the last camera's view: over
// the scene, the post chain and the screen's UI alike, as an editor's handles must be.

/** @internal */
export const overScreenCallbacks = new DrawCallbacks<DrawCallback>('over-screen ');

export function registerOverScreenDrawCallback(id: string, fn: DrawCallback, options?: OverScreenDrawOptions): () => void {
    return overScreenCallbacks.register(id, fn, options);
}

export function unregisterOverScreenDrawCallback(id: string): void {
    overScreenCallbacks.remove(id);
}

export function getOverScreenDrawCallbacks(): ReadonlyMap<DrawKey, DrawRegistration<DrawCallback>> {
    return overScreenCallbacks.entries;
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

/** @internal */
export const preSceneCallbacks = new DrawCallbacks<PreSceneDrawCallback>('pre-scene ');

export function registerPreSceneDrawCallback(id: string, fn: PreSceneDrawCallback, options?: DrawCallbackOptions): () => void {
    return preSceneCallbacks.register(id, fn, options);
}

export function unregisterPreSceneDrawCallback(id: string): void {
    preSceneCallbacks.remove(id);
}

export function getPreSceneDrawCallbacks(): ReadonlyMap<DrawKey, DrawRegistration<PreSceneDrawCallback>> {
    return preSceneCallbacks.entries;
}
