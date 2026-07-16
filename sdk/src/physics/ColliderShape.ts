// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ColliderShape.ts
 * @brief   The single geometry projection over the collider components — the shared
 *          seam for BOTH visualizers (the runtime PhysicsDebugDraw and the editor's
 *          collider gizmo) and for tile-collision overlays. It does NOT touch the
 *          runtime physics model: colliders stay ordinary C++/TS components dispatched
 *          by presence in PhysicsSystem; this only READS them into a shape descriptor,
 *          computes the offset+rotation center once (previously duplicated 3×), and
 *          emits world-space outlines each backend renders in its own primitives.
 *
 * Units: shape fields are physics metres (as stored on the components); `ppu`
 * (pixels-per-unit) scales them to world pixels in shapeCenter / colliderShapeOutline.
 */
import type { Vec2 } from '../types';
import type { World } from '../world';
import {
    BoxCollider, CircleCollider, CapsuleCollider,
    SegmentCollider, PolygonCollider, ChainCollider,
} from './PhysicsComponents';
import type {
    BoxColliderData, CircleColliderData, CapsuleColliderData,
    SegmentColliderData, PolygonColliderData, ChainColliderData,
} from './PhysicsComponents';

/** Semicircle-cap segment count for a capsule outline (matches the legacy debug draw). */
export const CAPSULE_ARC_SEGMENTS = 16;

/** A collider's geometry, in physics metres. Offset (box/circle/capsule) is metres too;
 *  segment/polygon/chain carry their points directly and sit at the entity origin. */
export type ColliderShape =
    | { kind: 'box'; halfExtents: Vec2; offset: Vec2 }
    | { kind: 'circle'; radius: number; offset: Vec2 }
    | { kind: 'capsule'; radius: number; halfHeight: number; offset: Vec2 }
    | { kind: 'segment'; point1: Vec2; point2: Vec2 }
    | { kind: 'polygon'; vertices: Vec2[] }
    | { kind: 'chain'; points: Vec2[]; isLoop: boolean };

/** A shape read off an entity, with the sensor flag the visualizers colour by. */
export interface ColliderInstance {
    shape: ColliderShape;
    isSensor: boolean;
}

/** World-space (pixel) outline: straight runs as polylines + true circles left as
 *  {center, radius} so a backend can stroke them as arcs (SVG <circle> / circleOutline). */
export interface ColliderOutline {
    polylines: Vec2[][];
    circles: { c: Vec2; r: number }[];
}

const ZERO: Vec2 = { x: 0, y: 0 };

/** The collider's local offset in metres (0 for segment/polygon/chain, which have none). */
export function shapeOffset(shape: ColliderShape): Vec2 {
    return (shape.kind === 'box' || shape.kind === 'circle' || shape.kind === 'capsule')
        ? shape.offset
        : ZERO;
}

/**
 * The shape's world-pixel centre = the entity's world position plus its collider offset
 * (metres × ppu) rotated by the entity angle. This is the offset+rotation transform that
 * used to be re-implemented in PhysicsDebugDraw and ViewportController.
 */
export function shapeCenter(shape: ColliderShape, worldPos: Vec2, angle: number, ppu: number): Vec2 {
    const off = shapeOffset(shape);
    const ox = off.x * ppu;
    const oy = off.y * ppu;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: worldPos.x + ox * cos - oy * sin, y: worldPos.y + ox * sin + oy * cos };
}

/**
 * The shape's outline in world pixels, rotated by `angle` about `center` (see
 * {@link shapeCenter}). Straight-edged shapes return closed/open polylines; a circle
 * returns a single {c, r} for the backend to stroke as an arc.
 */
