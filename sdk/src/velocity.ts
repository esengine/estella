// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    velocity.ts
 * @brief   Velocity concept — integrates the builtin Velocity component into Transform.
 */
import type { Plugin } from './app';
import { defineSystem, Schedule, GetWorld } from './system';
import { Query, Mut } from './query';
import { Res, Time, type TimeData } from './resource';
import { playModeOnly } from './env';
import { Transform, Velocity, getComponentRegistry } from './component';
import type { TransformData, VelocityData } from './component';
import type { Entity } from './types';
import type { World } from './world';

export const velocitySystem = defineSystem(
    [Query(Mut(Transform), Velocity), Res(Time), GetWorld()],
    (
        query: Iterable<[Entity, TransformData, VelocityData]>,
        time: TimeData,
        world: World,
    ) => {
        const dt = time.delta;
        if (dt <= 0) return;
        // Physics-owned bodies get their transform from the solver; integrating
        // Velocity on top would double-move them. RigidBody lives in the physics
        // subpath, so it is resolved by name — absent registry entry means the
        // physics module was never loaded and no entity can carry it.
        const rigidBody = getComponentRegistry().get('RigidBody');
        for (const [entity, transform, velocity] of query) {
            if (rigidBody && world.has(entity, rigidBody)) continue;

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
    { name: 'VelocitySystem' }
);

export const velocityPlugin: Plugin = {
    name: 'Velocity',
    build(app) {
        app.addSystemToSchedule(Schedule.Update, velocitySystem, { runIf: playModeOnly });
    },
};
