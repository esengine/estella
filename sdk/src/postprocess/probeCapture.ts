// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    probeCapture.ts
 * @brief   A probe volume filled at run time: the room as a camera at its centre sees it now.
 *
 * @details The engine draws the scene from the volume's centre into six small faces, one a frame, packs them as RGBM and
 *          reads them back (RenderFrameProbeCapture.cpp). Here they are turned into a panorama — a pixel nothing was drawn
 *          on is the sky, taken from the sky the scene is lit with — projected to nine irradiance coefficients like any
 *          environment, and handed to the engine as a one-point grid the volume reads in place of its bake. Unreal's
 *          real-time Sky Light / Reflection Capture; the "interior environment" a hand-built renderer captures in a shed.
 */

import { defineSystem } from '../ecs/system';
import { Query } from '../ecs/query';
import { Transform, LightProbeVolume, type TransformData, type LightProbeVolumeData } from '../ecs/component';
import type { Entity } from '../types';
import type { ESEngineModule } from '../wasm';
import { withScratch } from '../wasm/wasmScratch';
import { projectIrradianceSH, prefilterOctahedral, type Panorama } from '../lightmap/environmentAtlas';
import { createTextureFromPixels } from '../runtime/runtimeAssets';
import { getResourceManager } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import { panoramaDirection, panoramaUV } from '../lightmap/panorama';

/** Pixels a face is across: the light a room sends is smooth, and six of these are drawn one a frame. */
export const PROBE_CAPTURE_FACE = 32;
const RANGE = 8;
const WIDTH = 64;

// Toward each face and its up, as RenderFrameProbeCapture.cpp draws them: +X -X +Y -Y +Z -Z.
const FACE_DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const FACE_UP = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]] as const;

const cross = (a: readonly number[], b: readonly number[]): number[] =>
    [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const unit = (a: number[]): number[] => { const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1; return [a[0]! / l, a[1]! / l, a[2]! / l]; };

// A lookAt camera's right and up for each face: what the direction's x and y are measured along.
const FACE_BASIS = FACE_DIR.map((f, i) => {
    const right = unit(cross(f, FACE_UP[i]!));
    return { forward: f, right, up: cross(right, f) };
});

/**
 * The six RGBM faces (side by side, rows bottom-up as a readback lands) as a panorama of radiance, Panorama's layout. A
 * pixel with alpha 0 had nothing drawn on it and takes the sky there: `sky`, or black without one.
 */
export function capturePanorama(rgba: Uint8Array, face: number, sky: Panorama | null): Panorama {
    const height = WIDTH >> 1;
    const rgb = new Float32Array(WIDTH * height * 3);
    const stride = face * 6;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const d = panoramaDirection((x + 0.5) / WIDTH, (y + 0.5) / height);
            let f = 0, best = -Infinity;
            for (let i = 0; i < 6; i++) { const c = dot(d, FACE_DIR[i]!); if (c > best) { best = c; f = i; } }
            const b = FACE_BASIS[f]!;
            const z = dot(d, b.forward);
            const u = dot(d, b.right) / z * 0.5 + 0.5, v = dot(d, b.up) / z * 0.5 + 0.5;
            const px = Math.min(face - 1, Math.max(0, Math.floor(u * face)));
            const row = Math.min(face - 1, Math.max(0, Math.floor(v * face)));
            const i = (row * stride + f * face + px) * 4;
            const o = (y * WIDTH + x) * 3;
            if (rgba[i + 3]! === 0) {
                if (sky) {
                    const [su, sv] = panoramaUV(d[0]!, d[1]!, d[2]!);
                    const sx = Math.min(sky.width - 1, Math.floor(su * sky.width));
                    const sy = Math.min(sky.height - 1, Math.floor(sv * sky.height));
                    const s = (sy * sky.width + sx) * 3;
                    rgb[o] = sky.rgb[s]!; rgb[o + 1] = sky.rgb[s + 1]!; rgb[o + 2] = sky.rgb[s + 2]!;
                }
                continue;
            }
            const m = (rgba[i + 3]! / 255) * RANGE;
            rgb[o] = (rgba[i]! / 255) * m; rgb[o + 1] = (rgba[i + 1]! / 255) * m; rgb[o + 2] = (rgba[i + 2]! / 255) * m;
        }
    }
    return { width: WIDTH, height, rgb };
}

