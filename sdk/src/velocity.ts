// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    velocity.ts
 * @brief   Velocity concept — integrates the builtin Velocity component into Transform.
 */
import type { Plugin } from './app/app';
import { defineSystem, Schedule, GetWorld } from './ecs/system';
import { Query, Mut } from './ecs/query';
import { Res, Time, type TimeData } from './ecs/resource';
import { playModeOnly } from './ecs/env';
import { Transform, Velocity, getComponentRegistry } from './ecs/component';
import type { TransformData, VelocityData } from './ecs/component';
import type { Entity } from './types';
import type { World } from './ecs/world';
import { BodyType } from './wasm/wasm.generated';

export const velocitySystem = defineSystem(
    [Query(Mut(Transform), Velocity), Res(Time), GetWorld()],
    (
        query: Iterable<[Entity, TransformData, VelocityData]>,
        time: TimeData,
        world: World,
    ) => {
        const dt = time.delta;
        if (dt <= 0) return;
        // A dynamic body is the solver's: it writes the pose back each step, undoing a move made here. A static or
        // kinematic body follows its Transform, so Velocity moving it is how a platform moves. Resolved by name: no
        // registry entry means that physics module was never loaded.
        const registry = getComponentRegistry();
        const bodies = [registry.get('RigidBody2D'), registry.get('RigidBody3D')].filter((def) => def !== undefined);
        const solverOwned = (entity: Entity): boolean => bodies.some((def) => {
            if (!world.has(entity, def)) return false;
            const body = world.get(entity, def) as { bodyType?: number; enabled?: boolean };
            return body.bodyType === BodyType.Dynamic && body.enabled !== false;
        });
        for (const [entity, transform, velocity] of query) {
            if (bodies.length > 0 && solverOwned(entity)) continue;

            const lin = velocity.linear;
            if (lin.x !== 0 || lin.y !== 0 || lin.z !== 0) {
                const p = transform.position;
                transform.position = {
                    x: p.x + lin.x * dt,
                    y: p.y + lin.y * dt,
                    z: p.z + lin.z * dt,
                };
            }

            const ang = velocity.angular;
            if (ang.x !== 0 || ang.y !== 0 || ang.z !== 0) {
                // Exponential map: rotate by |ω|·dt around ω̂ in the world frame —
                // exact for constant angular velocity at any step size (no drift
                // to renormalize away).
                const q = transform.rotation;
                const mag = Math.hypot(ang.x, ang.y, ang.z);
                const half = mag * dt * 0.5;
                const s = Math.sin(half) / mag;
                const dw = Math.cos(half), dx = ang.x * s, dy = ang.y * s, dz = ang.z * s;
                transform.rotation = {
                    w: dw * q.w - dx * q.x - dy * q.y - dz * q.z,
                    x: dw * q.x + dx * q.w + dy * q.z - dz * q.y,
                    y: dw * q.y - dx * q.z + dy * q.w + dz * q.x,
                    z: dw * q.z + dx * q.y - dy * q.x + dz * q.w,
                };
            }
        }
    },
    {
        name: 'VelocitySystem',
        // The World is here for one question — is this entity a dynamic physics
        // body — and the bodies cannot be named as query filters because their
        // physics modules may never have registered them.
        touches: { reads: ['RigidBody2D', 'RigidBody3D'] },
    }
);

export const velocityPlugin: Plugin = {
    name: 'Velocity',
    // One query over Velocity: with none in the scene, skipped rather than walked.
    activeWhen: [Velocity],
    profileDomain: 'velocity',
    build(app) {
        app.addSystemToSchedule(Schedule.Update, velocitySystem, { runIf: playModeOnly });
    },
};
