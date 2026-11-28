// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Hunter.ts
 * @brief   The gameplay layer above a character that hunts: what it decides,
 *          asked of the same navigation, physics, animator and combat a player
 *          goes through.
 *
 * @details The twin of {@link ThirdPersonController}. That one turns INPUT into a
 *          request; this one turns PERCEPTION into one. Everything downstream is
 *          deliberately identical — the route is navigation's, the movement is
 *          the character controller's, the speed the animator hears is the one
 *          the world allowed, and a swing goes out as an animator trigger and
 *          comes back through the same MeleeAttack. An attacker being a program
 *          rather than a person must not change the mechanism.
 *
 *          Four states and no authoring surface: this is a concrete enemy, not a
 *          framework. The FSM and behaviour-tree runtimes are how a GAME declares
 *          its own; what needed proving first is that the chain holds at all.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import { Transform, type TransformData } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity, Vec3 } from '../types';
import { CharacterController3D, type CharacterController3DData } from '../physics3d/Physics3DComponents';
import { Perception, type PerceptionData } from '../ai/perception/components';
import { NavAgent, setNavDestination, stopNavAgent } from '../ai/nav/NavAgent';
import { Animator } from '../animation/Animator';
import type { AnimatorControllerAPI } from '../animation/Animator';
import { Health, type HealthData } from './Health';
import {
    facingYaw, turnToward, yawQuaternion, yawOfQuaternion,
    TPC_SPEED, TPC_GROUNDED,
} from './ThirdPersonController';
import { COMBAT_ATTACK_ACTIVE } from './vocabulary';
import { MeshRenderer, Sprite, Children } from '../ecs/component';
import type { Color } from '../types';

/** What a hunter is doing. Engine-written; a game reads it. @experimental */
export type HunterState = 'idle' | 'chase' | 'attack' | 'dead';

/**
 * Where a hunter's swing is: winding up (the tell a player reads), striking (the blow can land), recovering (the
 * opening a player punishes), waiting its turn while others swing, or none. Engine-written. @experimental
 */
export type HunterPhase = '' | 'windup' | 'strike' | 'recover' | 'wait';

/** The fields of the `Hunter` component. @experimental */
export interface HunterData {
    /** Ground-plane distance it closes to before it swings, world units. */
    attackRange: number;
    /** Seconds between swings. */
    attackInterval: number;
    /** How fast it turns to face, degrees per second. */
    rotationSpeed: number;
    /** Speed under which the animator is told it is standing still. */
    idleThreshold: number;
    enabled: boolean;
    /** Engine-written: one of `idle` / `chase` / `attack` / `dead`. */
    state: string;
    /** Engine-written: seconds until it may swing again. */
    cooldown: number;
    /**
     * Seconds it winds up before a swing lands, the tell a player reads and dodges by. 0 = the animation times the swing
     * (its `attack-active` window); above 0 the hunter times it itself, `strike` seconds of reach after, and needs no clip.
     */
    windup?: number;
    /** Seconds a swing it times itself can land in, once the windup is over. */
    strike?: number;
    /** Seconds it stands committed after a swing, not turning: the opening a player punishes. */
    recover?: number;
    /** The colour it flushes while winding up, `a` how far (0 = no tell of its own). Its meshes and sprites take it. */
    telegraphColor?: Color;
    /** At most this many hunters wind up or strike at the same target at once; the rest wait their turn. 0 = any number. */
    maxAttackers?: number;
    /** Engine-written: where its swing is (see HunterPhase). */
    phase?: string;
    /** Engine-written: seconds it has been in that phase. */
    phaseTime?: number;
}

/**
 * A character that hunts what it perceives: it asks navigation for a route, the
 * character controller for the movement, and the animator for a swing. Add it
 * beside `Perceiver`/`Perception`, `NavAgent`, `CharacterController3D` and an
 * `Animator` whose graph answers `attack`; damage stays `MeleeAttack`'s.
 *
 * @experimental
 */
