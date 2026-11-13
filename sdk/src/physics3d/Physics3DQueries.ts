// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DQueries.ts
 * @brief   Asking the 3D world what is where, in the units a scene is authored in.
 * @details Every distance crosses in metres and comes back in world units, the
 *          same contract the step follows — a query answering in the solver's
 *          units would be a second set of numbers for a caller to remember.
 */
import { reportContact } from '../breakable/breakable';
import type { Entity } from '../types';
import type { Physics3DWasmModule } from './Physics3DModule';

/** Where a cast met something, in world units. */
export interface Cast3DHit {
    entity: Entity;
    /** How far along the cast, 0..1. */
    fraction: number;
    x: number;
    y: number;
    z: number;
    normalX: number;
    normalY: number;
    normalZ: number;
}

/** One body an overlap test found, and a point where it touches. */
export interface Overlap3DHit {
    entity: Entity;
    x: number;
    y: number;
    z: number;
}

/**
 * The 3D world's spatial queries.
 *
 * A layer mask of 0 means every layer: a caller that did not ask to filter is
 * asking for everything, and answering "nothing" there would be a silent empty
 * result for the commonest call.
 */
export class Physics3DQueries {
    constructor(private readonly module_: Physics3DWasmModule,
                private readonly ppu_: number,
                private readonly characters_: ReadonlyMap<Entity, number> = new Map(),
                private readonly bodies_: ReadonlyMap<Entity, number> = new Map(),
                private readonly world_: { gravity: { x: number; y: number; z: number } } = { gravity: { x: 0, y: -9.81, z: 0 } }) {}

    // ── Pushing bodies ────────────────────────────────────────────────────────
    // Lengths and speeds are world units, as Transform's; masses kilograms; angles radians. A force is kilograms by
    // world units a second squared, an impulse kilograms by world units a second, so a 2 kg body given an impulse of
    // 200 gains 100 world units a second. A body that does not move takes none of it. Each answers false for an
    // entity the world has no body for yet - which is also true for the frame an entity is spawned in.

