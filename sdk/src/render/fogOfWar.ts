// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  fogOfWar.ts
 * @brief The fog of war of a 2D scene: ground a `SightViewer` has never seen is dark, ground it has seen and left is remembered, ground in view is clear.
 *
 * @details `FogOfWar` goes on an entity with a `Transform` and names the world rectangle the fog covers (centred on the entity) and how many texels a
 *          side the maps are. Each frame every viewer's field of view is found by casting rays against the same walls `SightViewer` is stopped by,
 *          and painted twice: into a map of where anyone sees NOW (cleared each frame) and into one of where anyone has EVER seen (never cleared).
 *          A `fog2d` effect reads both. The same field is marked into a grid on the CPU, which is what survives a lost graphics device, and what
 *          `exploredToString` / `exploredFromString` save and restore: a save file keeps what the player has found.
 *
 *          One rectangle, one pair of maps: the world has to fit in `width` by `height`. A larger world wants a fog that is paged by chunk, which this is not.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, Transform, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { Query } from '../ecs/query';
import { isEditor, isPlayMode } from '../ecs/env';
import { Draw } from './draw';
import { BlendMode } from './blend';
import { Renderer } from './renderer';
import { RenderTexture, type RenderTextureHandle } from './renderTexture';
import { SightViewer, currentSightRings, type SightPoint, type SightRing, type SightViewerData } from './sight';
import { log } from '../util/logger';
import { FOG_EXPLORED_TEXTURE, FOG_VISIBLE_TEXTURE } from '../postprocess/fogOfWarMask';
import { runtimeTextureRef } from '../postprocess/runtimeTextures';
import type { BlendedEffect } from '../postprocess/volumeBlending';

/** The fields of the `FogOfWar` component. @experimental */
export interface FogOfWarData {
    /** The world rectangle the fog covers, centred on the entity, in world units. */
    width: number;
    height: number;
    /** How many texels a side the maps are. More is finer edges and more to paint. */
    texels: number;
    /** How far a viewer with no `radius` of its own sees, in world units. */
    viewRadius: number;
    /** How many rays are cast from each viewer: the fineness of the field of view's edge. */
    rays: number;
    /** Off: the fog is not painted and the effect draws nothing. */
    enabled: boolean;
}

/**
 * Names the world rectangle a 2D fog of war covers. Put a `fog2d` effect in the scene's post-process volume to draw it.
 *
 * @experimental
 */
export const FogOfWar = defineComponent<FogOfWarData>('FogOfWar',
    { width: 4096, height: 4096, texels: 512, viewRadius: 400, rays: 256, enabled: true },
    {
        fields: {
            width: { min: 1, step: 16, unit: 'wu', tooltip: 'The world rectangle the fog covers, centred on this entity.' },
            height: { min: 1, step: 16, unit: 'wu', tooltip: 'The world rectangle the fog covers, centred on this entity.' },
            texels: { min: 32, max: 2048, step: 32, tooltip: 'How many texels a side the maps are: finer edges, and more to paint.' },
            viewRadius: { min: 1, step: 1, unit: 'wu', tooltip: 'How far a viewer with no radius of its own sees.' },
            rays: { min: 16, max: 1024, step: 8, tooltip: "How many rays are cast from each viewer: the fineness of the field of view's edge." },
        },
    },
);

/**
 * How far one ray from `origin` goes before a wall stops it, for `rays` rays evenly round the circle, none longer than `radius`. A wall that contains
 * `origin` stops nothing, as for `SightViewer`: standing in a bush you see out of it.
 */
