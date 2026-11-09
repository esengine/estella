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
import { Parent, Transform, type ParentData, type TransformData } from '../ecs/component';
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
import { Input, type InputState } from '../input/input';
import { PlatformerController2D, platformerState, stepPlatformer, type PlatformerController2DData, type PlatformerState } from './PlatformerController2D';
import { log } from '../util/logger';
import type { MoverResult } from './PhysicsTypes';
import type { World } from '../ecs/world';
import {
    CharacterController2D, CharacterDynamicBodies, moveAndSlide,
    type CharacterController2DData, type SlideHit,
} from './CharacterController2D';

// =============================================================================
// System
// =============================================================================

const platformerStates = new WeakMap<World, Map<Entity, PlatformerState>>();

function platformerStateOf(world: World, entity: Entity, airJumps: number): PlatformerState {
    let states = platformerStates.get(world);
    if (!states) { states = new Map(); platformerStates.set(world, states); }
    let state = states.get(entity);
    if (!state) { state = platformerState(airJumps); states.set(entity, state); }
    return state;
}

/** Input per rendered frame, so a tap between two fixed steps is not lost; the character's wishes per fixed step, ahead of its move. */
function registerPlatformerController2DSystems(app: App): void {
    app.world.onDespawn((entity: Entity) => { platformerStates.get(app.world)?.delete(entity); });
    app.addSystemToSchedule(
        Schedule.Update,
        defineSystem(
            [Query(Mut(PlatformerController2D)), Res(Input)],
            (query: Iterable<[Entity, PlatformerController2DData]>, input: InputState) => {
                for (const [, p] of query) {
                    if (!p.enabled || !p.readKeyboard) continue;
                    const right = input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight');
                    const left = input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft');
                    p.moveInput = (right ? 1 : 0) - (left ? 1 : 0);
                    p.jumpHeld = input.isKeyDown('Space') || input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp');
                    const pressed = input.isKeyPressed('Space') || input.isKeyPressed('KeyW') || input.isKeyPressed('ArrowUp');
                    const down = input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown');
                    if (pressed && down) p.dropPressed = true;
                    else if (pressed) p.jumpPressed = true;
                }
            },
            { name: 'PlatformerController2DInputSystem' },
        ),
        { runIf: playModeOnly },
    );
    app.addSystemToSchedule(
        Schedule.FixedUpdate,
        defineSystem(
            [Query(Mut(PlatformerController2D), Mut(CharacterController2D)), Res(Time), GetWorld()],
            (query: Iterable<[Entity, PlatformerController2DData, CharacterController2DData]>, time: TimeData, world: World) => {
                const dt = time.fixedDelta;
                if (dt <= 0) return;
                for (const [entity, p, cc] of query) {
                    if (!p.enabled) continue;
                    const rx = cc.up.y, ry = -cc.up.x;
                    const step = stepPlatformer(
                        p, platformerStateOf(world, entity, p.airJumps),
                        {
                            onFloor: cc.isOnFloor, onCeiling: cc.isOnCeiling,
                            floorVelocityX: cc.floorVelocity.x * rx + cc.floorVelocity.y * ry,
                            floorVelocityY: cc.floorVelocity.x * cc.up.x + cc.floorVelocity.y * cc.up.y,
                        },
                        cc.velocity.x * rx + cc.velocity.y * ry, cc.velocity.x * cc.up.x + cc.velocity.y * cc.up.y,
                        p.jumpPressed, p.dropPressed, dt,
                    );
                    p.jumpPressed = false;
                    p.dropPressed = false;
                    cc.velocity.x = rx * step.velocityX + cc.up.x * step.velocityY;
                    cc.velocity.y = ry * step.velocityX + cc.up.y * step.velocityY;
                    cc.dropThrough = step.dropThrough;
                    // Off the floor this move, or it would still read as standing where it just jumped from.
                    if (step.jumped) cc.isOnFloor = false;
                }
            },
            {
                name: 'PlatformerController2DSystem',
                runBefore: ['CharacterController2DSystem'],
                // The World is only the key its per-character state is kept under.
                touches: { reads: [], writes: [] },
            },
        ),
        { runIf: playModeOnly },
    );
}

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

const NO_CARRY: Vec2 = { x: 0, y: 0 };

/**
 * How fast what it stands on carries it, pixels per second. A body's velocity is what it moved by in the step before this one, whoever
 * moved it, which is exactly how far it has gone from under the character since the last move.
 */
function platformCarry(physics: Physics2DAPI, world: World, cc: CharacterController2DData, ppu: number): Vec2 {
    if (!cc.followPlatform || !cc.isOnFloor || !cc.floorEntity || !world.valid(cc.floorEntity)) return NO_CARRY;
    const velocity = physics.getLinearVelocity(cc.floorEntity);
    const spin = physics.getAngularVelocity(cc.floorEntity);
    if (velocity.x === 0 && velocity.y === 0 && spin === 0) return NO_CARRY;
    return { x: velocity.x * ppu, y: velocity.y * ppu };
}

/** Along a walkable slope, not into it: what keeps a character from sliding down one and from launching off its top. */
function slopeVelocity(cc: CharacterController2DData): Vec2 {
    if (!cc.stopOnSlope || !cc.isOnFloor) return cc.velocity;
    const ups = cc.velocity.x * cc.up.x + cc.velocity.y * cc.up.y;
    if (ups > 0) return cc.velocity;
    const nUp = cc.floorNormal.x * cc.up.x + cc.floorNormal.y * cc.up.y;
    if (nUp >= 0.9999 || nUp <= 0) return cc.velocity;
    const rx = cc.up.y, ry = -cc.up.x;
    const across = cc.velocity.x * rx + cc.velocity.y * ry;
    // The right along the slope: the ground's right with the part into the floor taken out.
    const into = rx * cc.floorNormal.x + ry * cc.floorNormal.y;
    let tx = rx - into * cc.floorNormal.x, ty = ry - into * cc.floorNormal.y;
    const scale = cc.constantSlopeSpeed ? 1 / (Math.hypot(tx, ty) || 1) : 1 / ((tx * rx + ty * ry) || 1);
    tx *= scale; ty *= scale;
    return { x: tx * across, y: ty * across };
}

