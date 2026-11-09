// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    roadDecal.ts
 * @brief   A road, a track or a stain laid along a Spline and over the ground, its edges fading into what it lies on.
 *
 * @details A decal is cut from meshes, and a terrain is no mesh: it is drawn from height pages, coarser with distance. So this asks
 *          the ground where it is, row by row across the curve, and draws the strip as the entity's own MeshRenderer, so a material
 *          on it can be anything. Its colour's alpha falls to nothing at both edges, so the seam with the ground is a gradient and
 *          not a line. It is made again when the spline, its fields or the ground change. The terrain module is optional and asked by
 *          name: with none, the strip lies along the curve as drawn.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, MeshRenderer, Transform, type ComponentDef, type MeshRendererData, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { Assets } from '../asset/AssetPlugin';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import { SplineCurve } from './curve';
import { Spline, type SplineData } from './splineComponent';

/** The fields of the `RoadDecal` component. @experimental */
export interface RoadDecalData {
    /** How far apart its rows are along the curve, in world units: finer follows the ground and the bends more closely. */
    step: number;
    /** How many cells across. More follows a ground that crowns or slopes under the road. */
    across: number;
    /** × the width each spline point says. */
    widthScale: number;
    /** How far above the ground it lies, in world units. Enough to win against the ground from as far as it is seen. */
    lift: number;
    /** The share of its half width over which each edge fades, 0 to 1. */
    edgeFade: number;
    /** The length of one repeat of its texture along the curve, in world units. */
    tile: number;
}

/**
 * Lays the entity's MeshRenderer along the `Spline` of the same entity and over the ground.
 *
 * @experimental
 */
export const RoadDecal: ComponentDef<RoadDecalData> = defineComponent<RoadDecalData>('RoadDecal', {
    step: 20, across: 4, widthScale: 1, lift: 0.5, edgeFade: 0.35, tile: 200,
}, {
    fields: {
        step: { min: 0.01, unit: 'wu', tooltip: 'How far apart its rows are along the curve. Finer follows the ground and the bends more closely.' },
        across: { min: 1, max: 32, step: 1, tooltip: 'How many cells across. More follows a ground that crowns or slopes under the road.' },
        widthScale: { min: 0, step: 0.01, tooltip: 'Times the width each spline point says.' },
        lift: { min: 0, step: 0.01, unit: 'wu', tooltip: 'How far above the ground it lies. Enough to win against the ground from as far as it is seen.' },
        edgeFade: { min: 0, max: 1, step: 0.01, tooltip: 'The share of its half width over which each edge fades into the ground.' },
        tile: { min: 0.01, unit: 'wu', tooltip: 'The length of one repeat of its texture along the curve.' },
    },
});

/** What the ground answers, from a terrain or a planet's surface. Read by name: a game with neither pays for neither. */
export interface RoadGround {
    heightAt(x: number, z: number): number | null;
    normalAt?(x: number, z: number): readonly [number, number, number] | null;
}

/**
 * The strip's geometry, relative to `origin`. Null where it has nothing to lay. Positions lie on the ground where it answers and on the curve
 * where it does not; texture v runs along the curve in world units over `tile`, and u across from 0 to 1.
 */
