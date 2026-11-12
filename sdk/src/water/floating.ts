// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    floating.ts
 * @brief   A body that floats: the water holds it up and carries it along, through forces on its rigid body.
 *
 * @details `Floating` goes on an entity that has a `RigidBody3D` (and a collider), and the forces come from asking the water's surface
 *          ({@link Waters.sample}) where it is under a few points of the body. It touches nothing a renderer owns: the surface is the
 *          CPU's own, so a server, a test or a build that draws nothing floats things the same.
 *
 *          At each sample point the share of it under water (`wet`: 0 at the surface, 1 from `radius` down) gives
 *            - a buoyant force against gravity of `mass * g * buoyancy * wet / points` (so `buoyancy` is the ratio of the water's density
 *              to the body's, and a body of 2 floats half under), applied AT the point so waves tip it and a body weighted to one side
 *              leans; and
 *            - a drag of `mass * drag * wet / points` against the point's velocity relative to the water, which is what brings it to
 *              rest in still water and carries it along with a river's current.
 *          The forces are applied each fixed step, before the world is stepped, and Jolt keeps them for that step only.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineComponent, Transform, type ComponentDef } from '../ecs/component';
import { Physics3DRuntime } from '../physics3d/Physics3DPlugin';
import { RigidBody3D } from '../physics3d/Physics3DComponents';
import { log } from '../util/logger';
import type { Entity } from '../types';
import { WatersRes, type WaterSample } from './waterPlugin';

/** A point in space. */
export interface Vec3Like { x: number; y: number; z: number }

/** The fields of the `Floating` component. @experimental */
export interface FloatingData {
    /** The water's density against the body's: 1 holds it up exactly when it is wholly under, 2 floats it half under. */
    buoyancy: number;
    /** How hard the water resists the body moving through it (a rate, per second). */
    drag: number;
    /** How deep, in world units, a sample point has to be under the surface to be wholly wet. */
    radius: number;
    /** The points of the body, in its own space and world units, the water is asked about. Empty is the one at its origin. */
    points: Vec3Like[];
    /** How much of a ripple the body makes in a body of water that keeps ripples: a multiplier, 0 for none. */
    wake: number;
}

/**
 * A body the water holds up. It needs a `RigidBody3D`; presence is the opt-in.
 *
 * @experimental
 */
export const Floating: ComponentDef<FloatingData> = defineComponent<FloatingData>('Floating', {
    buoyancy: 2, drag: 1, radius: 50, points: [] as Vec3Like[], wake: 1,
}, {
    worldUnitFields: ['radius'],
    fields: {
        buoyancy: { min: 0, max: 20, category: 'Water', tooltip: 'The water\'s density against the body\'s. 1 holds it up exactly when it is wholly under; 2 floats it half under.' },
        drag: { min: 0, max: 20, category: 'Water', tooltip: 'How hard the water resists the body moving through it, per second.' },
        radius: { min: 0.01, category: 'Water', tooltip: 'How deep under the surface, in world units, a point of the body is wholly wet.' },
        points: { category: 'Water', tooltip: 'Points of the body, in its own space, the water is asked about: spread them (the corners of a hull) and waves tip it. Empty is the one at its origin.' },
        wake: { min: 0, max: 10, category: 'Water', tooltip: 'How much of a ripple the body makes in water that keeps ripples (WaterZone Ripples). 0 makes none.' },
    },
});

/** What the water does to one point of a body. */
export interface FloatingForce {
    /** The force in newtons, world space. */
    force: [number, number, number];
    /** Where it acts, in physics units (metres). */
    point: [number, number, number];
}

/** The state a force is worked out from, in physics units (metres, kilograms, seconds), world space. */
export interface FloatingBody {
    position: [number, number, number];
    velocity: [number, number, number];
    angularVelocity: [number, number, number];
    mass: number;
}

/** The longest a step's drag may be a share of the relative velocity: past 1 it would reverse it, and the step would blow up. */
const MAX_DRAG_PER_STEP = 0.9;

/**
 * The force on one point of a floating body, or null where it is dry. `gravity` is the world's, in metres a second squared; `ppu` is how many world
 * units a metre is; `dt` the fixed step. `sample` is what the water says at the point (world units).
 */
export function floatingForce(
    body: FloatingBody, point: [number, number, number], sample: WaterSample | null, floating: FloatingData,
    gravity: [number, number, number], ppu: number, dt: number, points: number,
): FloatingForce | null {
    if (!sample) return null;
    const wet = Math.min(Math.max(-sample.depth / Math.max(floating.radius, 1e-6), 0), 1);
    if (wet <= 0) return null;
    const g = Math.hypot(gravity[0], gravity[1], gravity[2]);
    if (g <= 0) return null;
    const share = body.mass * wet / points;
    // Against gravity, by as much as the body would weigh at this point's share, times how much denser the water is.
    const lift = share * g * floating.buoyancy;
    const up: [number, number, number] = [-gravity[0] / g, -gravity[1] / g, -gravity[2] / g];
    // The velocity of the point itself: the body's, and what its turning adds at that distance from it.
    const r: [number, number, number] = [point[0] - body.position[0], point[1] - body.position[1], point[2] - body.position[2]];
    const w = body.angularVelocity;
    const atPoint: [number, number, number] = [
        body.velocity[0] + (w[1] * r[2] - w[2] * r[1]),
        body.velocity[1] + (w[2] * r[0] - w[0] * r[2]),
        body.velocity[2] + (w[0] * r[1] - w[1] * r[0]),
    ];
    const relative: [number, number, number] = [
        atPoint[0] - sample.flow[0] / ppu, atPoint[1] - sample.flow[1] / ppu, atPoint[2] - sample.flow[2] / ppu,
    ];
    const rate = Math.min(floating.drag, MAX_DRAG_PER_STEP / Math.max(dt, 1e-6));
    return {
        force: [up[0] * lift - share * rate * relative[0], up[1] * lift - share * rate * relative[1], up[2] * lift - share * rate * relative[2]],
        point,
    };
}

