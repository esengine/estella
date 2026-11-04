// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    terrainBand2D.ts
 * @brief   A 2D ground drawn along a Spline: a filled body, a lip along its surface, and the chain collider that stands on it.
 *
 * @details An open spline is a ground profile: the fill reaches from the curve down to `depth` below its lowest point, and the lip runs along
 *          the curve. A closed one is a shape (an island, a platform): the fill is what it encloses and the lip runs round the inside of
 *          its rim. Either way the curve is read in the entity's own x, y, the way a sprite is, so moving the entity moves the ground.
 *
 *          The mesh is the entity's own MeshRenderer geometry (so it sorts, batches and saves like any other, and the renderer's texture
 *          and tint apply), rebuilt only when the spline or the band's fields change. The fill's texture coordinates are in world units
 *          over `tile`, so a texture repeats at one size however the curve is drawn.
 */
import type { App } from '../app/app';
import type { Entity, Vec2 } from '../types';
import { defineSystem, Schedule } from '../ecs/system';
import { defineComponent, MeshRenderer, Canvas, type ComponentDef, type MeshRendererGeometry } from '../ecs/component';
import { MeshRenderers } from '../render/meshRenderer';
import { triangulateRing } from '../render/vectorPath';
import { ChainCollider2D, type ChainCollider2DData } from '../physics/PhysicsComponents';
import { SplineCurve, type SplinePoint } from './curve';
import { Spline, type SplineData } from './splinePlugin';

/** The fields of the `TerrainBand2D` component. @experimental */
export interface TerrainBand2DData {
    /** How far apart, along the curve, the points of the outline are: smaller is smoother and costs more triangles. */
    resolution: number;
    /** An open spline's fill reaches this far below its lowest point. A closed one ignores it. */
    depth: number;
    /** The length of one repeat of the fill's texture, in world units. */
    tile: number;
    /** How wide the lip along the surface is, drawn over the fill; 0 draws none. */
    edgeWidth: number;
    /** The lip's colour, multiplying the texture under it. */
    edgeColor: { r: number; g: number; b: number; a: number };
    /** Whether the band gives its entity a chain collider along the surface, for a static body to carry. */
    collider: boolean;
}

/**
 * Ground along the `Spline` of the same entity, drawn by the entity's MeshRenderer.
 *
 * @experimental
 */
export const TerrainBand2D: ComponentDef<TerrainBand2DData> = defineComponent<TerrainBand2DData>('TerrainBand2D', {
    resolution: 16, depth: 200, tile: 128, edgeWidth: 12, edgeColor: { r: 0.35, g: 0.65, b: 0.2, a: 1 }, collider: false,
}, {
    fields: {
        resolution: { min: 1, category: 'Shape', tooltip: 'How far apart, along the curve, the outline\'s points are. Smaller is smoother and costs more triangles.' },
        depth: { min: 0, category: 'Shape', tooltip: 'How far below its lowest point an open spline\'s fill reaches. A closed spline ignores it.' },
        tile: { min: 1, category: 'Look', tooltip: 'The length of one repeat of the fill\'s texture, in world units.' },
        edgeWidth: { min: 0, category: 'Look', tooltip: 'How wide the lip along the surface is, drawn over the fill. 0 draws none.' },
        edgeColor: { category: 'Look', tooltip: 'The lip\'s colour, multiplying the texture under it.' },
        collider: { category: 'Collision', tooltip: 'Give this entity a chain collider along the surface. Add a static Rigidbody2D to make it solid.' },
    },
});

/** What a band is built into: the mesh, and the outline its collider follows. */
export interface TerrainBandBuild {
    geometry: MeshRendererGeometry;
    /** The surface, in the entity's own space: the curve for an open spline, the ring for a closed one. */
    outline: Vec2[];
    closed: boolean;
}

const lerpColor = (c: TerrainBand2DData['edgeColor']): number[] => [c.r, c.g, c.b, c.a];

/** The points of the curve, a `step` apart. An open curve ends on its last point; a closed one is a ring with no repeat. */
function sampleCurve(curve: SplineCurve, step: number): Vec2[] {
    const n = Math.max(curve.closed ? 3 : 2, Math.ceil(curve.length / Math.max(step, 1e-3)) + (curve.closed ? 0 : 1));
    const out: Vec2[] = [];
    const last = curve.closed ? n : n - 1;
    for (let i = 0; i < n; i++) {
        const p = curve.position((i / last) * curve.length);
        out.push({ x: p[0], y: p[1] });
    }
    return out;
}

const area = (ring: readonly Vec2[]): number => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) { const p = ring[i]!, q = ring[(i + 1) % ring.length]!; a += p.x * q.y - q.x * p.y; }
    return a / 2;
};

/**
 * The geometry of a band over `points`. Pure: the same inputs give the same mesh.
 *
 * @experimental
 */