export function fanDistances(origin: SightPoint, radius: number, rings: readonly SightRing[], rays: number): Float32Array {
    const out = new Float32Array(rays).fill(radius);
    // Only the walls the circle can touch, and only their edges.
    const edges: number[] = [];
    for (const ring of rings) {
        if (ring.length < 3) continue;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of ring) {
            if (p.x < x0) x0 = p.x;
            if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.y > y1) y1 = p.y;
        }
        if (x1 < origin.x - radius || x0 > origin.x + radius || y1 < origin.y - radius || y0 > origin.y + radius) continue;
        if (containsPoint(ring, origin)) continue;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) edges.push(ring[j]!.x, ring[j]!.y, ring[i]!.x, ring[i]!.y);
    }
    if (edges.length === 0) return out;
    for (let r = 0; r < rays; r++) {
        const angle = (r / rays) * Math.PI * 2;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        let best = radius;
        for (let e = 0; e < edges.length; e += 4) {
            // Ray origin + t * (dx, dy) against the edge a + u * (b - a).
            const ax = edges[e]!, ay = edges[e + 1]!, ex = edges[e + 2]! - ax, ey = edges[e + 3]! - ay;
            const denom = dx * ey - dy * ex;
            if (denom === 0) continue;
            const wx = ax - origin.x, wy = ay - origin.y;
            const t = (wx * ey - wy * ex) / denom;
            const u = (wx * dy - wy * dx) / denom;
            if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
        }
        out[r] = best;
    }
    return out;
}

function containsPoint(ring: SightRing, p: SightPoint): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!, b = ring[j]!;
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

/** What has been seen, on a grid of cells over the fog's rectangle: the part that survives a lost device and goes into a save. */
export class ExploredGrid {
    readonly cells: Uint8Array;

    constructor(readonly size: number) {
        this.cells = new Uint8Array(size * size);
    }

    /** Marks the cell holding a world point, given the rectangle's low corner and its edge. True when it was new. */
    mark(x: number, y: number, left: number, bottom: number, width: number, height: number): boolean {
        const cx = Math.floor(((x - left) / width) * this.size), cy = Math.floor(((y - bottom) / height) * this.size);
        if (cx < 0 || cy < 0 || cx >= this.size || cy >= this.size) return false;
        const i = cy * this.size + cx;
        if (this.cells[i]) return false;
        this.cells[i] = 1;
        return true;
    }

    /** Marks everything the rays of one viewer reach, a block of cells round each step along each ray. */
    markFan(origin: SightPoint, distances: Float32Array, left: number, bottom: number, width: number, height: number): boolean {
        const cell = Math.min(width, height) / this.size;
        const around = Math.max(1, Math.ceil((Math.PI * 2 * Math.max(...distances)) / distances.length / cell / 2));
        let changed = false;
        for (let r = 0; r < distances.length; r++) {
            const angle = (r / distances.length) * Math.PI * 2;
            const dx = Math.cos(angle) * cell, dy = Math.sin(angle) * cell;
            const steps = Math.floor(distances[r]! / cell);
            for (let s = 0; s <= steps; s++) {
                const x = origin.x + dx * s, y = origin.y + dy * s;
                for (let oy = -around + 1; oy < around; oy++) for (let ox = -around + 1; ox < around; ox++) {
                    if (this.mark(x + ox * cell, y + oy * cell, left, bottom, width, height)) changed = true;
                }
            }
        }
        return changed;
    }

    /** The grid as a string a save file can hold: run lengths of its cells, in base 36. */
    toString(): string {
        const runs: string[] = [];
        let value = 0, length = 0;
        for (const c of this.cells) {
            if (c === value) { length++; continue; }
            runs.push(length.toString(36));
            value = c;
            length = 1;
        }
        runs.push(length.toString(36));
        return `${this.size}:${runs.join(',')}`;
    }

    /** Takes what {@link toString} wrote. False, leaving the grid as it was, for a string of another size or a damaged one. */
    fromString(text: string): boolean {
        const [head, body] = text.split(':');
        if (Number(head) !== this.size || body === undefined) return false;
        const next = new Uint8Array(this.cells.length);
        let at = 0, value = 0;
        for (const run of body.split(',')) {
            const length = parseInt(run, 36);
            if (!Number.isFinite(length) || at + length > next.length) return false;
            if (value) next.fill(1, at, at + length);
            at += length;
            value ^= 1;
        }
        if (at !== next.length) return false;
        this.cells.set(next);
        return true;
    }
}

