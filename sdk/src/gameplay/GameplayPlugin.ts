// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GameplayPlugin.ts
 * @brief   Wires the third-person character and its camera into the frame.
 *
 * @details Three systems, and WHERE they sit is the design. The controller asks
 *          before the physics step and observes after it, so what reaches the
 *          animator is the motion the world allowed rather than the motion the
 *          player asked for. The camera runs once a frame, after everything has
 *          moved, because it follows and is never followed.
 */

import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { Input, type InputState } from '../input/input';
import { Transform, type TransformData } from '../ecs/component';
import { CharacterController3D, type CharacterController3DData } from '../physics3d/Physics3DComponents';
import { Physics3D, Physics3DRuntime } from '../physics3d/Physics3DPlugin';
import type { Physics3DQueries } from '../physics3d/Physics3DQueries';
import { Animator, AnimatorController, type AnimatorControllerAPI } from '../animation/Animator';
import {
    AnimatorRootMotion, type AnimatorRootMotionData,
} from '../animation/animatorRootMotion';
import { AnimatorEvent, type AnimatorEventPayload } from '../animation/animatorEvent';
import { EventReader, EventWriter, type EventWriterInstance } from '../ecs/event';
import { Damage, Health, applyDamage, tickHealth, type DamagePayload, type HealthData } from './Health';
import { MeleeAttack, MeleeAttacks, resolveMeleeHits, sweepMeleeWindows, type MeleeAttackData, type MeleeWindowSource } from './MeleeAttack';
import { huntTargets, staggerHunter } from './Hunter';
import { Stamina, regenerateStamina, type StaminaData } from './Stamina';
import { COMBAT_INVULNERABLE, TPC_STAGGER, LOCK_KEY } from './vocabulary';
import { PlatformerController2D, type PlatformerController2DData } from '../physics/PlatformerController2D';
import { q } from '../math/quat';
import { look as lookFirstPerson, move as moveFirstPerson, installViewModels, TouchLook } from './firstPersonSystems';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { Playthrough } from '../runtime/playthrough';
import {
    ThirdPersonController, type ThirdPersonControllerData,
    desiredDirection, approachVelocity, facingYaw, turnToward, rootMotionVelocity, shortestAngleDelta,
    yawQuaternion, yawOfQuaternion, WORLD_BASIS, DODGE_KEY, ATTACK_KEY,
    TPC_SPEED, TPC_GROUNDED, TPC_DODGE, TPC_ATTACK, TPC_JUMP, TPC_SPRINT, type MoveBasis,
} from './ThirdPersonController';
import { spendStamina } from './Stamina';
import {
    ThirdPersonCamera, type ThirdPersonCameraData,
    orbitOffset, cameraGroundBasis, dampFactor, clampPitch,
} from './ThirdPersonCamera';
import { Camera } from '../ecs/component';
import type { CameraData } from '../ecs/component.generated';
import { CameraDirector, shakeCamera } from '../camera/CameraDirector';

/**
 * What the animation is asking this character to do, or null when nothing is.
 * Presence of the component is the opt-in and `active` is the switch — "the
 * delta is non-zero" is not, being false in the still moment inside a dodge.
 */
function rootMotionRequest(world: World, entity: Entity): AnimatorRootMotionData | null {
    if (!world.has(entity, AnimatorRootMotion)) return null;
    const data = world.get(entity, AnimatorRootMotion) as AnimatorRootMotionData;
    return data.active ? data : null;
}

/** How long the dodge key is held before it is a sprint rather than a dodge, seconds. */
const SPRINT_HOLD = 0.22;

/** What a controller remembers between fixed steps: the forgiveness of its jump and what its dodge key is doing. */
interface ControllerFeel {
    /** Seconds a jump still counts as from the ground. */
    coyote: number;
    /** Seconds a jump pressed too early has left. */
    buffered: number;
    jumpWasDown: boolean;
    dodgeWasDown: boolean;
    /** Seconds the dodge key has been down. */
    dodgeHeld: number;
    /** The bar ran out mid-sprint: a run until the key is let go. */
    exhausted: boolean;
    /** Sprinting this step, for the camera that widens with it. */
    sprinting: boolean;
}

const feels = new WeakMap<World, Map<Entity, ControllerFeel>>();

function feelOf(world: World, entity: Entity): ControllerFeel {
    let byEntity = feels.get(world);
    if (!byEntity) { byEntity = new Map(); feels.set(world, byEntity); }
    let feel = byEntity.get(entity);
    if (!feel) {
        feel = { coyote: 0, buffered: 0, jumpWasDown: false, dodgeWasDown: false, dodgeHeld: 0, exhausted: false, sprinting: false };
        byEntity.set(entity, feel);
    }
    return feel;
}

/**
 * Whether no blow lands on @p entity now: inside a window its animation declared invulnerable (a dodge's frames), or
 * dashing as a 2D platformer that says a dash is.
 */
