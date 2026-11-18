// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    probe.ts
 * @brief   The game script of tools/measure-world-precision.mjs: a scene authored far from the origin, measured where it runs.
 *
 * @details Hierarchy: a child under a moving, turning parent, against the exact world position worked in doubles. Physics: a
 *          frictionless box pushed at 300 units/s, every step of which should be exactly 5, and a box dropped to rest. Navigation:
 *          a route round a wall across a baked floor, its length and corners relative to the offset.
 */
import { addSystemToSchedule, Schedule, defineSystem, GetWorld, Res, Time, Transform } from 'esengine';
import type { World, TimeData } from 'esengine';
import { Nav } from 'esengine/ai';
import { Physics3D } from 'esengine/physics3d';

type V = { x: number; y: number; z: number };
const out = {
    frame: 0,
    offset: 0,
    box: [] as V[],
    hierarchyError: [] as number[],
    route: null as null | { length: number; endError: number; points: number; corners: Array<[number, number]> },
    slider: [] as V[],
};
(globalThis as unknown as Record<string, unknown>).__precision = out;

let t = 0;
const probe = defineSystem(
    [Res(Time), Res(Nav), Res(Physics3D), GetWorld()],
    (time: TimeData, nav: { surface: object | null; findWorldPath(a: V, b: V): V[] | null },
     physics: { setLinearVelocity(e: number, v: V): boolean } | null, world: World) => {
        const floor = world.findEntityByName('Floor');
        if (floor === null) return;
        const O = (world.get(floor, Transform) as { position: V }).position.x;
        out.offset = O;
        out.frame++;
        t += time.delta;

        // The parent moves and turns; the child sits 50 units out along the parent's x.
        const arm = world.findEntityByName('Arm');
        const hand = world.findEntityByName('Hand');
        if (arm !== null && hand !== null) {
            const angle = t * 0.7;
            const px = O + 100 * Math.sin(t), py = 300, pz = O;
            // The world position the child should have, from the parent's pose of the frame before (composition reads it).
            const hw = (world.get(hand, Transform) as { worldPosition: V }).worldPosition;
            const prev = (globalThis as unknown as { __armPrev?: { px: number; angle: number } }).__armPrev;
            if (prev && out.frame > 5) {
                const ex = prev.px + 50 * Math.cos(prev.angle), ez = pz - 50 * Math.sin(prev.angle);
                out.hierarchyError.push(Math.hypot(hw.x - ex, hw.y - py, hw.z - ez));
            }
            world.update(arm, Transform, (tf) => {
                tf.position.x = px; tf.position.y = py; tf.position.z = pz;
                tf.rotation.x = 0; tf.rotation.y = Math.sin(angle / 2); tf.rotation.z = 0; tf.rotation.w = Math.cos(angle / 2);
            });
            (globalThis as unknown as { __armPrev?: { px: number; angle: number } }).__armPrev = { px, angle };
        }

        // The slider is pushed along x at 300 units/s: each step should move it exactly 5.
        const slider = world.findEntityByName('Slider');
        if (slider !== null && physics) {
            physics.setLinearVelocity(slider, { x: 300, y: 0, z: 0 });
            if (out.frame > 60 && out.frame < 300) out.slider.push({ ...(world.get(slider, Transform) as { position: V }).position });
        }
        const box = world.findEntityByName('Box');
        if (box !== null && out.frame > 120) out.box.push({ ...(world.get(box, Transform) as { position: V }).position });

        if (!out.route && nav.surface) {
            const from = { x: O - 500, y: 0, z: O }, to = { x: O + 500, y: 0, z: O };
            const path = nav.findWorldPath(from, to);
            if (path) {
                let length = 0;
                for (let i = 1; i < path.length; i++) length += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
                const end = path[path.length - 1]!;
                out.route = { length, endError: Math.hypot(end.x - to.x, end.z - to.z), points: path.length,
                    corners: path.map((q) => [q.x - O, q.z - O] as [number, number]) };
            }
        }
    },
    { name: 'PrecisionProbe' },
);
addSystemToSchedule(Schedule.Update, probe);