export const Hunter: ComponentDef<HunterData> = defineComponent<HunterData>('Hunter', {
    attackRange: 110,
    attackInterval: 1.6,
    rotationSpeed: 540,
    idleThreshold: 8,
    enabled: true,
    state: 'idle',
    cooldown: 0,
    windup: 0,
    strike: 0.2,
    recover: 0.8,
    telegraphColor: { r: 1, g: 0.82, b: 0.45, a: 0 },
    maxAttackers: 0,
    phase: '',
    phaseTime: 0,
}, {
    // World lengths and speeds: written at 100 units a metre, scaled to the project (ecs/worldUnits.ts).
    worldUnitFields: ['attackRange', 'idleThreshold'],
    readonlyFields: ['state', 'cooldown', 'phase', 'phaseTime'],
    fields: {
        attackRange: { min: 0, tooltip: 'How close it gets before it swings.' },
        attackInterval: { min: 0, unit: 's' },
        rotationSpeed: { min: 0, unit: '°/s' },
        idleThreshold: { min: 0, step: 0.05, advanced: true },
        state: { advanced: true },
        cooldown: { advanced: true, unit: 's' },
        windup: { min: 0, step: 0.05, unit: 's', tooltip: 'How long it winds up before a swing lands, the tell a player dodges by. 0 = the attack animation times it.' },
        strike: { min: 0, step: 0.05, unit: 's', tooltip: 'How long a swing it times itself can land in.' },
        recover: { min: 0, step: 0.05, unit: 's', tooltip: 'How long it stands committed after a swing, not turning: the opening a player punishes.' },
        telegraphColor: { tooltip: 'The colour it flushes while winding up; alpha is how far. 0 = no tell of its own.' },
        maxAttackers: { min: 0, step: 1, tooltip: 'At most this many hunters swing at the same target at once; the rest wait their turn. 0 = any number.' },
        phase: { advanced: true },
        phaseTime: { advanced: true, unit: 's' },
    },
});

// =============================================================================
// The decision, as a pure function
// =============================================================================

/** Everything the decision depends on, so it can be made without a world. */
export interface HunterSituation {
    alive: boolean;
    visible: boolean;
    /** Distance to what it sees, IN THE GROUND PLANE — two capsules standing on
     *  the same floor are never as close as their three-axis distance says. */
    distance: number;
    attackRange: number;
}

/**
 * What a hunter should be doing. Recomputed every frame rather than latched:
 * a target that steps out of reach mid-swing has to be chased again, and a
 * state that only leaves on its own would leave it swinging at air.
 */
export function decideHunterState(s: HunterSituation): HunterState {
    if (!s.alive) return 'dead';
    if (!s.visible) return 'idle';
    return s.distance <= s.attackRange ? 'attack' : 'chase';
}

// =============================================================================
// The system
// =============================================================================

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** Stop the body. Navigation SKIPS an agent with no destination, so the velocity
 *  it last wrote would carry a hunter on walking after it stopped chasing. */
function halt(world: World, entity: Entity): void {
    if (!world.has(entity, CharacterController3D)) return;
    world.update(entity, CharacterController3D, (c: CharacterController3DData) => {
        c.velocity.x = 0;
        c.velocity.z = 0;
    });
}

/** Turn toward `wanted` at the component's rate; a zero direction holds. */
function face(world: World, entity: Entity, wanted: Vec3, degreesPerSecond: number, dt: number): void {
    if (Math.hypot(wanted.x, wanted.z) < 1e-6 || !world.has(entity, Transform)) return;
    const to = facingYaw({ x: wanted.x, y: 0, z: wanted.z });
    world.update(entity, Transform, (t: TransformData) => {
        const turned = turnToward(yawOfQuaternion(t.rotation), to, degreesPerSecond, dt);
        const yaw = yawQuaternion(turned);
        t.rotation.w = yaw.w; t.rotation.x = yaw.x; t.rotation.y = yaw.y; t.rotation.z = yaw.z;
    });
}

/** One target, as every hunter that sees it sees it this frame: where it is. */
function targetKey(sight: PerceptionData): string {
    return `${sight.targetX},${sight.targetY},${sight.targetZ}`;
}

/** Swings each hunter has begun, so every swing it times itself reaches as a swing of its own. */
const swingCounts = new WeakMap<World, Map<Entity, number>>();

/**
 * The reach of a swing @p entity times itself (`windup` above 0), while it strikes: what a clip's `attack-active`
 * window is to a hunter that has a clip. Null at any other moment, and for a hunter its animation times.
 *
 * @experimental
 */