function untouchable(world: World, windows: MeleeWindowSource | null, entity: Entity): boolean {
    if (windows?.openWindow(entity, COMBAT_INVULNERABLE)) return true;
    if (!world.has(entity, PlatformerController2D)) return false;
    const platformer = world.get(entity, PlatformerController2D) as PlatformerController2DData;
    return !!platformer.dashing && platformer.dashInvulnerable !== false;
}

/** The dashes each 2D platformer has paid for, so each one that starts is paid once. */
const paidDashes = new WeakMap<World, Map<Entity, number>>();

/**
 * A 2D platformer's dash, against its Stamina: a press on an empty bar is taken back before the step that would dash,
 * and each dash that did start is paid for after it.
 */
function paidOf(world: World): Map<Entity, number> {
    let paid = paidDashes.get(world);
    if (!paid) { paid = new Map(); paidDashes.set(world, paid); }
    return paid;
}

function refuseUnaffordableDashes(world: World): void {
    const paid = paidOf(world);
    for (const entity of world.getEntitiesWithComponents([PlatformerController2D, Stamina])) {
        const platformer = world.get(entity, PlatformerController2D) as PlatformerController2DData;
        // Counted from before the step, so the first dash a character makes is paid for too.
        if (!paid.has(entity)) paid.set(entity, platformer.dashCount ?? 0);
        if (!platformer.dashPressed) continue;
        if ((world.get(entity, Stamina) as StaminaData).current <= 0) {
            world.update(entity, PlatformerController2D, (p: PlatformerController2DData) => { p.dashPressed = false; });
        }
    }
}

function payForDashes(world: World): void {
    const paid = paidOf(world);
    for (const entity of world.getEntitiesWithComponents([PlatformerController2D, Stamina])) {
        const platformer = world.get(entity, PlatformerController2D) as PlatformerController2DData;
        const count = platformer.dashCount ?? 0;
        const before = paid.get(entity) ?? count;
        paid.set(entity, count);
        if (count > before) spendStamina(world, entity, (platformer.dashCost ?? 0) * (count - before));
    }
}

/** What the stick last asked of each character that walks by its animation: a ground direction, how hard (0..1), and the speed the animator is told, which follows it at the controller's rates. */
const wishes = new Map<Entity, { x: number; z: number; amount: number; speed: number; back: boolean }>();

