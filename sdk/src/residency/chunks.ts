// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    chunks.ts
 * @brief   The one owner of procedural chunks: what is made round the streaming sources, in what order, within the frame's budget,
 *          and when it is let go.
 *
 * @details A cooked world's cells are scenes, brought in by the WorldStreamer. What a game makes as it runs (the ground's collision
 *          round what moves, plants round the eye, and later what stands in a biome) is chunks of layers, and this is the single
 *          author of their lifetime, as the streamer is of cells. A layer says how it is cut, how far round its sources it is wanted
 *          and how one chunk is made, published and released; the layer never decides on its own that a chunk exists.
 *
 *            - Every frame the chunks within a layer's load radius of a source are wanted, nearest first across every layer; the
 *              ones a source stands in are made at once, the rest while the frame's budget (Bakes) lasts.
 *            - A chunk past every source's unload radius is released: whatever it published (meshes, colliders, entities) goes with
 *              it, so a source walking for ever holds a bounded number of chunks.
 *            - A layer's `generation` names its inputs. When it changes every chunk is made again; until a chunk's new version is
 *              published its old one stays, so nothing standing on it falls, and an answer that arrives for an older generation (a
 *              provider still working on the planet just left) is thrown away, never published.
 *            - A chunk whose making throws is failed until the generation changes, and says why.
 */
import { createAbort, type AbortHandle } from '../util/abort';
import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import { defineSystem, Schedule } from '../ecs/system';
import { Camera, Transform, type CameraData, type TransformData } from '../ecs/component';
import { EditorView, editorViewEye } from '../camera/EditorView';
import { WorldStreamingSource, type WorldStreamingSourceData } from './components';
import { bakesOf } from '../runtime/bakes';
import { log } from '../util/logger';

/** A place a layer is wanted round, on the layer's plane (the ground by default), in world units. */
export interface ChunkSource { x: number; z: number; /** Its height, where a layer is not on a plane (a planet's collision reads the whole position). */ y?: number }

/** One kind of chunk: how it is cut, where it is wanted and how it is made. */
export interface ChunkLayer<T> {
    /** What the layer is, for the progress shown while its chunks are made. */
    readonly label: string;
    /**
     * The world plane the chunk grid lies on. `'xz'` (the default) is the ground of a 3D world and chunks are cut along world x and z. `'xy'` is a 2D
     * world, whose ground is the screen plane: chunks are cut along world x and y, and every place below called z is world y. It decides how the world's own
     * streaming sources (and the camera) are read; a layer's own `sources()` already answer in the layer's plane.
     */
    plane?: 'xz' | 'xy';
    /** The world position of chunk (0, 0)'s corner, and the side of a chunk along the plane's two axes (x, then z, or y on 'xy'). */
    originX: number;
    originZ: number;
    sizeX: number;
    sizeZ: number;
    /** The chunks there are, [x0, z0, x1, z1) in chunk coordinates; null for no end. */
    extent: readonly [number, number, number, number] | null;
    /** Chunks within this of a source are wanted; one is let go once past `unloadRadius` of every source. */
    loadRadius: number;
    unloadRadius: number;
    /** Names the layer's inputs: when it changes every chunk is made again, and answers for an older one are thrown away. */
    generation: number | string;
    /** Where the layer is wanted round; absent, the world's streaming sources (or the eye, where there are none). */
    sources?(): Iterable<ChunkSource>;
    /** True when `make` answers later, off the main thread: the layer is then asked for every chunk it wants, at once, and is not held to the frame's time. */
    async?: boolean;
    /** Makes a chunk. Null is "not yet" (what it stands on is not ready) and is asked again later; a promise answers later. */
    make(cx: number, cz: number, signal: AbortSignal): T | null | Promise<T | null>;
    /** Puts a made chunk into the world. An older version of it, if one was published, has just been released. */
    publish(cx: number, cz: number, value: T): void;
    /** Takes a published chunk out of the world: everything it put there. */
    release(cx: number, cz: number, value: T): void;
}

/** Where one chunk stands: being made, published (for the layer's generation now, or an older one), or failed. */
export type ChunkState = 'making' | 'ready' | 'stale' | 'failed';

/** A layer's chunks, counted. */
export interface ChunkLayerStatus {
    /** Published for the generation now. */
    ready: number;
    /** Published for an older generation, waiting to be made again. */
    stale: number;
    /** Wanted and not published yet (including those being made). */
    pending: number;
    making: number;
    failed: number;
    /** Why the first failed chunk failed. */
    reason?: string;
}