/** What a slope walk leaves it with: the speed it asked for across the ground, unless something stopped it. */
function velocityAfterSlope(cc: CharacterController2DData, r: MoverResult): Vec2 {
    const rx = cc.up.y, ry = -cc.up.x;
    const asked = cc.velocity.x * rx + cc.velocity.y * ry;
    const across = r.isOnWall ? r.velX * rx + r.velY * ry : asked;
    return { x: rx * across, y: ry * across };
}

/** Lean into what it pressed against, up to its force, and only as far as the body is not already getting away. */
function pushBodies(physics: Physics2DAPI, hits: NonNullable<MoverResult['hits']>, cc: CharacterController2DData, ppu: number): void {
    for (const hit of hits) {
        const into = -(cc.velocity.x * hit.normalX + cc.velocity.y * hit.normalY);
        // A body underfoot holds the character up: pressing on it is standing, not pushing.
        if (hit.normalX * cc.up.x + hit.normalY * cc.up.y > 0.5) continue;
        const asked = Math.abs(cc.velocity.x) + Math.abs(cc.velocity.y);
        const speed = Math.max(into, asked * Math.abs(hit.normalX * cc.up.y - hit.normalY * cc.up.x));
        if (speed <= 0) continue;
        const velocity = physics.getLinearVelocity(hit.entity);
        const away = -(velocity.x * hit.normalX + velocity.y * hit.normalY) * ppu;
        if (away >= speed) continue;
        physics.applyForce(hit.entity, { x: -hit.normalX * cc.pushForce, y: -hit.normalY * cc.pushForce });
    }
}

/** A world displacement in the parent's own space, which is what a local position is measured in. */
function worldDeltaToLocal(world: World, entity: Entity, dx: number, dy: number): Vec2 {
    const parent = (world.get(entity, Parent) as ParentData).entity;
    if (!world.valid(parent) || !world.has(parent, Transform)) return { x: dx, y: dy };
    const up = world.get(parent, Transform) as TransformData;
    const angle = 2 * Math.atan2(up.worldRotation.z, up.worldRotation.w), c = Math.cos(angle), s = Math.sin(angle);
    return { x: (c * dx + s * dy) / (up.worldScale.x || 1), y: (-s * dx + c * dy) / (up.worldScale.y || 1) };
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
    registerPlatformerController2DSystems(app);
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
                    const carry = platformCarry(physics, world, cc, ppu);
                    const asked = slopeVelocity(cc);

                    // The solver works in the world: a parent would otherwise put the capsule at its local position.
                    // Transform is C++-backed, so get() is a copy and the resolved pose goes back through set().
                    const parented = world.has(entity, Parent);
                    if (parented) world.ensureTransformsComposed();
                    const transform = world.get(entity, Transform) as TransformData;
                    const from = parented ? transform.worldPosition : transform.position;

                    const r = physics.moveCharacter(
                        from, mover.c1, mover.c2, mover.radius,
                        asked, dt, cc.up, Math.cos(cc.floorMaxAngle),
                        cc.maskBits, entity,
                        cc.skinWidth, cc.maxSlides, cc.snapLength, cc.slideOnCeiling,
                        ppu, {
                            carry, dropThrough: cc.dropThrough, ignoreDynamic: cc.dynamicBodies === CharacterDynamicBodies.Ignore,
                            blockSteepSlopes: cc.blockSteepSlopes, wasOnFloor: cc.isOnFloor, stepHeight: cc.stepHeight,
                        },
                    );
                    if (!r) continue;
                    // A non-finite move is not survivable: the next move starts from the
                    // position this writes, so one NaN frame kills the character for the
                    // session. Keep the last good pose and say so once.
                    if (!isFiniteMove(r)) { warnNonFiniteMove(entity, ppu, dt); continue; }

                    // Write both local and world position: PhysicsStepSystem runs next
                    // in this same FixedUpdate and pushes worldPosition into a kinematic
                    // body, before TransformSystem re-derives world from local.
                    const local = parented ? worldDeltaToLocal(world, entity, r.dx, r.dy) : { x: r.dx, y: r.dy };
                    transform.position.x += local.x;
                    transform.position.y += local.y;
                    transform.worldPosition.x = from.x + r.dx;
                    transform.worldPosition.y = from.y + r.dy;
                    world.set(entity, Transform, transform);

                    const kept = asked === cc.velocity ? null : velocityAfterSlope(cc, r);
                    cc.velocity.x = kept ? kept.x : r.velX;
                    cc.velocity.y = kept ? kept.y : r.velY;
                    if (r.hits && cc.dynamicBodies === CharacterDynamicBodies.Push) pushBodies(physics, r.hits, cc, ppu);
                    cc.floorEntity = (r.floorEntity ?? 0) as Entity;
                    cc.floorVelocity.x = carry.x;
                    cc.floorVelocity.y = carry.y;
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
                    reads: [BoxCollider2D._name, CircleCollider2D._name, CapsuleCollider2D._name, Parent._name],
                    writes: [Transform._name],
                },
            },
        ),
        { runIf: playModeOnly, profileDomain: 'physics' },
    );
}