export function colliderShapeOutline(shape: ColliderShape, center: Vec2, angle: number, ppu: number): ColliderOutline {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // local (px) → world (px), rotated about center.
    const w = (lx: number, ly: number): Vec2 => ({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos });

    switch (shape.kind) {
        case 'box': {
            const hx = shape.halfExtents.x * ppu;
            const hy = shape.halfExtents.y * ppu;
            const p = [w(-hx, -hy), w(hx, -hy), w(hx, hy), w(-hx, hy)];
            return { polylines: [[...p, p[0]]], circles: [] };
        }
        case 'circle':
            return { polylines: [], circles: [{ c: center, r: shape.radius * ppu }] };
        case 'capsule': {
            const r = shape.radius * ppu;
            const hh = shape.halfHeight * ppu;
            // One closed loop tracing: left side ↑, top cap arc →, right side ↓, bottom cap
            // arc ← — the exact same segment set the legacy drawCapsule emitted.
            const pts: Vec2[] = [w(-r, -hh), w(-r, hh)];
            for (let i = 1; i <= CAPSULE_ARC_SEGMENTS; i++) {
                const a = (i / CAPSULE_ARC_SEGMENTS) * Math.PI;
                pts.push(w(-r * Math.cos(a), hh + r * Math.sin(a)));
            }
            pts.push(w(r, -hh));
            for (let i = 1; i <= CAPSULE_ARC_SEGMENTS; i++) {
                const a = Math.PI + (i / CAPSULE_ARC_SEGMENTS) * Math.PI;
                pts.push(w(-r * Math.cos(a), -hh + r * Math.sin(a)));
            }
            return { polylines: [pts], circles: [] };
        }
        case 'segment':
            return {
                polylines: [[w(shape.point1.x * ppu, shape.point1.y * ppu), w(shape.point2.x * ppu, shape.point2.y * ppu)]],
                circles: [],
            };
        case 'polygon': {
            const p = shape.vertices.map((v) => w(v.x * ppu, v.y * ppu));
            return { polylines: p.length > 0 ? [[...p, p[0]]] : [], circles: [] };
        }
        case 'chain': {
            const p = shape.points.map((v) => w(v.x * ppu, v.y * ppu));
            if (p.length < 2) return { polylines: [], circles: [] };
            return { polylines: [shape.isLoop ? [...p, p[0]] : p], circles: [] };
        }
    }
}

/**
 * Read every collider component present on `entity` into shape descriptors, in the same
 * order PhysicsSystem's addShapeForEntity dispatches (box, circle, capsule, segment,
 * polygon, chain). Chain has no sensor flag, so it reports isSensor: false.
 */
export function readColliderShapes(world: World, entity: number): ColliderInstance[] {
    const out: ColliderInstance[] = [];
    if (world.has(entity, BoxCollider)) {
        const b = world.get(entity, BoxCollider) as BoxColliderData;
        out.push({ shape: { kind: 'box', halfExtents: b.halfExtents, offset: b.offset }, isSensor: b.isSensor });
    }
    if (world.has(entity, CircleCollider)) {
        const c = world.get(entity, CircleCollider) as CircleColliderData;
        out.push({ shape: { kind: 'circle', radius: c.radius, offset: c.offset }, isSensor: c.isSensor });
    }
    if (world.has(entity, CapsuleCollider)) {
        const c = world.get(entity, CapsuleCollider) as CapsuleColliderData;
        out.push({ shape: { kind: 'capsule', radius: c.radius, halfHeight: c.halfHeight, offset: c.offset }, isSensor: c.isSensor });
    }
    if (world.has(entity, SegmentCollider)) {
        const s = world.get(entity, SegmentCollider) as SegmentColliderData;
        out.push({ shape: { kind: 'segment', point1: s.point1, point2: s.point2 }, isSensor: s.isSensor });
    }
    if (world.has(entity, PolygonCollider)) {
        const p = world.get(entity, PolygonCollider) as PolygonColliderData;
        out.push({ shape: { kind: 'polygon', vertices: p.vertices }, isSensor: p.isSensor });
    }
    if (world.has(entity, ChainCollider)) {
        const c = world.get(entity, ChainCollider) as ChainColliderData;
        out.push({ shape: { kind: 'chain', points: c.points, isLoop: c.isLoop }, isSensor: false });
    }
    return out;
}