interface Chunk<T> {
    cx: number;
    cz: number;
    /** What is published now, and for which generation. */
    value: T | null;
    publishedFor: number | string | null;
    /** Being made: for which generation, and how to stop it. */
    making: { generation: number | string; abort: AbortHandle } | null;
    failedFor: number | string | null;
    reason?: string;
}

interface Layer<T> {
    def: ChunkLayer<T>;
    chunks: Map<string, Chunk<T>>;
    /** The chunks within the load radius of a source, as of the last frame. */
    wanted: Set<string>;
}

/** At most this many chunks of a layer are answered later at once. */
const MAX_IN_FLIGHT = 16;

const keyOf = (cx: number, cz: number): string => `${cx},${cz}`;

/** What a published chunk's generation is set to when it is made out of date by hand: no layer's generation. */
const OUTDATED = Symbol('outdated') as unknown as string;

/** The procedural chunks of every layer. Read {@link ProceduralChunks.status} for where they stand. */
export class ProceduralChunks {
    private readonly layers_ = new Map<string, Layer<unknown>>();
    /** @internal Set by the plugin: the world's own sources, sampled once a frame. */
    sources_: () => ChunkSource[] = () => [];
    /** True while something else is showing this world (the editor's play realm has its own): no place is wanted, so every chunk is let go. */
    suspended = false;

    /** Adds a layer under `id`, or takes the new definition of one already there (its chunks stay and follow the new generation). */
    set<T>(id: string, def: ChunkLayer<T>): void {
        const had = this.layers_.get(id);
        if (had) had.def = def as ChunkLayer<unknown>;
        else this.layers_.set(id, { def: def as ChunkLayer<unknown>, chunks: new Map(), wanted: new Set() });
    }

    /** Takes a layer away, releasing every chunk it published and stopping what is being made. */
    remove(id: string): void {
        const layer = this.layers_.get(id);
        if (!layer) return;
        for (const c of layer.chunks.values()) this.drop(layer, c);
        this.layers_.delete(id);
    }

    has(id: string): boolean {
        return this.layers_.has(id);
    }

    /** Where the chunk of layer `id` at world (x, z) (x, y on an 'xy' layer) stands, or null when it is not wanted, not made, or there is no such layer. */
    stateAt(id: string, x: number, z: number): ChunkState | null {
        const layer = this.layers_.get(id);
        if (!layer) return null;
        const d = layer.def;
        const c = layer.chunks.get(keyOf(Math.floor((x - d.originX) / d.sizeX), Math.floor((z - d.originZ) / d.sizeZ)));
        return c ? stateOf(c, d.generation) : null;
    }

    /** Layer `id`'s chunks counted, or null when there is no such layer. */
    status(id: string): ChunkLayerStatus | null {
        const layer = this.layers_.get(id);
        if (!layer) return null;
        const s: ChunkLayerStatus = { ready: 0, stale: 0, pending: pendingOf(layer), making: 0, failed: 0 };
        for (const c of layer.chunks.values()) {
            if (c.making) s.making++;
            if (stateOf(c, layer.def.generation) === 'failed') { s.failed++; s.reason ??= c.reason; }
            if (c.value !== null) { if (c.publishedFor === layer.def.generation) s.ready++; else s.stale++; }
        }
        return s;
    }

    /** How many chunks every layer still wants made. */
    get pending(): number {
        let n = 0;
        for (const layer of this.layers_.values()) n += pendingOf(layer);
        return n;
    }

    /**
     * Makes the published chunks of layer `id` that touch the world square [x0, x1] by [z0, z1] again, each keeping its old version
     * until the new one replaces it: what changed there (a zone, a felled tree) changed only them.
     */
    invalidate(id: string, x0: number, z0: number, x1: number, z1: number): void {
        const layer = this.layers_.get(id);
        if (!layer) return;
        const d = layer.def;
        const cx0 = Math.floor((x0 - d.originX) / d.sizeX), cx1 = Math.floor((x1 - d.originX) / d.sizeX);
        const cz0 = Math.floor((z0 - d.originZ) / d.sizeZ), cz1 = Math.floor((z1 - d.originZ) / d.sizeZ);
        for (const c of layer.chunks.values()) {
            if (c.cx < cx0 || c.cx > cx1 || c.cz < cz0 || c.cz > cz1) continue;
            if (c.value !== null) c.publishedFor = OUTDATED;
            c.failedFor = null;
            c.making?.abort.abort();
            c.making = null;
        }
    }

    /** Lets go of every chunk of every layer. */
    clear(): void {
        for (const id of [...this.layers_.keys()]) this.remove(id);
    }

