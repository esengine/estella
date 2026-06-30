// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CharacterController.ts
 * @brief   Kinematic move-and-slide character controller (Godot CharacterBody2D
 *          semantics) built on the existing Box2D shape-cast queries.
 *
 * The controller is gameplay logic, so it lives entirely in the SDK and never
 * touches C++: it reads the entity's own collider for the cast shape, sweeps it
 * through the world with `Physics.shapeCast*`, and resolves collisions by sliding
 * along surfaces. It writes the resolved pose to `Transform`; if the entity also
 * carries a Kinematic `RigidBody`, `PhysicsStepSystem` then pushes that Transform
 * into Box2D so dynamic bodies see the character. Movement itself is query-driven,
 * so a body is recommended (for others to collide with) but not required.
 *
 * Units: `velocity`/positions are world pixels (matching `Transform`); collider
 * dimensions are meters and are scaled to pixels via `Physics.getPixelsPerUnit()`.
 */
import type { App } from '../app';
import type { Entity, Vec2 } from '../types';
import { defineComponent, Transform, type TransformData } from '../component';
import { Schedule, defineSystem, GetWorld } from '../system';
import { Query, Mut } from '../query';
import { Res, Time, type TimeData } from '../resource';
import { playModeOnly } from '../env';
import { PhysicsAPI, type Physics } from './Physics';
import { BoxCollider, CircleCollider, CapsuleCollider } from './PhysicsComponents';
import type {
    BoxColliderData, CircleColliderData, CapsuleColliderData,
} from './PhysicsComponents';
import type { World } from '../world';

// =============================================================================
// Component
// =============================================================================

export interface CharacterControllerData {
    /** Desired velocity in world pixels/second; set it from gameplay each step. */
    velocity: Vec2;
    /** Up direction for floor/ceiling classification (opposes gravity). */
    up: Vec2;
    /** Max walkable slope, measured from `up` (radians). Steeper = wall. */
    floorMaxAngle: number;
    /** Slide iterations per move (corners need more than one). */
    maxSlides: number;
    /** Gap kept from surfaces (pixels) so the body doesn't stick/jitter. */
    skinWidth: number;
    /** Down-probe length (pixels) to stay glued to floors on slopes/stairs; 0 = off. */
    snapLength: number;
    /** When false, a ceiling hit stops the remaining move instead of sliding along it. */
    slideOnCeiling: boolean;
    /** Collision layers that block the character. */
    maskBits: number;

    /** Output: touched a surface classified as floor this move. */
    isOnFloor: boolean;
    /** Output: touched a surface classified as wall this move. */
    isOnWall: boolean;
    /** Output: touched a surface classified as ceiling this move. */
    isOnCeiling: boolean;
    /** Output: normal of the last floor touched (zero when airborne). */
    floorNormal: Vec2;
    /** Output: actual displacement / dt after collisions (pixels/second). */
    realVelocity: Vec2;
}

export const CharacterController = defineComponent<CharacterControllerData>('CharacterController', {
    velocity: { x: 0, y: 0 },
    up: { x: 0, y: 1 },
    floorMaxAngle: 0.785398, // 45°
    maxSlides: 4,
    skinWidth: 1,
    snapLength: 0,
    slideOnCeiling: true,
    maskBits: 0xFFFF,
    isOnFloor: false,
    isOnWall: false,
    isOnCeiling: false,
    floorNormal: { x: 0, y: 0 },
    realVelocity: { x: 0, y: 0 },
}, {
    fields: {
        floorMaxAngle: { min: 0, max: 1.5708, step: 0.01, unit: 'rad', tooltip: 'Max walkable slope from up (radians)' },
        maxSlides: { min: 1, max: 8, step: 1, advanced: true },
        skinWidth: { min: 0, step: 0.25, unit: 'px', advanced: true },
        snapLength: { min: 0, step: 0.5, unit: 'px', tooltip: 'Floor-snap probe length; 0 disables stair/slope stick' },
        slideOnCeiling: { advanced: true },
        up: { advanced: true },
        maskBits: { bitmask: { bits: 16, source: 'collisionLayers' }, advanced: true },
        isOnFloor: { advanced: true },
        isOnWall: { advanced: true },
        isOnCeiling: { advanced: true },
        floorNormal: { advanced: true },
        realVelocity: { advanced: true },
    },
});

// =============================================================================
// move-and-slide core (pure — injectable cast, no wasm/world dependency)
// =============================================================================

/** Nearest blocking hit along a sweep: surface `n*` and the `[0,1]` sweep fraction. */
export interface SlideHit {
    nx: number;
    ny: number;
    fraction: number;
}

/**
 * Sweep the character shape from `(ox,oy)` by `(dx,dy)` (pixels) and return the
 * nearest hit that blocks it, or `null` for a clear path. Self-collision and the
 * mask filter are the caller's responsibility.
 */