/** How much of a wake, in world units of water height, a step of a point's motion through the surface makes per unit of the multiplier. */
const WAKE_PER_SPEED = 0.08;

/**
 * The bump a point at the surface puts into ripples this step, in world units (negative is a dip), or 0 where it is not touching the surface.
 * `velocity` is the point's velocity relative to the water in world units a second; what goes down into the water pushes it down, and moving along it drags a trough.
 */
export function wakeStrength(sample: WaterSample | null, velocity: [number, number, number], floating: FloatingData, dt: number): number {
    if (!sample || floating.wake <= 0) return 0;
    if (Math.abs(sample.depth) > Math.max(floating.radius, 1e-6)) return 0;
    const n = sample.normal;
    const along = velocity[0] * n[0] + velocity[1] * n[1] + velocity[2] * n[2];
    const sideways = Math.hypot(velocity[0] - along * n[0], velocity[1] - along * n[1], velocity[2] - along * n[2]);
    const push = (along - 0.2 * sideways) * dt * WAKE_PER_SPEED * floating.wake;
    const cap = floating.radius * 0.2;
    return Math.min(Math.max(push, -cap), cap);
}

/** Rotates `v` by the unit quaternion `q`. */
function rotate(q: { x: number; y: number; z: number; w: number }, v: Vec3Like): [number, number, number] {
    const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
    return [v.x + q.w * tx + (q.y * tz - q.z * ty), v.y + q.w * ty + (q.z * tx - q.x * tz), v.z + q.w * tz + (q.x * ty - q.y * tx)];
}

let warned = false;

/** Installs the system that floats bodies: every fixed step, before the world steps, one force at each sample point of each `Floating` body. */
export function installFloating(app: App): void {
    app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => {
        if (!app.hasResource(Physics3DRuntime) || !app.hasResource(WatersRes)) return;
        const runtime = app.getResource(Physics3DRuntime);
        const module = runtime.module, config = runtime.config;
        if (!module || !config) return;
        if (!module._physics3d_addForce || !module._physics3d_getBodyDynamics) {
            if (!warned) { warned = true; log.warn('water', 'this 3D physics build has no force API: nothing will float'); }
            return;
        }
        const waters = app.getResource(WatersRes);
        const ppu = config.pixelsPerUnit;
        const gravity: [number, number, number] = [config.gravity.x, config.gravity.y, config.gravity.z];
        for (const entity of app.world.getEntitiesWithComponents([Floating, RigidBody3D, Transform])) {
            const id = runtime.bodies.get(entity as Entity);
            if (!id) continue;
            const floating = app.world.get(entity, Floating) as FloatingData;
            if (!module._physics3d_getBodyState(id)) continue;
            const base = module._physics3d_queryResult() >> 2;
            const f = module.HEAPF32;
            const state = {
                position: [f[base]!, f[base + 1]!, f[base + 2]!] as [number, number, number],
                rotation: { x: f[base + 3]!, y: f[base + 4]!, z: f[base + 5]!, w: f[base + 6]! },
                velocity: [f[base + 7]!, f[base + 8]!, f[base + 9]!] as [number, number, number],
            };
            if (!module._physics3d_getBodyDynamics(id)) continue;
            const dynamics = module._physics3d_queryResult() >> 2;
            const body: FloatingBody = {
                position: state.position, velocity: state.velocity, mass: f[dynamics]!,
                angularVelocity: [f[dynamics + 1]!, f[dynamics + 2]!, f[dynamics + 3]!],
            };
            const offsets = floating.points.length > 0 ? floating.points : [{ x: 0, y: 0, z: 0 }];
            for (const offset of offsets) {
                // The point in the world (world units), then the water's answer for it, then the force in metres and newtons.
                const turned = rotate(state.rotation, offset);
                const world: [number, number, number] = [state.position[0] * ppu + turned[0], state.position[1] * ppu + turned[1], state.position[2] * ppu + turned[2]];
                const sample = waters.sample(world[0], world[1], world[2]);
                const result = floatingForce(body, [world[0] / ppu, world[1] / ppu, world[2] / ppu], sample, floating, gravity, ppu, config.fixedTimestep, offsets.length);
                if (result) module._physics3d_addForce(id, result.force[0], result.force[1], result.force[2], result.point[0], result.point[1], result.point[2]);
                if (sample && floating.wake > 0) {
                    const relative: [number, number, number] = [
                        body.velocity[0] * ppu - sample.flow[0], body.velocity[1] * ppu - sample.flow[1], body.velocity[2] * ppu - sample.flow[2],
                    ];
                    const push = wakeStrength(sample, relative, floating, config.fixedTimestep);
                    if (push !== 0) waters.disturb(world[0], world[1], world[2], floating.radius, push);
                }
            }
        }
    }, { name: 'FloatingSystem' }));
}

/** The plugin that floats bodies, for a build that has water. */
export class FloatingPlugin implements Plugin {
    name = 'floating';
    build(app: App): void { installFloating(app); }
}