    /**
     * One frame: releases what no source is near, then makes what is wanted, nearest first across every layer: the chunks a source
     * stands in at once, and the rest while `hasTime` says so (an `async` layer's, all of them).
     */
    step(hasTime: () => boolean): void {
        const world = this.suspended ? [] : this.sources_();
        const wanted: { layer: Layer<unknown>; cx: number; cz: number; dist: number }[] = [];
        for (const layer of this.layers_.values()) {
            const d = layer.def;
            const sources = d.sources ? [...d.sources()] : d.plane === 'xy' ? world.map((s) => ({ x: s.x, z: s.y ?? 0 })) : world;
            const near = new Map<string, number>();
            const keep = new Set<string>();
            for (const s of sources) {
                const reach = Math.max(d.loadRadius, d.unloadRadius);
                const x0 = Math.floor((s.x - reach - d.originX) / d.sizeX), x1 = Math.floor((s.x + reach - d.originX) / d.sizeX);
                const z0 = Math.floor((s.z - reach - d.originZ) / d.sizeZ), z1 = Math.floor((s.z + reach - d.originZ) / d.sizeZ);
                // A layer with an extent is walked over the part of the radius that lies in it, not over a radius that may be a thousand times the area.
                const ex = d.extent;
                const cx0 = ex ? Math.max(x0, ex[0]) : x0, cx1 = ex ? Math.min(x1, ex[2] - 1) : x1;
                const cz0 = ex ? Math.max(z0, ex[1]) : z0, cz1 = ex ? Math.min(z1, ex[3] - 1) : z1;
                for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
                    const mx = d.originX + cx * d.sizeX, mz = d.originZ + cz * d.sizeZ;
                    const dist = Math.hypot(Math.max(mx - s.x, 0, s.x - mx - d.sizeX), Math.max(mz - s.z, 0, s.z - mz - d.sizeZ));
                    const key = keyOf(cx, cz);
                    if (dist <= d.unloadRadius) keep.add(key);
                    if (dist <= d.loadRadius && dist < (near.get(key) ?? Infinity)) near.set(key, dist);
                }
            }
            for (const [key, c] of layer.chunks) {
                if (near.has(key) || keep.has(key)) continue;
                this.drop(layer, c);
                layer.chunks.delete(key);
            }
            layer.wanted = new Set(near.keys());
            for (const [key, dist] of near) {
                const c = layer.chunks.get(key);
                const state = c ? stateOf(c, d.generation) : null;
                if (state === 'ready' || state === 'failed' || c?.making) continue;
                const [cx, cz] = key.split(',').map(Number) as [number, number];
                wanted.push({ layer, cx, cz, dist });
            }
        }
        wanted.sort((a, b) => a.dist - b.dist);
        const inFlight = new Map<Layer<unknown>, number>();
        for (const layer of this.layers_.values()) {
            let n = 0;
            for (const c of layer.chunks.values()) if (c.making) n++;
            inFlight.set(layer, n);
        }
        for (const w of wanted) {
            // A layer whose chunks are answered later (off the main thread) takes no time from the frame: it is not held to the frame's budget.
            if (w.dist > 0 && !w.layer.def.async && !hasTime()) continue;
            if ((inFlight.get(w.layer) ?? 0) >= MAX_IN_FLIGHT) continue;
            if (this.make(w.layer, w.cx, w.cz)) inFlight.set(w.layer, (inFlight.get(w.layer) ?? 0) + 1);
        }
    }

    /** Makes one chunk; true when it is now being answered later. */
    private make(layer: Layer<unknown>, cx: number, cz: number): boolean {
        const key = keyOf(cx, cz);
        let c = layer.chunks.get(key);
        if (!c) {
            c = { cx, cz, value: null, publishedFor: null, making: null, failedFor: null };
            layer.chunks.set(key, c);
        }
        const chunk = c;
        const generation = layer.def.generation;
        const abort = createAbort();
        let made: unknown;
        try {
            made = layer.def.make(cx, cz, abort.signal);
        } catch (e) {
            this.fail(layer, chunk, generation, e);
            return false;
        }
        if (!(made instanceof Promise)) {
            if (made !== null) this.publish(layer, chunk, made, generation);
            else if (chunk.value === null) layer.chunks.delete(key);
            return false;
        }
        chunk.making = { generation, abort };
        made.then((value) => {
            // Thrown away if the chunk was let go, made again, or the layer moved on while this was being made.
            if (chunk.making?.abort !== abort || abort.signal.aborted) return;
            chunk.making = null;
            if (layer.chunks.get(key) !== chunk || generation !== layer.def.generation) return;
            if (value !== null) this.publish(layer, chunk, value, generation);
        }, (e: unknown) => {
            if (chunk.making?.abort !== abort || abort.signal.aborted) return;
            chunk.making = null;
            if (generation === layer.def.generation) this.fail(layer, chunk, generation, e);
        });
        return true;
    }

    private publish(layer: Layer<unknown>, c: Chunk<unknown>, value: unknown, generation: number | string): void {
        if (c.value !== null) layer.def.release(c.cx, c.cz, c.value);
        c.value = value;
        c.publishedFor = generation;
        c.failedFor = null;
        c.reason = undefined;
        layer.def.publish(c.cx, c.cz, value);
    }

    private fail(layer: Layer<unknown>, c: Chunk<unknown>, generation: number | string, e: unknown): void {
        c.failedFor = generation;
        c.reason = e instanceof Error ? e.message : String(e);
        log.error('chunks', `making chunk ${c.cx},${c.cz} of ${layer.def.label} failed`, e);
    }

    /** Releases what a chunk published and stops what it is making. */
    private drop(layer: Layer<unknown>, c: Chunk<unknown>): void {
        c.making?.abort.abort();
        c.making = null;
        if (c.value !== null) layer.def.release(c.cx, c.cz, c.value);
        c.value = null;
        c.publishedFor = null;
    }

    /** @internal The labels and progress of the layers still making chunks, for the bakes list. */
    progress_(): { label: string; progress: number; owner: object }[] {
        const out: { label: string; progress: number; owner: object }[] = [];
        for (const layer of this.layers_.values()) {
            const pending = pendingOf(layer);
            if (pending === 0) continue;
            const ready = layer.wanted.size - pending;
            out.push({ label: layer.def.label, progress: ready / layer.wanted.size, owner: layer });
        }
        return out;
    }
}