interface CaptureCore {
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    renderer_requestProbeCapture?(x: number, y: number, z: number, face: number): void;
    renderer_pollProbeCapture?(): number;
    renderer_takeProbeCapture?(dst: number, bytes: number): boolean;
    renderer_setProbeVolumeOverride?(entity: number, volumeHandle: number): void;
    renderer_setProbeVolumeReflection?(entity: number, environmentHandle: number, slot: number): void;
    environment_create?(shPtr: number, specularHandle: number, faceSize: number, mipCount: number, maxRange: number, columns: number): number;
    environment_release?(environmentHandle: number): void;
    probe_volume_create?(resX: number, resY: number, resZ: number, shPtr: number): number;
    probe_volume_release?(handle: number): void;
}

/** Each capturing volume's grid and when it was last filled, and the one capture in flight. */
interface CaptureState {
    grids: Map<Entity, { handle: number; at: number; panorama: Panorama }>;
    pending: Entity | null;
    /** The reflection atlas the captures make, and the environment the frame reads it through. */
    reflection: { environment: number; texture: number } | null;
    /** The sky panorama that atlas's column 0 was made from: a new sky (the one first made after the captures, a changing
     *  weather) remakes it. */
    sky: Panorama | null;
}

/** The reflections' atlas: the same size as the sky's, so a surface leaving a room sees no change of sharpness. */
const REFLECTION_FACE = 32;
const REFLECTION_MIPS = 3;
const REFLECTION_RANGE = 8;

/**
 * One atlas, column 0 the sky and a column for each capture in order, prefiltered as an environment's reflection is: what
 * a surface inside a captured box reflects is the room around it rather than the sky outside.
 */
export function reflectionAtlas(sky: Panorama, captures: readonly Panorama[]): { width: number; height: number; rgba: Uint8Array; columns: number } {
    const columns = 1 + captures.length;
    const pyramids = [sky, ...captures].map((p) => prefilterOctahedral(p, REFLECTION_FACE, REFLECTION_MIPS, REFLECTION_RANGE));
    const colWidth = pyramids[0]!.width, height = pyramids[0]!.height;
    const rgba = new Uint8Array(colWidth * columns * height * 4);
    pyramids.forEach((pyramid, column) => {
        for (let y = 0; y < height; y++) {
            rgba.set(pyramid.rgba.subarray(y * colWidth * 4, (y + 1) * colWidth * 4), (y * colWidth * columns + column * colWidth) * 4);
        }
    });
    return { width: colWidth * columns, height, rgba, columns };
}