export function hunterStrikeWindow(world: World, entity: Entity): { id: number } | null {
    if (!world.has(entity, Hunter)) return null;
    const h = world.get(entity, Hunter) as HunterData;
    if (!((h.windup ?? 0) > 0) || h.phase !== 'strike') return null;
    return { id: swingCounts.get(world)?.get(entity) ?? 1 };
}

/** The colours a telegraph replaced, by entity, to give back when the windup is over. */
const flushed = new WeakMap<World, Map<Entity, Color>>();

/** @p entity and what hangs under it, a few levels down: the meshes a character is drawn with. */
function drawnParts(world: World, entity: Entity, out: Entity[] = [], depth = 0): Entity[] {
    if (world.has(entity, MeshRenderer) || world.has(entity, Sprite)) out.push(entity);
    if (depth < 4 && world.has(entity, Children)) {
        for (const child of (world.get(entity, Children) as { entities: Entity[] }).entities) drawnParts(world, child, out, depth + 1);
    }
    return out;
}

/**
 * Flush a hunter winding up toward its `telegraphColor`, rising over the windup, and give its colours back after.
 * Exported for the tests. @internal
 */
export function telegraph(world: World, entity: Entity, data: HunterData, phase: string, phaseTime: number): void {
    const tint = data.telegraphColor;
    const strength = tint && tint.a > 0 && phase === 'windup'
        ? tint.a * ((data.windup ?? 0) > 0 ? Math.min(1, phaseTime / (data.windup ?? 1)) : 1)
        : 0;
    let saved = flushed.get(world);
    if (strength <= 0 && !saved?.size) return;
    if (!saved) { saved = new Map(); flushed.set(world, saved); }
    for (const part of drawnParts(world, entity)) {
        const component = world.has(part, MeshRenderer) ? MeshRenderer : Sprite;
        const colour = (world.get(part, component) as { color: Color }).color;
        if (strength <= 0) {
            const base = saved.get(part);
            if (!base) continue;
            world.update(part, component, (c: { color: Color }) => { c.color = { ...base }; });
            saved.delete(part);
            continue;
        }
        if (!saved.has(part)) saved.set(part, { ...colour });
        const base = saved.get(part)!;
        world.update(part, component, (c: { color: Color }) => {
            c.color = {
                r: base.r + (tint!.r - base.r) * strength,
                g: base.g + (tint!.g - base.g) * strength,
                b: base.b + (tint!.b - base.b) * strength,
                a: base.a,
            };
        });
    }
}

/**
 * A blow broke @p entity's poise: the swing it was winding up is lost, and it waits a whole `attackInterval` before
 * the next, so a player who staggers it has the opening that earned. Its animator hears `stagger` from the damage system.
 *
 * @experimental
 */
export function staggerHunter(world: World, entity: Entity): void {
    if (!world.has(entity, Hunter)) return;
    world.update(entity, Hunter, (h: HunterData) => {
        h.cooldown = Math.max(h.cooldown, h.attackInterval);
        h.phase = '';
        h.phaseTime = 0;
    });
}

/**
 * Perceive, decide, and ask — after perception, before navigation, so the
 * destination is planned the frame it was chosen. It moves nothing: where the
 * hunter ends up is the character controller's answer, and the speed the
 * animator hears is that answer. A hunter shoving a wall is not running on the spot.
 */