/** The wanted chunks not yet published for the generation now (nor failed for it). */
function pendingOf(layer: Layer<unknown>): number {
    let n = 0;
    for (const key of layer.wanted) {
        const c = layer.chunks.get(key);
        const state = c ? stateOf(c, layer.def.generation) : null;
        if (state !== 'ready' && state !== 'failed') n++;
    }
    return n;
}

function stateOf(c: Chunk<unknown>, generation: number | string): ChunkState {
    if (c.failedFor === generation) return 'failed';
    if (c.value !== null) return c.publishedFor === generation ? 'ready' : 'stale';
    return 'making';
}

/** The resource; {@link chunksOf} installs it where it is missing. @experimental */
export const ProceduralChunksRes = defineResource<ProceduralChunks>(new ProceduralChunks(), 'ProceduralChunks');

/**
 * The places the world is wanted round: every enabled WorldStreamingSource and, when there is none, the editor's eye while it looks
 * at the scene in 3D, else the active cameras. The same sources the WorldStreamer reads cells by.
 */
export function streamingSourcesOf(app: App): ChunkSource[] {
    const world = app.world;
    world.ensureTransformsComposed();
    const out: ChunkSource[] = [];
    for (const e of world.getEntitiesWithComponents([WorldStreamingSource, Transform])) {
        if (!(world.get(e, WorldStreamingSource) as WorldStreamingSourceData).enabled) continue;
        const p = (world.get(e, Transform) as TransformData).worldPosition;
        out.push({ x: p.x, y: p.y, z: p.z });
    }
    if (out.length > 0) return out;
    if (app.hasResource(EditorView)) {
        const view = app.getResource(EditorView);
        if (view.active && view.perspective) {
            const eye = editorViewEye(view);
            return [{ x: eye.x, y: eye.y, z: eye.z }];
        }
    }
    for (const e of world.getEntitiesWithComponents([Camera, Transform])) {
        if (!(world.get(e, Camera) as CameraData).isActive) continue;
        const p = (world.get(e, Transform) as TransformData).worldPosition;
        out.push({ x: p.x, y: p.y, z: p.z });
    }
    return out;
}

/** The App's procedural chunks, installed (with the system that steps them, after Update) on first use. */
export function chunksOf(app: App): ProceduralChunks {
    if (!app.hasResource(ProceduralChunksRes)) {
        const chunks = new ProceduralChunks();
        chunks.sources_ = () => streamingSourcesOf(app);
        app.insertResource(ProceduralChunksRes, chunks);
        const bakes = bakesOf(app);
        const shown = new Set<object>();
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => {
            app.measureFrameScope('chunks.step', () => chunks.step(() => bakes.hasTime()));
            const now = new Set<object>();
            for (const p of chunks.progress_()) { bakes.mark(p.owner, p.label, p.progress); now.add(p.owner); }
            for (const owner of shown) if (!now.has(owner)) bakes.clear(owner);
            shown.clear();
            for (const owner of now) shown.add(owner);
        }, { name: 'ProceduralChunkSystem' }));
    }
    return app.getResource(ProceduralChunksRes);
}