export function buildRoadDecal(spline: SplineData, road: RoadDecalData, origin: { x: number; y: number; z: number }, ground: RoadGround | null): MeshData | null {
    if (spline.points.length < 2) return null;
    const curve = new SplineCurve(spline.points, spline.closed);
    if (!(curve.length > 1e-3)) return null;
    const rows = Math.max(1, Math.min(4096, Math.ceil(curve.length / Math.max(road.step, 1e-3))));
    const cells = Math.max(1, Math.min(32, Math.floor(road.across)));
    const fade = Math.min(1, Math.max(0, road.edgeFade));
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const vertexCount = (rows + 1) * (cells + 1);
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    const at = (semantic: number): number => channels.find((c) => c.semantic === semantic)!.offset;
    const posAt = at(MeshChannel.Position), uvAt = at(MeshChannel.TexCoord0), colorAt = at(MeshChannel.Color), normalAt = at(MeshChannel.Normal);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let vertex = 0;
    for (let r = 0; r <= rows; r++) {
        const s = curve.length * (r / rows);
        const [cx, cy, cz] = curve.position(s);
        const [tx, , tz] = curve.tangent(s);
        const len = Math.hypot(tx, tz) || 1;
        // Across the road on the ground: a curve climbing a hill still has a level side.
        const sx = -tz / len, sz = tx / len;
        const half = curve.width(s) * 0.5 * road.widthScale;
        for (let c = 0; c <= cells; c++, vertex++) {
            const u = c / cells;
            const offset = (u * 2 - 1) * half;
            const wx = origin.x + cx + sx * offset, wz = origin.z + cz + sz * offset;
            const y = ground?.heightAt(wx, wz) ?? origin.y + cy;
            const n = ground?.normalAt?.(wx, wz) ?? [0, 1, 0];
            const p = [wx - origin.x, y + road.lift - origin.y, wz - origin.z] as const;
            const base = vertex * vertexStride;
            for (let k = 0; k < 3; k++) {
                view.setFloat32(base + posAt + k * 4, p[k]!, true);
                view.setFloat32(base + normalAt + k * 4, n[k]!, true);
                if (p[k]! < min[k]!) min[k] = p[k]!;
                if (p[k]! > max[k]!) max[k] = p[k]!;
            }
            view.setFloat32(base + uvAt, u, true);
            view.setFloat32(base + uvAt + 4, s / Math.max(road.tile, 1e-3), true);
            const edge = 1 - Math.abs(u * 2 - 1);
            const alpha = fade > 0 ? Math.min(1, edge / fade) : 1;
            view.setUint8(base + colorAt, 255);
            view.setUint8(base + colorAt + 1, 255);
            view.setUint8(base + colorAt + 2, 255);
            // Eased, so the edge has no line of its own where the fade begins.
            view.setUint8(base + colorAt + 3, Math.round(alpha * alpha * (3 - 2 * alpha) * 255));
        }
    }
    const indices = new Uint32Array(rows * cells * 6);
    let i = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cells; c++) {
            const a = r * (cells + 1) + c, b = a + 1, d = a + cells + 1, e = d + 1;
            indices[i++] = a; indices[i++] = b; indices[i++] = d;
            indices[i++] = b; indices[i++] = e; indices[i++] = d;
        }
    }
    return { channels, vertexStride, vertexCount, vertices, indices, aabbMin: min, aabbMax: max };
}

/** The ground, whichever module answers it, and how to tell when it has changed. */
function groundOf(app: App): { query: RoadGround; revision: number; waiting: boolean } | null {
    const terrains = app.getResourceByName?.('Terrains') as (RoadGround & { revision_?: number; loading?: boolean; built_?: Map<unknown, unknown> }) | undefined;
    if (!terrains || typeof terrains.heightAt !== 'function' || !terrains.built_?.size) return null;
    return { query: terrains, revision: terrains.revision_ ?? 0, waiting: !!terrains.loading };
}

/** Keeps every `RoadDecal` lying on the ground. Called once by the spline plugin. */
export function installRoadDecals(app: App): void {
    const built = new Map<Entity, { key: string; handle: number }>();
    const letGo = (entity: Entity): void => {
        const held = built.get(entity);
        built.delete(entity);
        if (held?.handle && app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(held.handle);
    };
    app.world.onDespawn(letGo);
    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
        const world = app.world;
        if (!app.hasResource(Assets)) return;
        const assets = app.getResource(Assets);
        for (const entity of [...built.keys()]) if (!world.valid(entity) || !world.has(entity, RoadDecal)) letGo(entity);
        for (const entity of world.getEntitiesWithComponents([RoadDecal, Spline, Transform])) {
            const ground = groundOf(app);
            // Laid on a ground still being read, it would lie on nothing and be laid again a moment later.
            if (ground?.waiting) continue;
            const road = world.get(entity, RoadDecal) as RoadDecalData;
            const spline = world.get(entity, Spline) as SplineData;
            const t = world.get(entity, Transform) as TransformData;
            const origin = t.worldPosition;
            const key = JSON.stringify([spline.points, spline.closed, road, ground?.revision ?? -1, origin.x, origin.y, origin.z]);
            const held = built.get(entity);
            if (held?.key === key) continue;
            const mesh = buildRoadDecal(spline, road, origin, ground?.query ?? null);
            const handle = mesh ? assets.createMesh(mesh) : 0;
            if (held?.handle) assets.releaseBuiltMesh(held.handle);
            built.set(entity, { key, handle });
            const renderer = world.has(entity, MeshRenderer) ? world.get(entity, MeshRenderer) as MeshRendererData : null;
            world.insert(entity, MeshRenderer, { ...renderer, enabled: true, mesh: handle, opaque: false, castShadows: false, cullBackfaces: false } as Partial<MeshRendererData>);
        }
    }, { name: 'RoadDecalSystem' }));
}
