// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CharacterController2D.ts
 * @brief   Kinematic character controller (Godot CharacterBody2D semantics) on top
 *          of Box2D v3's native kinematic mover.
 *
 * The controller reads the entity's own collider, derives a capsule mover from it,
 * and advances one step via `Physics2DAPI.moveCharacter` — Box2D's `b2World_CollideMover`
 * + `b2SolvePlanes`, which collides the capsule into contact *planes* and solves a
 * depenetrating slide. That resolves a character resting on the ground with valid
 * normals (a generic shape cast reports the resting contact as a zero-normal
 * fraction-0 hit and wedges). It writes the resolved pose to `Transform`; if the
 * entity also carries a Kinematic `RigidBody2D`, `PhysicsStepSystem` then pushes that
 * Transform into Box2D so dynamic bodies see the character.
 *
 * `moveAndSlide` below is the earlier pure JS resolver, kept as a standalone utility
 * (and for its tests); the live system uses the native mover.
 *
 * Units: `velocity`/positions are world pixels (matching `Transform`); collider
 * dimensions are meters and are scaled to pixels via `Physics2DAPI.getPixelsPerUnit()`.
 */
import type { Vec2 } from '../types';
import { defineComponent } from '../ecs/component';

// =============================================================================
// Component
// =============================================================================

/** The fields of the `CharacterController2D` component, whose tier this shape carries.
 *  @beta */
export interface CharacterController2DData {
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

/**
 * A kinematic mover for a player or an NPC: it sweeps rather than being pushed,
 * so it never tunnels and never inherits a rigid body's momentum.
 *
 * @beta
 */
export const CharacterController2D = defineComponent<CharacterController2DData>('CharacterController2D', {
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