/** The stick, from the keys a keyboard stands in for one with. */
function readStick(input: InputState): { x: number; y: number } {
    const x = (input.isKeyDown('KeyD') ? 1 : 0) - (input.isKeyDown('KeyA') ? 1 : 0);
    const y = (input.isKeyDown('KeyW') ? 1 : 0) - (input.isKeyDown('KeyS') ? 1 : 0);
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

/** The camera a controller reads forward from: the one it names, else any. */
function basisFor(world: World, data: ThirdPersonControllerData): MoveBasis {
    if (!data.cameraRelative) return WORLD_BASIS;
    const named = data.camera && world.has(data.camera, ThirdPersonCamera)
        ? data.camera
        : world.getEntitiesWithComponents([ThirdPersonCamera])[0];
    if (named === undefined) return WORLD_BASIS;
    return cameraGroundBasis((world.get(named, ThirdPersonCamera) as ThirdPersonCameraData).yaw);
}

/**
 * Ask for motion: the stick, in the camera's ground plane, as a velocity the
 * character controller will try to honour. The vertical component is left alone
 * unless a jump starts one, because the character controller carries it.
 */
export function requestMotion(
    world: World, input: InputState, dt: number,
    animator: AnimatorControllerAPI | null = null,
): void {
    for (const entity of world.getEntitiesWithComponents([ThirdPersonController, CharacterController3D])) {
        const data = world.get(entity, ThirdPersonController) as ThirdPersonControllerData;
        if (!data.enabled) continue;
        const feel = feelOf(world, entity);
        const stick = readStick(input);

        // With a sprint, the dodge key is two things: held it sprints, and a tap goes out as a dodge when it is let
        // go. Read from the key's level, which every fixed step sees, rather than its edges.
        const sprintSpeed = data.sprintSpeed ?? 0;
        const dodgeDown = input.isKeyDown(DODGE_KEY);
        let dodgeAsked: boolean;
        if (sprintSpeed > 0) {
            dodgeAsked = !dodgeDown && feel.dodgeWasDown && feel.dodgeHeld < SPRINT_HOLD;
            if (dodgeDown) feel.dodgeHeld += dt;
            else { feel.dodgeHeld = 0; feel.exhausted = false; }
        } else {
            dodgeAsked = input.isKeyPressed(DODGE_KEY);
        }
        feel.dodgeWasDown = dodgeDown;

        if (animator && world.has(entity, Animator)) {
            // A press asks for the ACTION; which clip that is, and whether this
            // character has one at all, stays the animator graph's answer. An
            // empty Stamina refuses it before the graph hears of it.
            if (dodgeAsked && spendStamina(world, entity, data.dodgeCost ?? 0)) animator.setTrigger(entity, TPC_DODGE);
            if (input.isKeyPressed(ATTACK_KEY) && spendStamina(world, entity, data.attackCost ?? 0)) {
                animator.setTrigger(entity, TPC_ATTACK);
            }
        }

        // A sprint draws on the bar while it lasts; run dry, it is a run until the key is let go.
        let sprinting = sprintSpeed > 0 && dodgeDown && feel.dodgeHeld >= SPRINT_HOLD && !feel.exhausted
            && Math.hypot(stick.x, stick.y) > 0;
        if (sprinting && !spendStamina(world, entity, (data.sprintCost ?? 0) * dt)) {
            feel.exhausted = true;
            sprinting = false;
        }
        feel.sprinting = sprinting;
        const topSpeed = sprinting ? sprintSpeed : data.moveSpeed;
        if (sprintSpeed > 0 && animator && world.has(entity, Animator)) animator.setBool(entity, TPC_SPRINT, sprinting);

        const character = world.get(entity, CharacterController3D) as CharacterController3DData;
        // Which of the two states the character's movement: the stick, or the
        // animation that declared itself in charge. Chosen HERE and not by the
        // animator, which states a request and never a position.
        const driven = rootMotionRequest(world, entity);
        const direction = desiredDirection(stick, basisFor(world, data));
        // A character that walks by its animation: the stick is a wish, kept for
        // the step that tells the animator and turns the character.
        const byAnimation = data.rootMotion === true && world.has(entity, AnimatorRootMotion);
        if (byAnimation) {
            // The speed asked of the animator comes up to the stick's at the controller's own rates, so a gait changes
            // over the time the character takes to reach it rather than in one frame.
            const amount = Math.min(1, Math.hypot(stick.x, stick.y));
            // Asked to turn back the way she came, she slows while she comes round; anything short of a right angle
            // she runs through at full speed, or every touch of the stick would be a stumble. Full speed up to
            // across, none straight back.
            let along = 1;
            let back = false;
            if (amount > 0 && world.has(entity, Transform)) {
                const facing = yawOfQuaternion((world.get(entity, Transform) as TransformData).rotation);
                const error = shortestAngleDelta(facing, facingYaw(direction)) * Math.PI / 180;
                back = Math.cos(error) < 0;
                along = back ? 1 + Math.cos(error) : 1;
            }
            const wanted = amount * topSpeed * along;
            const was = wishes.get(entity)?.speed ?? 0;
            const rate = (wanted < was ? data.deceleration : data.acceleration) * dt;
            const speed = Math.abs(wanted - was) <= rate ? wanted : was + Math.sign(wanted - was) * rate;
            wishes.set(entity, { x: direction.x, z: direction.z, amount, speed, back });
        } else {
            wishes.delete(entity);
        }
        let next: { x: number; z: number };
        if (driven && byAnimation && character.isOnFloor && wishes.get(entity)!.back) {
            // Turned back the way it came, the gait says how fast and the stick which way. Travelling along its facing,
            // a character turned round at a run would carry on the way it was going while it came round and end up a
            // stride or two off to the side. Its velocity is brought round to the stick at the controller's rates
            // instead: it slows along the line it was on, turns, and goes off the other way from where it stood.
            // Anything short of that it runs through along its facing, which turns with the stick: the speed stays
            // the gait's and the feet stay where the clip put them.
            const pace = rootMotionVelocity(driven.deltaPosition, driven.deltaTime);
            const rate = Math.hypot(pace.x, pace.z);
            const wish = wishes.get(entity)!;
            const way = wish.amount > 0 ? { x: wish.x, z: wish.z } : rate > 1e-6 ? { x: pace.x / rate, z: pace.z / rate } : { x: 0, z: 0 };
            next = approachVelocity(
                { x: character.velocity.x, z: character.velocity.z }, { x: way.x * rate, z: way.z * rate },
                data.acceleration, data.deceleration, dt,
            );
        } else if (driven) {
            next = rootMotionVelocity(driven.deltaPosition, driven.deltaTime);
        } else if (byAnimation && character.isOnFloor) {
            // Standing, or between two gaits: no state is asking to move, and the
            // stick does not get to push a character whose feet are not walking.
            next = approachVelocity(
                { x: character.velocity.x, z: character.velocity.z }, { x: 0, z: 0 },
                data.acceleration, data.deceleration, dt,
            );
        } else {
            const target = {
                x: direction.x * topSpeed,
                z: direction.z * topSpeed,
            };
            // Off the ground the player has only as much say as airControl allows.
            const authority = character.isOnFloor ? 1 : Math.max(0, Math.min(1, data.airControl));
            next = approachVelocity(
                { x: character.velocity.x, z: character.velocity.z }, target,
                data.acceleration * authority, data.deceleration * authority, dt,
            );
        }

        // The vertical is ours only for a jump (0 is "walk"), and never while an animation drives.
        // A jump forgives both ways: pressed just before landing, or just after walking off an edge.
        const jumpDown = input.isKeyDown('Space');
        const jumpPressed = input.isKeyPressed('Space') || (jumpDown && !feel.jumpWasDown);
        feel.jumpWasDown = jumpDown;
        feel.coyote = character.isOnFloor ? (data.coyoteTime ?? 0) : Math.max(0, feel.coyote - dt);
        feel.buffered = jumpPressed ? Math.max(data.jumpBuffer ?? 0, dt) : Math.max(0, feel.buffered - dt);
        const wantsJump = feel.buffered > 0 || (jumpDown && character.isOnFloor);
        const jumping = !driven && data.jumpSpeed > 0 && (character.isOnFloor || feel.coyote > 0) && wantsJump
            && spendStamina(world, entity, data.jumpCost ?? 0);
        if (jumping) { feel.coyote = 0; feel.buffered = 0; }

        world.update(entity, CharacterController3D, (c: CharacterController3DData) => {
            c.velocity.x = next.x;
            c.velocity.z = next.z;
            c.velocity.y = jumping ? data.jumpSpeed : 0;
        });

        // The jump that was APPLIED, not the key that asked for one. An edge
        // rather than a level: this runs on the fixed clock and the animator on
        // the frame's, so a whole arc can pass between two of its samples.
        if (jumping && animator && world.has(entity, Animator)) {
            animator.setTrigger(entity, TPC_JUMP);
        }
    }
}

/**
 * Observe what happened. The animator is told the speed the character REACHED,
 * so walking into a wall reads as standing still, and the character turns to
 * face where it actually went.
 */
export function observeMotion(world: World, animator: AnimatorControllerAPI | null, dt: number): void {
    for (const entity of world.getEntitiesWithComponents([ThirdPersonController, CharacterController3D])) {
        const data = world.get(entity, ThirdPersonController) as ThirdPersonControllerData;
        if (!data.enabled) continue;

        const character = world.get(entity, CharacterController3D) as CharacterController3DData;
        const moved = character.realVelocity;
        const speed = Math.hypot(moved.x, moved.z);
        const wish = wishes.get(entity);

        if (animator && world.has(entity, Animator)) {
            // Walking by animation, the animator is told the speed ASKED for: the
            // gait it picks is what makes the speed, so the speed reached cannot
            // be what picks the gait.
            const told = wish ? wish.speed : speed;
            animator.setFloat(entity, TPC_SPEED, told < data.idleThreshold ? 0 : told);
            animator.setBool(entity, TPC_GROUNDED, character.isOnFloor);
        }

        if (!world.has(entity, Transform)) continue;

        // Walking by animation, the stick is the heading: the clip travels along
        // the way the character faces, so turning it is how the stick steers.
        if (wish) {
            if (wish.amount <= 0) continue;
            const wanted = facingYaw({ x: wish.x, y: 0, z: wish.z });
            world.update(entity, Transform, (t: TransformData) => {
                const turned = turnToward(yawOfQuaternion(t.rotation), wanted, data.rotationSpeed, dt);
                const yaw = yawQuaternion(turned);
                t.rotation.w = yaw.w; t.rotation.x = yaw.x; t.rotation.y = yaw.y; t.rotation.z = yaw.z;
            });
            continue;
        }

        // While an animation is driving, the heading is the animation's too —
        // turning to face the motion as well would be a second author of the
        // yaw, and the two disagree the moment a dodge goes sideways.
        const driven = rootMotionRequest(world, entity);
        if (driven) {
            if (driven.deltaTime <= 0) continue;
            // This step's share of the frame's turn: the animator states one per
            // rendered frame, and this runs once per fixed step inside it.
            const step = q.scaled(driven.deltaRotation, Math.min(dt / driven.deltaTime, 1));
            world.update(entity, Transform, (t: TransformData) => {
                const turned = q.normalize(q.mul(t.rotation, step));
                t.rotation.w = turned.w; t.rotation.x = turned.x;
                t.rotation.y = turned.y; t.rotation.z = turned.z;
            });
            continue;
        }

        // Locked onto a foe, it faces the foe whichever way it moves: a strafe, a step back.
        const foe = lockedFoe(world, data);
        if (foe !== null) {
            const at = (world.get(foe, Transform) as TransformData).position;
            const from = (world.get(entity, Transform) as TransformData).position;
            if (Math.hypot(at.x - from.x, at.z - from.z) > 1e-6) {
                const toward = facingYaw({ x: at.x - from.x, y: 0, z: at.z - from.z });
                world.update(entity, Transform, (t: TransformData) => {
                    const yaw = yawQuaternion(turnToward(yawOfQuaternion(t.rotation), toward, data.rotationSpeed, dt));
                    t.rotation.w = yaw.w; t.rotation.x = yaw.x; t.rotation.y = yaw.y; t.rotation.z = yaw.z;
                });
            }
            continue;
        }

        // Face where it is going, not where it was asked to go - and hold the
        // last heading when it stops, rather than snapping back to world forward.
        if (speed < data.idleThreshold) continue;
        const wanted = facingYaw({ x: moved.x, y: 0, z: moved.z });
        world.update(entity, Transform, (t: TransformData) => {
            const turned = turnToward(yawOfQuaternion(t.rotation), wanted, data.rotationSpeed, dt);
            const yaw = yawQuaternion(turned);
            t.rotation.w = yaw.w; t.rotation.x = yaw.x; t.rotation.y = yaw.y; t.rotation.z = yaw.z;
        });
    }
}

/** Per-camera pointer state, so a delta exists without the input layer keeping one. */
const lastPointer = new Map<Entity, { x: number; y: number }>();

/**
 * How far back the eye may sit before something solid is in the way. The probe
 * is a sphere so the eye stops short of a wall rather than touching it.
 */
function clearDistance(
    queries: Physics3DQueries | null, data: ThirdPersonCameraData,
    pivot: { x: number; y: number; z: number }, offset: { x: number; y: number; z: number },
): number {
    if (!data.obstruction || !queries || data.distance <= 0) return data.distance;
    const hit = queries.sphereCast(
        pivot, data.obstructionRadius,
        { x: offset.x * data.distance, y: offset.y * data.distance, z: offset.z * data.distance },
        data.obstructionLayers,
    );
    if (!hit) return data.distance;
    // The hit is a FRACTION of the sweep, and the sweep was the full distance.
    return Math.max(0, Math.min(data.distance, hit.fraction * data.distance));
}

/** What a camera remembers between frames: how far out the eye stands now, the widening it added, and how long the pointer has left it alone. */
interface CameraFeel {
    distance: number | null;
    fovKick: number;
    idle: number;
}

const cameraFeels = new WeakMap<World, Map<Entity, CameraFeel>>();

function cameraFeelOf(world: World, entity: Entity): CameraFeel {
    let byEntity = cameraFeels.get(world);
    if (!byEntity) { byEntity = new Map(); cameraFeels.set(world, byEntity); }
    let feel = byEntity.get(entity);
    if (!feel) { feel = { distance: null, fovKick: 0, idle: 0 }; byEntity.set(entity, feel); }
    return feel;
}

/** Whether @p entity stands to be locked onto: there, placed, and not down. */
function lockable(world: World, entity: Entity): boolean {
    if (!entity || !world.valid(entity) || !world.has(entity, Transform)) return false;
    return !world.has(entity, Health) || (world.get(entity, Health) as HealthData).current > 0;
}

/**
 * The foe the lock key picks: alive, within `range` of the target, and in front of the view, nearest first with what
 * is straight ahead preferred. Null when there is none.
 */
export function pickLockTarget(
    world: World, target: Entity, yawDeg: number, range: number,
): Entity | null {
    const from = (world.get(target, Transform) as TransformData).position;
    const ahead = cameraGroundBasis(yawDeg).forward;
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const candidate of world.getEntitiesWithComponents([Health, Transform])) {
        if (candidate === target || !lockable(world, candidate)) continue;
        const at = (world.get(candidate, Transform) as TransformData).position;
        const dx = at.x - from.x, dz = at.z - from.z;
        const distance = Math.hypot(dx, dz);
        if (distance > range || distance < 1e-6) continue;
        const facing = (dx * ahead.x + dz * ahead.z) / distance;
        if (facing < 0.3) continue;
        const score = distance * (2 - facing);
        if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best;
}

/** The yaw that looks from behind @p from toward @p to along the ground, degrees: the camera's forward is its -offset. */
function yawLookingAt(from: { x: number; z: number }, to: { x: number; z: number }): number | null {
    const dx = to.x - from.x, dz = to.z - from.z;
    if (Math.hypot(dx, dz) < 1e-6) return null;
    return Math.atan2(-dx, -dz) * 180 / Math.PI;
}

export function updateCameras(
    world: World, input: InputState, queries: Physics3DQueries | null, dt: number,
): void {
    for (const entity of world.getEntitiesWithComponents([ThirdPersonCamera, Transform])) {
        const data = world.get(entity, ThirdPersonCamera) as ThirdPersonCameraData;
        if (!data.enabled || !data.target || !world.has(data.target, Transform)) continue;
        const feel = cameraFeelOf(world, entity);
        const targetTransform = world.get(data.target, Transform) as TransformData;
        const here = targetTransform.position;

        // A lock lasts while the foe is there, alive and within reach; the lock key takes one or lets it go.
        let lockTarget = (data.lockTarget ?? 0) as Entity;
        const range = data.lockRange ?? 0;
        if (lockTarget && (!lockable(world, lockTarget) || (range > 0 && Math.hypot(
            (world.get(lockTarget, Transform) as TransformData).position.x - here.x,
            (world.get(lockTarget, Transform) as TransformData).position.z - here.z) > range * 1.5))) {
            lockTarget = 0 as Entity;
        }
        if (range > 0 && input.isKeyPressed(LOCK_KEY)) {
            lockTarget = lockTarget ? 0 as Entity : (pickLockTarget(world, data.target, data.yaw, range) ?? 0 as Entity);
        }

        const pointer = input.getMousePosition();
        const previous = lastPointer.get(entity);
        lastPointer.set(entity, { x: pointer.x, y: pointer.y });
        // Only while a button is held: a free pointer over the window is not
        // someone turning the camera.
        const dragging = input.isMouseButtonDown(0) || input.isMouseButtonDown(2);
        let { yaw, pitch } = data;
        const turned = !!previous && dragging && (pointer.x !== previous.x || pointer.y !== previous.y);
        if (previous && dragging) {
            // Locked, the foe decides where the view looks round; the pointer still tips it up and down.
            if (!lockTarget) yaw -= (pointer.x - previous.x) * data.sensitivity;
            pitch = clampPitch(pitch + (pointer.y - previous.y) * data.sensitivity,
                               data.minPitch, data.maxPitch);
        }
        feel.idle = turned ? 0 : feel.idle + dt;

        if (lockTarget) {
            const wanted = yawLookingAt(here, (world.get(lockTarget, Transform) as TransformData).position);
            if (wanted !== null) yaw += shortestAngleDelta(yaw, wanted) * dampFactor(data.lockTurnRate ?? 0, dt);
        } else if ((data.recenterDelay ?? 0) > 0 && feel.idle >= (data.recenterDelay ?? 0)
                   && world.has(data.target, CharacterController3D)) {
            // Left alone, the view swings round behind a target that is going somewhere.
            const moved = (world.get(data.target, CharacterController3D) as CharacterController3DData).realVelocity;
            const going = Math.hypot(moved.x, moved.z);
            const idle = world.has(data.target, ThirdPersonController)
                ? (world.get(data.target, ThirdPersonController) as ThirdPersonControllerData).idleThreshold : 0;
            if (going > Math.max(idle, 1e-6)) {
                yaw += shortestAngleDelta(yaw, facingYaw({ x: moved.x, y: 0, z: moved.z })) * dampFactor(1.4, dt);
            }
        }
        if (yaw !== data.yaw || pitch !== data.pitch || lockTarget !== (data.lockTarget ?? 0)) {
            world.update(entity, ThirdPersonCamera, (c: ThirdPersonCameraData) => {
                c.yaw = yaw; c.pitch = pitch;
                if (c.lockTarget !== undefined || lockTarget) c.lockTarget = lockTarget;
            });
        }

        let pivot = {
            x: here.x + data.targetOffset.x,
            y: here.y + data.targetOffset.y,
            z: here.z + data.targetOffset.z,
        };
        // Over the shoulder: the pivot stands aside, and no further than a wall beside it allows.
        let side = data.shoulder ?? 0;
        if (side !== 0) {
            const right = cameraGroundBasis(yaw).right;
            if (data.obstruction && queries) {
                const hit = queries.sphereCast(pivot, data.obstructionRadius,
                    { x: right.x * side, y: 0, z: right.z * side }, data.obstructionLayers);
                if (hit) side *= Math.max(0, Math.min(1, hit.fraction));
            }
            pivot = { x: pivot.x + right.x * side, y: pivot.y, z: pivot.z + right.z * side };
        }
        const offset = orbitOffset(yaw, pitch);
        // In at once, so nothing stands between; back out eased, so a pillar passed does not snap the view.
        const clear = clearDistance(queries, data, pivot, offset);
        const distance = feel.distance === null || clear < feel.distance
            ? clear
            : feel.distance + (clear - feel.distance) * dampFactor(data.recoverDamping ?? 0, dt);
        feel.distance = distance;
        const wanted = {
            x: pivot.x + offset.x * distance,
            y: pivot.y + offset.y * distance,
            z: pivot.z + offset.z * distance,
        };

        const k = dampFactor(data.followDamping, dt);
        world.update(entity, Transform, (t: TransformData) => {
            t.position.x += (wanted.x - t.position.x) * k;
            t.position.y += (wanted.y - t.position.y) * k;
            t.position.z += (wanted.z - t.position.z) * k;
            // Looking back down the offset it sits along: pitch tips the eye
            // down when the camera is above, which is the negative turn about X.
            const half = { p: -pitch * Math.PI / 360, y: yaw * Math.PI / 360 };
            const cp = Math.cos(half.p), sp = Math.sin(half.p);
            const cy = Math.cos(half.y), sy = Math.sin(half.y);
            t.rotation.w = cp * cy;
            t.rotation.x = sp * cy;
            t.rotation.y = cp * sy;
            t.rotation.z = -sp * sy;
        });

        // A sprint widens the view. The widening is this camera's own, so a field of view the game sets is kept under it.
        const sprintFov = data.sprintFov ?? 0;
        if ((sprintFov > 0 || feel.fovKick !== 0) && world.has(entity, Camera)) {
            const sprinting = feels.get(world)?.get(data.target)?.sprinting ?? false;
            const goal = sprinting ? sprintFov : 0;
            const kick = Math.abs(goal - feel.fovKick) < 1e-3 ? goal : feel.fovKick + (goal - feel.fovKick) * dampFactor(data.fovDamping ?? 0, dt);
            if (kick !== feel.fovKick) {
                const delta = kick - feel.fovKick;
                world.update(entity, Camera, (c: CameraData) => { c.fov += delta; });
                feel.fovKick = kick;
            }
        }
    }
}

/**
 * The foe a controller's camera is locked onto, or null: the character then faces it rather than where it walks.
 */
function lockedFoe(world: World, data: ThirdPersonControllerData): Entity | null {
    const camera = data.camera && world.has(data.camera, ThirdPersonCamera)
        ? data.camera
        : world.getEntitiesWithComponents([ThirdPersonCamera])[0];
    if (camera === undefined) return null;
    const lock = ((world.get(camera, ThirdPersonCamera) as ThirdPersonCameraData).lockTarget ?? 0) as Entity;
    return lock && lockable(world, lock) ? lock : null;
}

export class GameplayPlugin implements Plugin {
    name = 'gameplay';
    private offDespawn_: (() => void) | null = null;
    private offViewModels_: (() => void) | null = null;
    /** Per App, not per module: two Apps in one process must not share swings. */
    private readonly attacks_ = new MeleeAttacks();
    /** A hit stop under way: real seconds left, and the time scale it gives back. */
    private readonly hold_ = { left: 0, restore: 1, active: false, app: null as App | null };

    /**
     * Hold the whole game still for @p seconds of real time: Time.scale goes to 0 and comes back to what it was. A game
     * that changed the scale meanwhile keeps its own.
     */
    private holdFor_(app: App, seconds: number): void {
        if (!(seconds > 0)) return;
        const time = app.getResource(Time);
        if (!this.hold_.active) {
            this.hold_.restore = time.scale;
            this.hold_.active = true;
            this.hold_.app = app;
            time.scale = 0;
        }
        this.hold_.left = Math.max(this.hold_.left, seconds);
    }

    private releaseHold_(time: TimeData, elapsed: number): void {
        if (!this.hold_.active) return;
        this.hold_.left -= elapsed;
        if (this.hold_.left > 0) return;
        this.hold_.active = false;
        this.hold_.app = null;
        if (time.scale === 0) time.scale = this.hold_.restore;
    }

    build(app: App): void {
        const world = app.world;
        // Always present, empty until a game states something. Absent, a driver
        // cannot tell "this game publishes nothing" from "the seam is broken".
        app.insertResource(Playthrough, { facts: {} });
        const attacks = this.attacks_;
        this.offDespawn_ = world.onDespawn((entity: Entity) => {
            lastPointer.delete(entity);
            attacks.forget(entity);
            feels.get(world)?.delete(entity);
            cameraFeels.get(world)?.delete(entity);
            paidDashes.get(world)?.delete(entity);
        });

        // Before anything reads the clock this frame: a hit stop counts down in real time and gives the scale back.
        app.addSystemToSchedule(Schedule.First, defineSystem(
            [Res(Time)],
            (time: TimeData) => { this.releaseHold_(app.getResource(Time), time.unscaledDelta); },
            { name: 'HitStopSystem' },
        ), { runIf: playModeOnly });

        // The clocks a fight runs on: stamina coming back, the grace after a hit running out, poise returning.
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                regenerateStamina(world, time.delta);
                tickHealth(world, time.delta);
            },
            { name: 'CombatClockSystem' },
        ), { runIf: playModeOnly });

        // A 2D platformer's dash against its Stamina: refused on an empty bar before the step, paid for after it.
        app.addSystemToSchedule(Schedule.FixedPreUpdate, defineSystem(
            [],
            () => { refuseUnaffordableDashes(world); },
            { name: 'DashStaminaGateSystem' },
        ), { runIf: playModeOnly });
        app.addSystemToSchedule(Schedule.FixedPostUpdate, defineSystem(
            [],
            () => { payForDashes(world); },
            { name: 'DashStaminaPaySystem' },
        ), { runIf: playModeOnly });

        // BEFORE this frame's animator: the events are last frame's, and the
        // joints still hold the pose that posted them. Running after would ask
        // the query about a swing that has already moved on.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [EventReader(AnimatorEvent), EventWriter(Damage)],
            (
                events: Iterable<AnimatorEventPayload>,
                damage: EventWriterInstance<DamagePayload>,
            ) => {
                const queries = app.hasResource(Physics3D) ? app.getResource(Physics3D) : null;
                resolveMeleeHits(world, attacks, queries, events, damage);
                // The windows the animator reported with that pose: the swings that reach along a path.
                const windows = app.hasResource(AnimatorController) ? app.getResource(AnimatorController) : null;
                sweepMeleeWindows(world, attacks, queries, windows, damage);
            },
            { name: 'MeleeAttackSystem' },
        ), { runIf: playModeOnly });

        // The only writer of Health, and it reads a request rather than being
        // called by whatever swung.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [EventReader(Damage)],
            (blows: Iterable<DamagePayload>) => {
                const animator = app.hasResource(AnimatorController) ? app.getResource(AnimatorController) : null;
                const outcome = applyDamage(world, blows, (entity) => untouchable(world, animator, entity));
                // A broken poise is a flinch the animator plays and a swing a hunter loses.
                for (const entity of outcome.staggered) {
                    staggerHunter(world, entity);
                    if (animator && world.has(entity, Animator)) animator.setTrigger(entity, TPC_STAGGER);
                }
                // A swing that landed holds the game for its hit stop; one that was dodged does not.
                let stop = 0;
                for (const blow of outcome.landed) {
                    if (!world.valid(blow.source) || !world.has(blow.source, MeleeAttack)) continue;
                    stop = Math.max(stop, (world.get(blow.source, MeleeAttack) as MeleeAttackData).hitStop ?? 0);
                }
                if (stop > 0) this.holdFor_(app, stop);
                // A camera on whoever took a blow is thrown by it; one on whoever landed it, by half.
                let shake = 0;
                for (const camera of world.getEntitiesWithComponents([ThirdPersonCamera])) {
                    const view = world.get(camera, ThirdPersonCamera) as ThirdPersonCameraData;
                    if (!view.enabled || !(view.hitShake && view.hitShake > 0)) continue;
                    for (const blow of outcome.landed) {
                        if (blow.target === view.target) shake = Math.max(shake, view.hitShake);
                        else if (blow.source === view.target) shake = Math.max(shake, view.hitShake * 0.5);
                    }
                }
                if (shake > 0 && app.hasResource(CameraDirector)) shakeCamera(app, { amplitude: shake, rotation: 0.6, frequency: 24, duration: 0.3 });
            },
            { name: 'DamageSystem' },
        ), { runIf: playModeOnly });

        // Perception wrote what each hunter can see this frame; navigation plans
        // in Update. Deciding between the two is what makes a destination set
        // here the one planned on the same frame it was chosen.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                const animator = app.hasResource(AnimatorController)
                    ? app.getResource(AnimatorController) : null;
                huntTargets(world, animator, TPC_ATTACK, time.delta);
            },
            { name: 'HunterSystem' },
        ), { runAfter: ['PerceptionSystem'], runIf: playModeOnly });

        // Before the physics step: what the player is asking for.
        app.addSystemToSchedule(Schedule.FixedPreUpdate, defineSystem(
            [Res(Time), Res(Input)],
            (time: TimeData, input: InputState) => {
                const animator = app.hasResource(AnimatorController)
                    ? app.getResource(AnimatorController) : null;
                requestMotion(world, input, time.fixedDelta, animator);
            },
            { name: 'ThirdPersonControllerSystem' },
        ), { runIf: playModeOnly });

        // Looking is a per-frame thing (the pointer moves between steps); walking is asked of the character on the fixed clock, like the third-person layer.
        const touchLook = new TouchLook();
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Input)],
            (time: TimeData, input: InputState) => { lookFirstPerson(world, input, time.delta, touchLook); },
            { name: 'FirstPersonLookSystem' },
        ), { runIf: playModeOnly });
        app.addSystemToSchedule(Schedule.FixedPreUpdate, defineSystem(
            [Res(Time), Res(Input)],
            (time: TimeData, input: InputState) => {
                const queries = app.hasResource(Physics3D) ? app.getResource(Physics3D) : null;
                // The world's gravity in world units per second squared, for a player whose own differs from it.
                const config = app.hasResource(Physics3DRuntime) ? app.getResource(Physics3DRuntime).config : null;
                moveFirstPerson(world, input, queries, time.fixedDelta, config ? config.gravity.y * config.pixelsPerUnit : 0);
            },
            { name: 'FirstPersonControllerSystem' },
        ), { runIf: playModeOnly });
        this.offViewModels_ = installViewModels(app);

        // After it: what the world allowed. The animator hears this one.
        app.addSystemToSchedule(Schedule.FixedPostUpdate, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                const animator = app.hasResource(AnimatorController)
                    ? app.getResource(AnimatorController) : null;
                observeMotion(world, animator, time.fixedDelta);
            },
            { name: 'ThirdPersonObserveSystem' },
        ), { runIf: playModeOnly });

        // Once a frame, after everything it follows has moved.
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(Time), Res(Input)],
            (time: TimeData, input: InputState) => {
                const queries = app.hasResource(Physics3D) ? app.getResource(Physics3D) : null;
                updateCameras(world, input, queries, time.delta);
            },
            { name: 'ThirdPersonCameraSystem' },
        ), { runIf: playModeOnly });
    }

    cleanup(): void {
        // A stop left holding would leave the game frozen once this plugin is gone.
        if (this.hold_.active && this.hold_.app?.hasResource(Time)) {
            const time = this.hold_.app.getResource(Time);
            if (time.scale === 0) time.scale = this.hold_.restore;
        }
        this.hold_.active = false;
        this.hold_.app = null;
        this.offDespawn_?.();
        this.offDespawn_ = null;
        this.offViewModels_?.();
        this.offViewModels_ = null;
        lastPointer.clear();
        this.attacks_.clear();
    }
}

export const gameplayPlugin = new GameplayPlugin();