interface FogState {
    ref: { explored: string; visible: string };
    left: number;
    bottom: number;
    width: number;
    height: number;
}

let fogNow: FogState | null = null;
let gridNow: ExploredGrid | null = null;

/** What has been seen so far, as a string for a save file; empty when there is no fog. */
export function exploredToString(): string {
    return gridNow ? gridNow.toString() : '';
}

/** Restores what a save kept. The fog repaints its map from it on the next frame. False when there is no fog yet or the string does not fit it. */
export function exploredFromString(text: string): boolean {
    if (!gridNow || !gridNow.fromString(text)) return false;
    repaintRequested = true;
    return true;
}

let repaintRequested = false;

/** Hands a `fog2d` effect the maps painted this frame and where they lie; with no fog the effect is turned off, so the whole picture is not black. */
export function applyFogOfWarToFog(effects: Map<string, BlendedEffect>): void {
    const fog = effects.get('fog2d');
    if (!fog || !fog.enabled) return;
    const state = fogNow;
    if (!state) { fog.enabled = false; return; }
    fog.uniforms.set('u_fogL', state.left);
    fog.uniforms.set('u_fogB', state.bottom);
    fog.uniforms.set('u_fogW', state.width);
    fog.uniforms.set('u_fogH', state.height);
    fog.textures.set(FOG_EXPLORED_TEXTURE, state.ref.explored);
    fog.textures.set(FOG_VISIBLE_TEXTURE, state.ref.visible);
}

/** Column-major orthographic projection over a rectangle: what RenderTexture.begin wants. */
function ortho(l: number, r: number, b: number, t: number): Float32Array {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l);
    m[5] = 2 / (t - b);
    m[10] = -1;
    m[12] = -(r + l) / (r - l);
    m[13] = -(t + b) / (t - b);
    m[15] = 1;
    return m;
}