export type SlideCast = (ox: number, oy: number, dx: number, dy: number) => SlideHit | null;

export interface MoveAndSlideParams {
    startX: number;
    startY: number;
    motionX: number;
    motionY: number;
    velX: number;
    velY: number;
    upX: number;
    upY: number;
    floorMaxAngle: number;
    maxSlides: number;
    skinWidth: number;
    snapLength: number;
    slideOnCeiling: boolean;
    wasOnFloor: boolean;
}

export interface MoveAndSlideResult {
    x: number;
    y: number;
    velX: number;
    velY: number;
    isOnFloor: boolean;
    isOnWall: boolean;
    isOnCeiling: boolean;
    floorNormalX: number;
    floorNormalY: number;
}

const EPS = 1e-6;

/**
 * Resolve one move: advance toward the first contact, classify the surface, then
 * project the leftover motion (and velocity) onto it and repeat. Velocity is slid
 * by the same projections so a grounded body's downward gravity doesn't accumulate
 * — the contract matches Godot's `move_and_slide`.
 */
export function moveAndSlide(p: MoveAndSlideParams, cast: SlideCast): MoveAndSlideResult {
    let x = p.startX, y = p.startY;
    let mx = p.motionX, my = p.motionY;
    let vx = p.velX, vy = p.velY;
    let onFloor = false, onWall = false, onCeiling = false;
    let fnX = 0, fnY = 0;

    const ulen = Math.hypot(p.upX, p.upY) || 1;
    const ux = p.upX / ulen, uy = p.upY / ulen;
    const cosFloor = Math.cos(p.floorMaxAngle);

    for (let i = 0; i < p.maxSlides; i++) {
        const len = Math.hypot(mx, my);
        if (len < EPS) break;

        const hit = cast(x, y, mx, my);
        if (!hit) { x += mx; y += my; break; }

        const frac = hit.fraction < 0 ? 0 : hit.fraction > 1 ? 1 : hit.fraction;
        const travel = Math.max(0, frac * len - p.skinWidth);
        x += (mx / len) * travel;
        y += (my / len) * travel;

        const nl = Math.hypot(hit.nx, hit.ny) || 1;
        const nx = hit.nx / nl, ny = hit.ny / nl;
        const nDotUp = nx * ux + ny * uy;
        if (nDotUp >= cosFloor) { onFloor = true; fnX = nx; fnY = ny; }
        else if (nDotUp <= -cosFloor) onCeiling = true;
        else onWall = true;

        const leftoverX = mx * (1 - frac);
        const leftoverY = my * (1 - frac);
        const dotM = leftoverX * nx + leftoverY * ny;
        mx = leftoverX - nx * dotM;
        my = leftoverY - ny * dotM;

        const dotV = vx * nx + vy * ny;
        vx -= nx * dotV;
        vy -= ny * dotV;

        if (onCeiling && !p.slideOnCeiling) break;
    }

    // Floor snap: keep a grounded body glued to descending ground (stairs/slopes)
    // so it doesn't launch off ledges. Skip while moving up (a jump must leave).
    if (p.snapLength > 0 && p.wasOnFloor && !onFloor) {
        const velUp = vx * ux + vy * uy;
        if (velUp <= EPS) {
            const sx = -ux * p.snapLength, sy = -uy * p.snapLength;
            const hit = cast(x, y, sx, sy);
            if (hit) {
                const nl = Math.hypot(hit.nx, hit.ny) || 1;
                const nx = hit.nx / nl, ny = hit.ny / nl;
                if (nx * ux + ny * uy >= cosFloor) {
                    const slen = Math.hypot(sx, sy);
                    const frac = hit.fraction < 0 ? 0 : hit.fraction > 1 ? 1 : hit.fraction;
                    const travel = Math.max(0, frac * slen - p.skinWidth);
                    x += (sx / slen) * travel;
                    y += (sy / slen) * travel;
                    onFloor = true; fnX = nx; fnY = ny;
                }
            }
        }
    }

    return {
        x, y, velX: vx, velY: vy,
        isOnFloor: onFloor, isOnWall: onWall, isOnCeiling: onCeiling,
        floorNormalX: fnX, floorNormalY: fnY,
    };
}

// =============================================================================
// System
// =============================================================================

/** The character's cast shape, in pixels, resolved from its collider. */
type CastShape =
    | { kind: 'box'; hx: number; hy: number; ox: number; oy: number }
    | { kind: 'circle'; r: number; ox: number; oy: number }
    | { kind: 'capsule'; r: number; halfH: number; ox: number; oy: number };