    /**
     * Push a body over the next step. At `at`, a world point, it also turns it; without one it pushes at its centre of
     * mass. A force lasts one step: a steady push is given again each fixed step (a system in Schedule.FixedUpdate).
     */
    applyForce(entity: Entity, force: { x: number; y: number; z: number }, at?: { x: number; y: number; z: number }): boolean {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_addForce) return false;
        const p = this.ppu_;
        this.module_._physics3d_addForce(id, force.x / p, force.y / p, force.z / p, ...this.pointOf_(at));
        return true;
    }

    /** Strike a body, all at once: its velocity changes by impulse / mass. At `at` it also turns it. Wakes it. */
    applyImpulse(entity: Entity, impulse: { x: number; y: number; z: number }, at?: { x: number; y: number; z: number }): boolean {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_addImpulse) return false;
        const p = this.ppu_;
        this.module_._physics3d_addImpulse(id, impulse.x / p, impulse.y / p, impulse.z / p, ...this.pointOf_(at));
        return true;
    }

    /** Twist a body over the next step, about each world axis: kilograms by world units squared a second squared. */
    applyTorque(entity: Entity, torque: { x: number; y: number; z: number }): boolean {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_addTorque) return false;
        const p2 = this.ppu_ * this.ppu_;
        this.module_._physics3d_addTorque(id, torque.x / p2, torque.y / p2, torque.z / p2);
        return true;
    }

    /** Twist a body all at once: kilograms by world units squared a second. */
    applyAngularImpulse(entity: Entity, impulse: { x: number; y: number; z: number }): boolean {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_addAngularImpulse) return false;
        const p2 = this.ppu_ * this.ppu_;
        this.module_._physics3d_addAngularImpulse(id, impulse.x / p2, impulse.y / p2, impulse.z / p2);
        return true;
    }

    /** How fast it is going, in world units a second; null for an entity with no body. */
    getLinearVelocity(entity: Entity): { x: number; y: number; z: number } | null {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_getBodyState(id)) return null;
        const f32 = this.module_.HEAPF32, o = this.module_._physics3d_queryResult() >> 2, p = this.ppu_;
        return { x: f32[o + 7]! * p, y: f32[o + 8]! * p, z: f32[o + 9]! * p };
    }

    /** How fast it turns, in radians a second about each world axis; null for a body that does not move. */
    getAngularVelocity(entity: Entity): { x: number; y: number; z: number } | null {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_getBodyDynamics?.(id)) return null;
        const f32 = this.module_.HEAPF32, o = this.module_._physics3d_queryResult() >> 2;
        return { x: f32[o + 1]!, y: f32[o + 2]!, z: f32[o + 3]! };
    }

    /** Set how fast it turns, in radians a second about each world axis. Wakes it. */
    setAngularVelocity(entity: Entity, velocity: { x: number; y: number; z: number }): boolean {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_setAngularVelocity) return false;
        this.module_._physics3d_setAngularVelocity(id, velocity.x, velocity.y, velocity.z);
        return true;
    }

    /** Its mass in kilograms; null for a body that does not move, which has none. */
    getMass(entity: Entity): number | null {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_getBodyDynamics?.(id)) return null;
        return this.module_.HEAPF32[this.module_._physics3d_queryResult() >> 2]!;
    }

    /** Wake a sleeping body, or put one to sleep until something touches it. */
    setAwake(entity: Entity, awake: boolean): boolean {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_setAwake) return false;
        this.module_._physics3d_setAwake(id, awake ? 1 : 0);
        return true;
    }

    /** Whether it is awake: false for one asleep, one that does not move, or an entity with no body. */
    isAwake(entity: Entity): boolean {
        const id = this.bodies_.get(entity);
        return id !== undefined && (this.module_._physics3d_isAwake?.(id) ?? 0) === 1;
    }

    /**
     * The world's gravity, in metres a second squared as the project's physics settings give it (y -9.81 is Earth's).
     * A body asleep when it changes stays where it is until something wakes it.
     */
    setGravity(gravity: { x: number; y: number; z: number }): boolean {
        if (!this.module_._physics3d_setGravity) return false;
        this.module_._physics3d_setGravity(gravity.x, gravity.y, gravity.z);
        this.world_.gravity = { ...gravity };
        return true;
    }

    getGravity(): { x: number; y: number; z: number } {
        return { ...this.world_.gravity };
    }

    /**
     * A blast at `centre`: every moving body within `radius` is struck away from it with `impulse` at the centre,
     * less the further it is, to none at the edge; `upward` (0..1) tips the push toward the sky, as a blast on the
     * ground throws things up. Whatever can break and is caught in it is struck as hard, so a Breakable with a
     * breakImpulse that the blast reaches at least that hard breaks, standing or not. Answers how many bodies it moved.
     */
    explode(centre: { x: number; y: number; z: number }, radius: number, impulse: number,
            options: { upward?: number; layers?: number } = {}): number {
        if (!(radius > 0) || !(impulse > 0)) return 0;
        const upward = Math.max(0, Math.min(1, options.upward ?? 0));
        const seen = new Set<Entity>();
        let moved = 0;
        for (const hit of this.overlapSphere(centre, radius, options.layers ?? 0)) {
            if (seen.has(hit.entity)) continue;
            seen.add(hit.entity);
            const at = this.bodyPosition_(hit.entity) ?? { x: hit.x, y: hit.y, z: hit.z };
            let [x, y, z] = [at.x - centre.x, at.y - centre.y, at.z - centre.z];
            const far = Math.hypot(x, y, z);
            const share = Math.max(0, 1 - far / radius);
            if (share <= 0) continue;
            [x, y, z] = far > 1e-6 ? [x / far, y / far, z / far] : [0, 1, 0];
            y += upward;
            const long = Math.hypot(x, y, z) || 1;
            const blow = impulse * share;
            reportContact(hit.entity, hit.entity, blow, at);
            if (this.getMass(hit.entity) !== null
                && this.applyImpulse(hit.entity, { x: (x / long) * blow, y: (y / long) * blow, z: (z / long) * blow })) moved++;
        }
        return moved;
    }

    private bodyPosition_(entity: Entity): { x: number; y: number; z: number } | null {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_getBodyState(id)) return null;
        const f32 = this.module_.HEAPF32, o = this.module_._physics3d_queryResult() >> 2, p = this.ppu_;
        return { x: f32[o]! * p, y: f32[o + 1]! * p, z: f32[o + 2]! * p };
    }

    /** A world point in metres, or not-a-number for the centre of mass. */
    private pointOf_(at?: { x: number; y: number; z: number }): [number, number, number] {
        if (!at) return [NaN, NaN, NaN];
        const p = this.ppu_;
        return [at.x / p, at.y / p, at.z / p];
    }

    /**
     * Send a body off at a velocity, in world units a second: a blast, a kick, a piece of something that broke. What
     * the solver does with it after that is the solver's. Answers false for an entity the world has no body for,
     * which is also true for one frame after a body's entity is spawned: the world makes the body on its next step.
     */
    setLinearVelocity(entity: Entity, velocity: { x: number; y: number; z: number }): boolean {
        const id = this.bodies_.get(entity);
        if (id === undefined) return false;
        const p = this.ppu_;
        this.module_._physics3d_setLinearVelocity(id, velocity.x / p, velocity.y / p, velocity.z / p);
        return true;
    }

    /** Whether the world has a body for this entity yet. */
    hasBody(entity: Entity): boolean {
        return this.bodies_.has(entity);
    }

    /**
     * Put a character somewhere, rather than moving it there. Its position is an
     * OUTPUT — the step writes it into `Transform` every frame — so this is the
     * only way to say it, and the velocity is dropped with the move.
     *
     * Answers false for an entity the world has no character for.
     */
    teleportCharacter(entity: Entity, position: { x: number; y: number; z: number }): boolean {
        const id = this.characters_.get(entity);
        if (id === undefined) return false;
        const p = this.ppu_;
        this.module_._physics3d_setCharacterPosition(
            id, position.x / p, position.y / p, position.z / p);
        return true;
    }

    /**
     * The nearest body along a ray, or null. `direction` carries its length.
     *
     * Characters (CharacterController3D) are passed through unless `options.characters` asks for them: line of sight and
     * a camera's boom ask about the world, a shot asks about who is in the way. A ray that starts inside a character
     * meets it at once, so a shooter leaves its own out by its layer.
     */
    raycast(origin: { x: number; y: number; z: number },
            direction: { x: number; y: number; z: number },
            layerMask = 0, options?: { characters?: boolean }): Cast3DHit | null {
        const p = this.ppu_;
        const args = [origin.x / p, origin.y / p, origin.z / p,
            direction.x / p, direction.y / p, direction.z / p, layerMask] as const;
        const hit = options?.characters
            ? this.module_._physics3d_raycastWith(...args, 1)
            : this.module_._physics3d_raycast(...args);
        return hit ? this.readCast_() : null;
    }

    /**
     * Sweeps a sphere along `direction` and returns the first body it meets.
     *
     * What a ray cannot answer: a ray is infinitely thin, so it passes through
     * the very gaps a moving body would not fit — "can this thing get there" is
     * a different question from "is anything on this line".
     */
    sphereCast(origin: { x: number; y: number; z: number }, radius: number,
               direction: { x: number; y: number; z: number },
               layerMask = 0): Cast3DHit | null {
        const p = this.ppu_;
        const hit = this.module_._physics3d_sphereCast(
            origin.x / p, origin.y / p, origin.z / p, radius / p,
            direction.x / p, direction.y / p, direction.z / p, layerMask);
        return hit ? this.readCast_() : null;
    }

    /**
     * The first body a box would meet, swept from `origin` along `direction` (which carries the distance), turned by
     * `rotation` or not at all: whether a crate fits through a door, what a sliding block would strike.
     */
    boxCast(origin: { x: number; y: number; z: number }, halfExtents: { x: number; y: number; z: number },
            direction: { x: number; y: number; z: number }, layerMask = 0,
            rotation: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 1 }): Cast3DHit | null {
        if (!this.module_._physics3d_boxCast) return null;
        const p = this.ppu_;
        const hit = this.module_._physics3d_boxCast(origin.x / p, origin.y / p, origin.z / p,
            halfExtents.x / p, halfExtents.y / p, halfExtents.z / p, rotation.x, rotation.y, rotation.z, rotation.w,
            direction.x / p, direction.y / p, direction.z / p, layerMask);
        return hit ? this.readCast_() : null;
    }

    /**
     * The first body an upright capsule would meet - `halfHeight` is half the straight part between its round ends,
     * along its own y as a character stands - swept from `origin` along `direction`: where a body that walks could
     * go, before it goes.
     */
    capsuleCast(origin: { x: number; y: number; z: number }, radius: number, halfHeight: number,
                direction: { x: number; y: number; z: number }, layerMask = 0,
                rotation: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 1 }): Cast3DHit | null {
        if (!this.module_._physics3d_capsuleCast) return null;
        const p = this.ppu_;
        const hit = this.module_._physics3d_capsuleCast(origin.x / p, origin.y / p, origin.z / p, radius / p, halfHeight / p,
            rotation.x, rotation.y, rotation.z, rotation.w, direction.x / p, direction.y / p, direction.z / p, layerMask);
        return hit ? this.readCast_() : null;
    }

    /**
     * What it weighs and how it turns: mass in kilograms, its centre of mass in the world, and how hard it is to turn
     * about each of its own axes, in kilograms by world units squared - its moments of inertia where those are its
     * principal axes, as a box's or a ball's are; Infinity about an axis it may not turn on. null for a body that does
     * not move.
     */
    getMassData(entity: Entity): { mass: number; centre: { x: number; y: number; z: number }; inertia: { x: number; y: number; z: number } } | null {
        const id = this.bodies_.get(entity);
        if (id === undefined || !this.module_._physics3d_getBodyMassData?.(id)) return null;
        const f32 = this.module_.HEAPF32, o = this.module_._physics3d_queryResult() >> 2, p = this.ppu_, p2 = p * p;
        return {
            mass: f32[o]!,
            centre: { x: f32[o + 1]! * p, y: f32[o + 2]! * p, z: f32[o + 3]! * p },
            inertia: { x: f32[o + 4]! * p2, y: f32[o + 5]! * p2, z: f32[o + 6]! * p2 },
        };
    }

    /** Every body overlapping a sphere — what a spawn point asks before it spawns. */
    overlapSphere(centre: { x: number; y: number; z: number }, radius: number,
                  layerMask = 0): Overlap3DHit[] {
        const p = this.ppu_;
        const count = this.module_._physics3d_overlapSphere(
            centre.x / p, centre.y / p, centre.z / p, radius / p, layerMask);
        return this.readOverlaps_(count);
    }

    /** The same for a box, given its half-extents. */
    overlapBox(centre: { x: number; y: number; z: number },
               halfExtents: { x: number; y: number; z: number },
               layerMask = 0): Overlap3DHit[] {
        const p = this.ppu_;
        const count = this.module_._physics3d_overlapBox(
            centre.x / p, centre.y / p, centre.z / p,
            halfExtents.x / p, halfExtents.y / p, halfExtents.z / p, layerMask);
        return this.readOverlaps_(count);
    }

    private readCast_(): Cast3DHit {
        const f32 = this.module_.HEAPF32;
        const o = this.module_._physics3d_queryResult() >> 2;
        const p = this.ppu_;
        return {
            entity: f32[o] as Entity,
            fraction: f32[o + 1]!,
            x: f32[o + 2]! * p, y: f32[o + 3]! * p, z: f32[o + 4]! * p,
            // A normal is a direction, so it is NOT scaled: multiplying it would
            // leave a unit vector 100 units long.
            normalX: f32[o + 5]!, normalY: f32[o + 6]!, normalZ: f32[o + 7]!,
        };
    }

    private readOverlaps_(count: number): Overlap3DHit[] {
        if (count <= 0) return [];
        const f32 = this.module_.HEAPF32;
        const base = this.module_._physics3d_queryResult() >> 2;
        const p = this.ppu_;
        const out: Overlap3DHit[] = [];
        for (let i = 0; i < count; i++) {
            const o = base + i * 4;
            out.push({
                entity: f32[o] as Entity,
                x: f32[o + 1]! * p, y: f32[o + 2]! * p, z: f32[o + 3]! * p,
            });
        }
        return out;
    }
}
