// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  CharacterController2DSystem.ts — the controller's wiring into a running
 *        2D world, split off at the line the file already drew.
 *
 * The component and `moveAndSlide` are data and arithmetic that any reader of a
 * scene needs; this reaches the solver. Together they put `Physics2D`,
 * `PhysicsSystem` and `Physics2DDebugDraw` in the declaration closure, and from
 * there into every package — see tools/check-core-carries-options.mjs.
 */
import type { App } from '../app/app';
import type { Entity, Vec2 } from '../types';
import { Transform, type TransformData } from '../ecs/component';
import { Schedule, defineSystem, GetWorld } from '../ecs/system';
import { Query, Mut } from '../ecs/query';
import { Res, Time, type TimeData } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { Physics2D, type Physics2DAPI } from './Physics2D';
import { readPixelsPerUnit } from './PhysicsSystem';
import {
    BoxCollider2D, CircleCollider2D, CapsuleCollider2D, activeCollider,
    type BoxCollider2DData, type CircleCollider2DData, type CapsuleCollider2DData,
} from './PhysicsComponents';
import { log } from '../util/logger';
import type { MoverResult } from './PhysicsTypes';
import type { World } from '../ecs/world';
import {
    CharacterController2D, moveAndSlide,
    type CharacterController2DData, type SlideHit,
} from './CharacterController2D';

// =============================================================================
// System
// =============================================================================

/** The character's cast shape, in pixels, resolved from its collider. */
type CastShape =
    | { kind: 'box'; hx: number; hy: number; ox: number; oy: number }
    | { kind: 'circle'; r: number; ox: number; oy: number }
    | { kind: 'capsule'; r: number; halfH: number; ox: number; oy: number };

/** Read the entity's collider into a pixel-space cast shape, or null if it has no
 *  enabled one — a disabled collider is no collider, here as everywhere. */
function resolveCastShape(world: World, entity: Entity, ppu: number): CastShape | null {
    const box = activeCollider(world, entity, BoxCollider2D) as BoxCollider2DData | null;
    if (box) {
        return { kind: 'box', hx: box.halfExtents.x * ppu, hy: box.halfExtents.y * ppu, ox: box.offset.x * ppu, oy: box.offset.y * ppu };
    }
    const circle = activeCollider(world, entity, CircleCollider2D) as CircleCollider2DData | null;
    if (circle) {
        return { kind: 'circle', r: circle.radius * ppu, ox: circle.offset.x * ppu, oy: circle.offset.y * ppu };
    }
    const capsule = activeCollider(world, entity, CapsuleCollider2D) as CapsuleCollider2DData | null;
    if (capsule) {
        return { kind: 'capsule', r: capsule.radius * ppu, halfH: capsule.halfHeight * ppu, ox: capsule.offset.x * ppu, oy: capsule.offset.y * ppu };
    }
    return null;
}

/** The capsule the native mover sweeps, derived from the collider (pixels). A box
 *  becomes a capsule inscribed along its longer axis; a circle a zero-length capsule. */
interface MoverCapsule { c1: Vec2; c2: Vec2; radius: number }

function moverCapsuleFromShape(s: CastShape): MoverCapsule {
    if (s.kind === 'circle') {
        return { c1: { x: s.ox, y: s.oy }, c2: { x: s.ox, y: s.oy }, radius: s.r };
    }
    if (s.kind === 'capsule') {
        return { c1: { x: s.ox, y: s.oy + s.halfH }, c2: { x: s.ox, y: s.oy - s.halfH }, radius: s.r };
    }
    // Box: place the capsule spine along the longer axis, radius = shorter half-extent.
    if (s.hy >= s.hx) {
        const half = s.hy - s.hx;
        return { c1: { x: s.ox, y: s.oy + half }, c2: { x: s.ox, y: s.oy - half }, radius: s.hx };
    }
    const half = s.hx - s.hy;
    return { c1: { x: s.ox + half, y: s.oy }, c2: { x: s.ox - half, y: s.oy }, radius: s.hy };
}

function isFiniteMove(r: MoverResult): boolean {
    return Number.isFinite(r.dx) && Number.isFinite(r.dy)
        && Number.isFinite(r.velX) && Number.isFinite(r.velY);
}