/** Installs the system that finds each viewer's field of view and paints the fog maps. Returns the function that lets everything go. */
export function installFogOfWar(app: App): () => void {
    let explored: RenderTextureHandle | null = null;
    let visible: RenderTextureHandle | null = null;
    let grid: ExploredGrid | null = null;
    let failed = false;

    const release = (): void => {
        if (explored) RenderTexture.release(explored);
        if (visible) RenderTexture.release(visible);
        explored = visible = null;
        grid = gridNow = null;
    };

    const system = defineSystem(
        [Query(FogOfWar, Transform), Query(SightViewer, Transform)],
        (
            fogs: Iterable<[Entity, FogOfWarData, TransformData]>,
            viewers: Iterable<[Entity, SightViewerData, TransformData]>,
        ) => {
            fogNow = null;
            if (failed || (isEditor() && !isPlayMode())) return;
            let fog: FogOfWarData | null = null, centre: TransformData | null = null;
            for (const [, data, transform] of fogs) {
                if (data.enabled && data.width > 0 && data.height > 0) { fog = data; centre = transform; break; }
            }
            if (!fog || !centre) { if (explored) release(); return; }
            try {
                const texels = Math.min(Math.max(Math.round(fog.texels), 32), 2048);
                if (explored && explored.width !== texels) release();
                if (!explored || !visible) {
                    const a = RenderTexture.create({ width: texels, height: texels, depth: false, filter: 'linear' });
                    const b = RenderTexture.create({ width: texels, height: texels, depth: false, filter: 'linear' });
                    // The renderer may not be up yet: try again next frame.
                    if (a.textureId === 0 || a.texture === 0 || b.textureId === 0 || b.texture === 0) { RenderTexture.release(a); RenderTexture.release(b); return; }
                    explored = a;
                    visible = b;
                    grid = gridNow = new ExploredGrid(texels);
                    repaintRequested = true;
                }
                const left = centre.worldPosition.x - fog.width / 2, bottom = centre.worldPosition.y - fog.height / 2;
                const right = left + fog.width, top = bottom + fog.height;
                const vp = ortho(left, right, bottom, top);
                const cx = (left + right) / 2, cy = (bottom + top) / 2;
                const texelWorld = Math.min(fog.width, fog.height) / texels;
                const rings = currentSightRings();

                // Every viewer's field of view this frame.
                const fans: Array<{ at: SightPoint; distances: Float32Array; thickness: number }> = [];
                for (const [, viewer, transform] of viewers) {
                    if (!viewer.enabled) continue;
                    const at = { x: transform.worldPosition.x, y: transform.worldPosition.y };
                    const radius = viewer.radius > 0 ? viewer.radius : fog.viewRadius;
                    const rays = Math.min(Math.max(Math.round(fog.rays), 16), 1024);
                    const distances = fanDistances(at, radius, rings, rays);
                    // Wide enough that neighbouring rays meet at the far end of the longest one.
                    fans.push({ at, distances, thickness: Math.max(((Math.PI * 2 * radius) / rays) * 1.4, texelWorld * 1.5) });
                    grid!.markFan(at, distances, left, bottom, fog.width, fog.height);
                }

                const lines = (list: typeof fans): void => {
                    Draw.setBlendMode(BlendMode.Lighten);
                    for (const fan of list) {
                        for (let r = 0; r < fan.distances.length; r++) {
                            const angle = (r / fan.distances.length) * Math.PI * 2;
                            const d = fan.distances[r]!;
                            Draw.line(fan.at, { x: fan.at.x + Math.cos(angle) * d, y: fan.at.y + Math.sin(angle) * d }, { r: 1, g: 0, b: 0, a: 1 }, fan.thickness);
                        }
                    }
                };
                const pass = (target: RenderTextureHandle, body: () => void): void => {
                    RenderTexture.begin(target, vp);
                    Draw.begin(vp);
                    // Draw.begin resets the viewport to the screen's; the target's own is what this pass is.
                    Renderer.setViewport(0, 0, target.width, target.height);
                    body();
                    Draw.end();
                    RenderTexture.end();
                    RenderTexture.contentDrawn(target);
                };
                const clear = (): void => {
                    Draw.setBlendMode(BlendMode.None);
                    Draw.rect({ x: cx, y: cy }, { x: fog!.width, y: fog!.height }, { r: 0, g: 0, b: 0, a: 0 });
                };

                pass(visible, () => { clear(); lines(fans); });
                if (repaintRequested || RenderTexture.contentLost(explored)) {
                    // Rebuilt from the grid: what a save restored, or what a lost device took. Runs of cells along a row are one rectangle each.
                    repaintRequested = false;
                    pass(explored, () => {
                        clear();
                        Draw.setBlendMode(BlendMode.Lighten);
                        const size = grid!.size, cellW = fog!.width / size, cellH = fog!.height / size;
                        for (let y = 0; y < size; y++) {
                            let x = 0;
                            while (x < size) {
                                if (!grid!.cells[y * size + x]) { x++; continue; }
                                let end = x;
                                while (end < size && grid!.cells[y * size + end]) end++;
                                Draw.rect({ x: left + ((x + end) / 2) * cellW, y: bottom + (y + 0.5) * cellH }, { x: (end - x) * cellW, y: cellH }, { r: 1, g: 0, b: 0, a: 1 });
                                x = end;
                            }
                        }
                    });
                }
                if (fans.length > 0) pass(explored, () => lines(fans));

                fogNow = {
                    ref: { explored: runtimeTextureRef(FOG_EXPLORED_TEXTURE, explored.texture), visible: runtimeTextureRef(FOG_VISIBLE_TEXTURE, visible.texture) },
                    left, bottom, width: fog.width, height: fog.height,
                };
            } catch (error) {
                failed = true;
                log.warn('fog', `the fog of war cannot be painted on this device: ${String(error)}`);
            }
        },
        { name: 'FogOfWarSystem' },
    );
    // After the sight system has read the walls (it is installed first), and before the frame is drawn.
    app.addSystemToSchedule(Schedule.PostUpdate, system);

    return () => {
        fogNow = null;
        release();
    };
}