export function huntTargets(
    world: World, animator: AnimatorControllerAPI | null, attackTrigger: string, dt: number,
    windows: { openWindow(entity: Entity, name: string): { id: number } | null } | null = null,
): void {
    // Who is swinging at what, before anyone decides: a hunter waits its turn against what is already under way.
    const swinging = new Map<string, number>();
    for (const entity of world.getEntitiesWithComponents([Hunter, Perception])) {
        const h = world.get(entity, Hunter) as HunterData;
        if (h.phase !== 'windup' && h.phase !== 'strike') continue;
        const key = targetKey(world.get(entity, Perception) as PerceptionData);
        swinging.set(key, (swinging.get(key) ?? 0) + 1);
    }
    for (const entity of world.getEntitiesWithComponents([Hunter, Perception, Transform])) {
        const data = world.get(entity, Hunter) as HunterData;
        if (!data.enabled) continue;

        const sight = world.get(entity, Perception) as PerceptionData;
        const here = (world.get(entity, Transform) as TransformData).position;
        const alive = !world.has(entity, Health)
            || (world.get(entity, Health) as HealthData).current > 0;
        const state = decideHunterState({
            alive,
            visible: sight.visible,
            distance: Math.hypot(sight.targetX - here.x, sight.targetZ - here.z),
            attackRange: data.attackRange,
        });

        // A swing under way is committed: it does not chase a target that stepped away.
        let phase = (data.phase ?? '') as HunterPhase;
        let phaseTime = (data.phaseTime ?? 0) + dt;
        const committed = phase === 'windup' || phase === 'strike' || phase === 'recover';
        if (state === 'chase' && !committed && world.has(entity, NavAgent)) {
            setNavDestination(world, entity, {
                x: sight.targetX, y: sight.targetY, z: sight.targetZ,
            });
        } else {
            if (world.has(entity, NavAgent)) stopNavAgent(world, entity);
            halt(world, entity);
        }

        let cooldown = Math.max(0, data.cooldown - dt);
        const timed = (data.windup ?? 0) > 0;
        const next = (to: HunterPhase): void => { phase = to; phaseTime = 0; };
        // Within a hair of its time: the seconds of a phase are summed a step at a time.
        const over = (seconds: number | undefined): boolean => phaseTime >= (seconds ?? 0) - 1e-6;
        if (state === 'dead') next('');
        else if (timed) {
            // Its own clock: so long winding up, so long reaching, so long committed.
            if (phase === 'windup' && over(data.windup)) next('strike');
            else if (phase === 'strike' && over(data.strike)) next('recover');
            else if (phase === 'recover' && over(data.recover)) next('');
        } else {
            // The clip's clock: winding up until its attack-active window opens, striking while it is open.
            const open = windows?.openWindow(entity, COMBAT_ATTACK_ACTIVE) ?? null;
            if (phase === 'windup' && open) next('strike');
            else if (phase === 'windup' && cooldown <= 0) next('');
            else if (phase === 'strike' && !open) next('recover');
            else if (phase === 'recover' && over(data.recover)) next('');
        }

        if (state !== 'attack' && phase === 'wait') next('');
        if (state === 'attack' && cooldown <= 0 && (phase === '' || phase === 'wait')) {
            const key = targetKey(sight);
            const limit = data.maxAttackers ?? 0;
            const canSwing = timed || (animator !== null && world.has(entity, Animator));
            if (limit > 0 && (swinging.get(key) ?? 0) >= limit) {
                if (phase !== 'wait') next('wait');
            } else if (canSwing) {
                // The ACTION, not the clip: whether this character has a swing at all
                // is its animator graph's answer, exactly as it is for a player.
                if (animator && world.has(entity, Animator)) animator.setTrigger(entity, attackTrigger);
                cooldown = data.attackInterval;
                next('windup');
                let counts = swingCounts.get(world);
                if (!counts) { counts = new Map(); swingCounts.set(world, counts); }
                counts.set(entity, (counts.get(entity) ?? 0) + 1);
                swinging.set(key, (swinging.get(key) ?? 0) + 1);
            }
        }

        const character = world.has(entity, CharacterController3D)
            ? world.get(entity, CharacterController3D) as CharacterController3DData : null;
        const moved = character?.realVelocity ?? ZERO;
        const speed = Math.hypot(moved.x, moved.z);
        if (animator && world.has(entity, Animator)) {
            animator.setFloat(entity, TPC_SPEED,
                              state === 'dead' || speed < data.idleThreshold ? 0 : speed);
            animator.setBool(entity, TPC_GROUNDED, character?.isOnFloor ?? true);
        }

        // Where it goes while chasing, what it is fighting while attacking. The
        // two are different questions: a swing aimed down the last bit of drift
        // lands beside the target it was aimed at.
        if (state === 'chase' && speed >= data.idleThreshold) {
            face(world, entity, { x: moved.x, y: 0, z: moved.z }, data.rotationSpeed, dt);
        } else if (state === 'attack' && phase !== 'strike' && phase !== 'recover') {
            // It tracks the target while it winds up and not after: a blow that turned with the player could not be stepped round.
            face(world, entity, { x: sight.dirX, y: 0, z: sight.dirZ }, data.rotationSpeed, dt);
        }

        telegraph(world, entity, data, phase, phaseTime);
        world.update(entity, Hunter, (h: HunterData) => {
            h.state = state;
            h.cooldown = cooldown;
            h.phase = phase;
            h.phaseTime = phaseTime;
        });
    }
}