export function buildTerrainBand(points: readonly SplinePoint[], closedCurve: boolean, band: TerrainBand2DData): TerrainBandBuild | null {
    if (points.length < 2) return null;
    const curve = new SplineCurve(points, closedCurve);
    let outline = sampleCurve(curve, band.resolution);
    const closed = curve.closed;
    // A closed ring goes counter-clockwise (its surface faces out to the right of travel); an open profile goes left to right.
    if (closed ? area(outline) < 0 : outline[outline.length - 1]!.x < outline[0]!.x) outline = outline.slice().reverse();

    const fill: Vec2[] = closed ? outline : (() => {
        const bottom = Math.min(...outline.map((p) => p.y)) - Math.max(band.depth, 0);
        return [...outline, { x: outline[outline.length - 1]!.x, y: bottom }, { x: outline[0]!.x, y: bottom }];
    })();

    const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    const tile = Math.max(band.tile, 1e-3);
    const push = (x: number, y: number, c: number[]): number => {
        positions.push(x, y); uvs.push(x / tile, y / tile); colors.push(c[0]!, c[1]!, c[2]!, c[3]!);
        return positions.length / 2 - 1;
    };
    const white = [1, 1, 1, 1];
    for (const p of fill) push(p.x, p.y, white);
    for (const i of triangulateRing(fill)) indices.push(i);

    // The lip: a strip from each surface point a lip's width into the fill, along the outline's surface side.
    if (band.edgeWidth > 0) {
        const n = outline.length;
        const edge = lerpColor(band.edgeColor);
        const inward: Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const a = outline[closed ? (i + n - 1) % n : Math.max(i - 1, 0)]!;
            const c = outline[closed ? (i + 1) % n : Math.min(i + 1, n - 1)]!;
            const dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy) || 1;
            // Into the fill is to the left of travel round a counter-clockwise ring; for an open profile (left to right) it is down, to the right.
            inward.push(closed ? { x: -dy / len, y: dx / len } : { x: dy / len, y: -dx / len });
        }
        const top: number[] = [], under: number[] = [];
        for (let i = 0; i < n; i++) {
            const p = outline[i]!, d = inward[i]!;
            top.push(push(p.x, p.y, edge));
            under.push(push(p.x + d.x * band.edgeWidth, p.y + d.y * band.edgeWidth, edge));
        }
        const pieces = closed ? n : n - 1;
        for (let i = 0; i < pieces; i++) {
            const j = (i + 1) % n;
            // Counter-clockwise, so it faces the same way as the fill.
            if (closed) indices.push(top[i]!, under[i]!, under[j]!, top[i]!, under[j]!, top[j]!);
            else indices.push(top[i]!, under[j]!, top[j]!, top[i]!, under[i]!, under[j]!);
        }
    }
    return { geometry: { positions, uvs, colors, indices }, outline, closed };
}

/** The pixels-per-unit physics measures a Transform's units in. */
function pixelsPerUnit(app: App): number {
    for (const entity of app.world.getEntitiesWithComponents([Canvas])) {
        const ppu = (app.world.get(entity, Canvas) as { pixelsPerUnit?: number }).pixelsPerUnit;
        if (ppu) return ppu;
    }
    return 100;
}

/** Keeps every `TerrainBand2D`'s mesh and collider matching its spline. Called once by the spline plugin. */
export function installTerrainBands(app: App): void {
    /** What each entity's mesh was last built from, and whether that left it any (an empty one is not worth looking for). */
    const built = new Map<Entity, { key: string; empty: boolean }>();
    const wroteCollider = new Set<Entity>();
    app.world.onDespawn((entity: Entity) => { built.delete(entity); wroteCollider.delete(entity); });

    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
        const world = app.world;
        if (!app.hasResource(MeshRenderers)) return;
        const api = app.getResource(MeshRenderers);
        for (const entity of world.getEntitiesWithComponents([TerrainBand2D, Spline])) {
            const band = world.get(entity, TerrainBand2D) as TerrainBand2DData;
            const spline = world.get(entity, Spline) as SplineData;
            const ppu = band.collider ? pixelsPerUnit(app) : 0;
            const key = JSON.stringify([spline.points, spline.closed, band, ppu]);
            const held = built.get(entity);
            // The editor re-imports a MeshRenderer from its scene model, which carries no geometry, and that clears what was uploaded: a mesh
            // that has gone missing is built again, not trusted to still be there.
            if (held && held.key === key && (held.empty || api.getGeometry(entity))) continue;
            const result = buildTerrainBand(spline.points, spline.closed, band);
            built.set(entity, { key, empty: !result });
            if (!world.has(entity, MeshRenderer)) world.insert(entity, MeshRenderer, { enabled: true });
            if (result) api.setGeometry(entity, result.geometry); else api.clearGeometry(entity);
            if (band.collider && result && result.outline.length >= 4) {
                // Physics measures in units, the Transform in pixels.
                const points = result.outline.map((p) => ({ x: p.x / ppu, y: p.y / ppu }));
                const held = world.has(entity, ChainCollider2D) ? world.get(entity, ChainCollider2D) as ChainCollider2DData : {};
                world.insert(entity, ChainCollider2D, { ...held, points, isLoop: result.closed });
                wroteCollider.add(entity);
            } else if (wroteCollider.has(entity)) {
                world.remove(entity, ChainCollider2D);
                wroteCollider.delete(entity);
            }
        }
    }, { name: 'TerrainBand2DSystem' }));
}