/** Rebuilds the reflection atlas from every capture held, and points each volume at its column; lets the last one go. */
function rebuildReflections(core: CaptureCore, module: ESEngineModule | null, state: CaptureState, sky: Panorama | null): void {
    const entities = [...state.grids.keys()];
    state.sky = sky;
    const drop = state.reflection;
    state.reflection = null;
    if (sky && entities.length && core.environment_create && core.renderer_setProbeVolumeReflection) {
        const atlas = reflectionAtlas(sky, entities.map((e) => state.grids.get(e)!.panorama));
        const texture = createTextureFromPixels(module, { width: atlas.width, height: atlas.height, pixels: atlas.rgba },
            TextureContent.Retained, false, { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
        if (texture) {
            const environment = withScratch(core as never, (alloc: (n: number) => number) => {
                const shPtr = alloc(27 * 4);
                core.HEAPF32.set(projectIrradianceSH(sky), shPtr >> 2);
                return core.environment_create!(shPtr, texture, REFLECTION_FACE, REFLECTION_MIPS, REFLECTION_RANGE, atlas.columns);
            });
            if (environment) {
                state.reflection = { environment, texture };
                entities.forEach((e, i) => core.renderer_setProbeVolumeReflection!(e as unknown as number, environment, i + 1));
            } else {
                getResourceManager()?.releaseTexture(texture);
            }
        }
    }
    if (!state.reflection) for (const e of entities) core.renderer_setProbeVolumeReflection?.(e as unknown as number, 0, 0);
    if (drop) {
        core.environment_release?.(drop.environment);
        getResourceManager()?.releaseTexture(drop.texture);
    }
}

/**
 * The system that keeps capturing volumes filled: one capture at a time, the volume due longest first, again every
 * `captureInterval` seconds (or once). `sky` answers the panorama the scene's sky was last made from, for what shows of it.
 */
export function probeCaptureSystem(module: () => ESEngineModule | null, sky: () => Panorama | null) {
    const state: CaptureState = { grids: new Map(), pending: null, reflection: null, sky: null };
    return defineSystem(
        [Query(LightProbeVolume, Transform)],
        (volumes: Iterable<[Entity, LightProbeVolumeData, TransformData]>) => {
            const core = module() as unknown as CaptureCore | null;
            if (!core?.renderer_requestProbeCapture || !core.renderer_pollProbeCapture || !core.renderer_takeProbeCapture
                || !core.renderer_setProbeVolumeOverride || !core.probe_volume_create) return;
            const now = performance.now() / 1000;
            const live = new Set<Entity>();
            let due: { entity: Entity; at: [number, number, number]; since: number } | null = null;
            for (const [entity, volume, transform] of volumes) {
                if (!volume.capture || !volume.enabled) continue;
                live.add(entity);
                const had = state.grids.get(entity);
                const interval = volume.captureInterval ?? 0;
                if (had && (interval <= 0 || now - had.at < interval)) continue;
                const since = had ? now - had.at : Infinity;
                const p = transform.worldPosition ?? transform.position;
                if (!due || since > due.since) due = { entity, at: [p.x, p.y, p.z], since };
            }
            // A volume that stopped capturing goes back to its bake, and leaves the reflections.
            let dropped = false;
            for (const [entity, grid] of state.grids) {
                if (live.has(entity)) continue;
                core.renderer_setProbeVolumeOverride(entity as unknown as number, 0);
                core.renderer_setProbeVolumeReflection?.(entity as unknown as number, 0, 0);
                core.probe_volume_release?.(grid.handle);
                state.grids.delete(entity);
                dropped = true;
            }
            if (dropped || (state.grids.size && sky() !== state.sky)) rebuildReflections(core, module(), state, sky());
            if (state.pending !== null) {
                const status = core.renderer_pollProbeCapture();
                if (status === 0) return;
                const entity = state.pending;
                state.pending = null;
                if (status !== 1 || !live.has(entity)) return;
                const bytes = PROBE_CAPTURE_FACE * 6 * PROBE_CAPTURE_FACE * 4;
                let panorama: Panorama | null = null;
                const handle = withScratch(core as never, (alloc: (n: number) => number) => {
                    const px = alloc(bytes);
                    if (!core.renderer_takeProbeCapture!(px, bytes)) return 0;
                    panorama = capturePanorama(core.HEAPU8.slice(px, px + bytes), PROBE_CAPTURE_FACE, sky());
                    const shPtr = alloc(27 * 4);
                    core.HEAPF32.set(projectIrradianceSH(panorama), shPtr >> 2);
                    return core.probe_volume_create!(1, 1, 1, shPtr);
                });
                if (!handle || !panorama) return;
                core.renderer_setProbeVolumeOverride(entity as unknown as number, handle);
                const old = state.grids.get(entity);
                if (old) core.probe_volume_release?.(old.handle);
                state.grids.set(entity, { handle, at: now, panorama });
                // What a shiny surface in the box reflects follows what lights it.
                rebuildReflections(core, module(), state, sky());
                return;
            }
            if (due) {
                core.renderer_requestProbeCapture(due.at[0], due.at[1], due.at[2], PROBE_CAPTURE_FACE);
                state.pending = due.entity;
            }
        },
        { name: 'ProbeCaptureSystem', runWhenPaused: true },
    );
}