/** Read the entity's collider into a pixel-space cast shape, or null if it has none. */
function resolveCastShape(world: World, entity: Entity, ppu: number): CastShape | null {
    if (world.has(entity, BoxCollider)) {
        const c = world.get(entity, BoxCollider) as BoxColliderData;
        return { kind: 'box', hx: c.halfExtents.x * ppu, hy: c.halfExtents.y * ppu, ox: c.offset.x * ppu, oy: c.offset.y * ppu };
    }
    if (world.has(entity, CircleCollider)) {
        const c = world.get(entity, CircleCollider) as CircleColliderData;
        return { kind: 'circle', r: c.radius * ppu, ox: c.offset.x * ppu, oy: c.offset.y * ppu };
    }
    if (world.has(entity, CapsuleCollider)) {
        const c = world.get(entity, CapsuleCollider) as CapsuleColliderData;
        return { kind: 'capsule', r: c.radius * ppu, halfH: c.halfHeight * ppu, ox: c.offset.x * ppu, oy: c.offset.y * ppu };
    }
    return null;
}

/**
 * Build the nearest-blocking-hit cast for one character: sweep its shape, drop the
 * character's own body, and keep the lowest-fraction hit.
 */
function makeCast(physics: Physics, self: Entity, shape: CastShape, maskBits: number): SlideCast {
    const t: Vec2 = { x: 0, y: 0 };
    const c: Vec2 = { x: 0, y: 0 };
    return (ox, oy, dx, dy) => {
        c.x = ox + shape.ox; c.y = oy + shape.oy;
        t.x = dx; t.y = dy;
        let hits;
        if (shape.kind === 'box') hits = physics.shapeCastBox(c, { x: shape.hx, y: shape.hy }, 0, t, maskBits);
        else if (shape.kind === 'circle') hits = physics.shapeCastCircle(c, shape.r, t, maskBits);
        else hits = physics.shapeCastCapsule({ x: c.x, y: c.y + shape.halfH }, { x: c.x, y: c.y - shape.halfH }, shape.r, t, maskBits);

        let best: SlideHit | null = null;
        for (const h of hits) {
            if (h.entity === self) continue;
            if (best === null || h.fraction < best.fraction) best = { nx: h.normal.x, ny: h.normal.y, fraction: h.fraction };
        }
        return best;
    };
}

/**
 * Register the move-and-slide system. Runs in FixedUpdate ahead of the physics
 * step so the resolved Transform is what gets pushed into a kinematic body.
 */
export function registerCharacterControllerSystem(app: App): void {
    app.addSystemToSchedule(
        Schedule.FixedUpdate,
        defineSystem(
            [Query(Mut(CharacterController)), Res(Time), Res(PhysicsAPI), GetWorld()],
            (
                query: Iterable<[Entity, CharacterControllerData]>,
                time: TimeData,
                physics: Physics,
                world: World,
            ) => {
                const dt = time.fixedDelta;
                if (dt <= 0) return;
                const ppu = physics.getPixelsPerUnit();
                const invDt = 1 / dt;

                for (const [entity, cc] of query) {
                    const shape = resolveCastShape(world, entity, ppu);
                    if (!shape) continue;

                    // Transform is C++-backed: get() yields a converted copy, so the
                    // resolved pose must be written back with set() (mutating the copy
                    // alone would not persist).
                    const transform = world.get(entity, Transform) as TransformData;
                    const startX = transform.position.x;
                    const startY = transform.position.y;
                    const cast = makeCast(physics, entity, shape, cc.maskBits);

                    const r = moveAndSlide({
                        startX, startY,
                        motionX: cc.velocity.x * dt,
                        motionY: cc.velocity.y * dt,
                        velX: cc.velocity.x,
                        velY: cc.velocity.y,
                        upX: cc.up.x, upY: cc.up.y,
                        floorMaxAngle: cc.floorMaxAngle,
                        maxSlides: cc.maxSlides,
                        skinWidth: cc.skinWidth,
                        snapLength: cc.snapLength,
                        slideOnCeiling: cc.slideOnCeiling,
                        wasOnFloor: cc.isOnFloor,
                    }, cast);

                    // Write both local and world position: PhysicsStepSystem runs next
                    // in this same FixedUpdate and pushes worldPosition into a kinematic
                    // body, before TransformSystem re-derives world from local.
                    transform.position.x = r.x;
                    transform.position.y = r.y;
                    transform.worldPosition.x = r.x;
                    transform.worldPosition.y = r.y;
                    world.set(entity, Transform, transform);

                    cc.velocity.x = r.velX;
                    cc.velocity.y = r.velY;
                    cc.isOnFloor = r.isOnFloor;
                    cc.isOnWall = r.isOnWall;
                    cc.isOnCeiling = r.isOnCeiling;
                    cc.floorNormal.x = r.floorNormalX;
                    cc.floorNormal.y = r.floorNormalY;
                    cc.realVelocity.x = (r.x - startX) * invDt;
                    cc.realVelocity.y = (r.y - startY) * invDt;
                }
            },
            { name: 'CharacterControllerSystem', runBefore: ['PhysicsStepSystem'] },
        ),
        { runIf: playModeOnly },
    );
}