let warnedNonFiniteMove = false;

function warnNonFiniteMove(entity: Entity, ppu: number, dt: number): void {
    if (warnedNonFiniteMove) return;
    warnedNonFiniteMove = true;
    log.error('physics', `CharacterController2D move on entity ${entity} resolved to a non-finite pose `
        + `(ppu=${ppu}, dt=${dt}); the Transform was left where it was. Check the entity's collider, `
        + 'velocity and the Canvas pixelsPerUnit.');
}

/**
 * Register the character-controller system. Runs in FixedUpdate ahead of the
 * physics step, so the resolved Transform is what reaches a kinematic body.
 * Movement goes through Box2D's kinematic mover, which — unlike a generic shape
 * cast — rests a character on the ground instead of wedging it there.
 */
export function registerCharacterController2DSystem(app: App): void {
    warnedNonFiniteMove = false;
    app.addSystemToSchedule(
        Schedule.FixedUpdate,
        defineSystem(
            [Query(Mut(CharacterController2D)), Res(Time), Res(Physics2D), GetWorld()],
            (
                query: Iterable<[Entity, CharacterController2DData]>,
                time: TimeData,
                physics: Physics2DAPI,
                world: World,
            ) => {
                const dt = time.fixedDelta;
                if (dt <= 0) return;
                // Push before reading: this runs ahead of PhysicsStepSystem, the other
                // caller, so on the first fixed step nobody has pushed one yet.
                physics.setPixelsPerUnit(readPixelsPerUnit(app));
                const ppu = physics.getPixelsPerUnit();
                const invDt = 1 / dt;

                for (const [entity, cc] of query) {
                    const shape = resolveCastShape(world, entity, ppu);
                    if (!shape) continue;
                    const mover = moverCapsuleFromShape(shape);

                    // Transform is C++-backed: get() yields a converted copy, so the
                    // resolved pose must be written back with set() (mutating the copy
                    // alone would not persist).
                    const transform = world.get(entity, Transform) as TransformData;
                    const startX = transform.position.x;
                    const startY = transform.position.y;

                    const r = physics.moveCharacter(
                        transform.position, mover.c1, mover.c2, mover.radius,
                        cc.velocity, dt, cc.up, Math.cos(cc.floorMaxAngle),
                        cc.maskBits, entity,
                        cc.skinWidth, cc.maxSlides, cc.snapLength, cc.slideOnCeiling,
                        ppu,
                    );
                    if (!r) continue;
                    // A non-finite move is not survivable: the next move starts from the
                    // position this writes, so one NaN frame kills the character for the
                    // session. Keep the last good pose and say so once.
                    if (!isFiniteMove(r)) { warnNonFiniteMove(entity, ppu, dt); continue; }

                    // Write both local and world position: PhysicsStepSystem runs next
                    // in this same FixedUpdate and pushes worldPosition into a kinematic
                    // body, before TransformSystem re-derives world from local.
                    transform.position.x = startX + r.dx;
                    transform.position.y = startY + r.dy;
                    transform.worldPosition.x = transform.position.x;
                    transform.worldPosition.y = transform.position.y;
                    world.set(entity, Transform, transform);

                    cc.velocity.x = r.velX;
                    cc.velocity.y = r.velY;
                    cc.isOnFloor = r.isOnFloor;
                    cc.isOnWall = r.isOnWall;
                    cc.isOnCeiling = r.isOnCeiling;
                    cc.floorNormal.x = r.floorNormalX;
                    cc.floorNormal.y = r.floorNormalY;
                    cc.realVelocity.x = r.dx * invDt;
                    cc.realVelocity.y = r.dy * invDt;
                }
            },
            {
                name: 'CharacterController2DSystem',
                runBefore: ['PhysicsStepSystem'],
                // The World is how it reaches the collider (whichever of the three
                // a character has) and the pose it resolves; the solver's contacts
                // are physics-side state, not components.
                touches: {
                    reads: [BoxCollider2D._name, CircleCollider2D._name, CapsuleCollider2D._name],
                    writes: [Transform._name],
                },
            },
        ),
        { runIf: playModeOnly },
    );
}
