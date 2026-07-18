import {
    defineSystem, Query, Res, Input, UICameraInfo,
    Transform, RigidBody, BodyType,
} from 'esengine';
import type { UICameraData, RigidBodyData, TransformData } from 'esengine';
import { Physics, MotorJoint } from 'esengine/physics';
import type { PhysicsAPI } from 'esengine/physics';

const DRAG_BUTTON = 0;
const PICK_RADIUS = 6; // world px around the cursor to grab a body

// Click-and-drag any dynamic body with a mouse joint: pick on press, follow the
// cursor while held, release on up. Only one drag is live at a time.
export const dragSystem = defineSystem(
    [Res(Input), Res(UICameraInfo), Res(Physics), Query(RigidBody)],
    (input, camera: UICameraData, physics: PhysicsAPI, bodies) => {
        if (!camera.valid) return;
        const target = { x: camera.worldMouseX, y: camera.worldMouseY };

        if (input.isMouseButtonPressed(DRAG_BUTTON) && !physics.hasMouseJoint()) {
            const dynamic = new Set<number>();
            for (const [entity, rb] of bodies as Iterable<[number, RigidBodyData]>) {
                if (rb.bodyType === BodyType.Dynamic) dynamic.add(entity);
            }
            const hit = physics.overlapCircle(target, PICK_RADIUS).find((e) => dynamic.has(e));
            if (hit !== undefined) physics.createMouseJoint(hit, target);
        } else if (input.isMouseButtonDown(DRAG_BUTTON)) {
            if (physics.hasMouseJoint()) physics.setMouseTarget(target);
        } else if (physics.hasMouseJoint()) {
            physics.destroyMouseJoint();
        }
    },
    { name: 'DragSystem' }
);

// The motor-driven shuttle sweeps back and forth: flip its motor velocity at the
// travel bounds. Reverses once per edge (tracked per entity).
const SHUTTLE_SPEED = 180; // world px/s
const SHUTTLE_MIN_X = 20;
const SHUTTLE_MAX_X = 290;
const shuttleDir = new Map<number, number>();

export const shuttleSystem = defineSystem(
    [Res(Physics), Query(Transform, MotorJoint)],
    (physics: PhysicsAPI, shuttles) => {
        for (const [entity, transform] of shuttles as Iterable<[number, TransformData]>) {
            let dir = shuttleDir.get(entity) ?? 1;
            if (transform.position.x > SHUTTLE_MAX_X && dir > 0) {
                dir = -1;
                physics.setMotorJointLinearVelocity(entity, { x: -SHUTTLE_SPEED, y: 0 });
            } else if (transform.position.x < SHUTTLE_MIN_X && dir < 0) {
                dir = 1;
                physics.setMotorJointLinearVelocity(entity, { x: SHUTTLE_SPEED, y: 0 });
            }
            shuttleDir.set(entity, dir);
        }
    },
    { name: 'ShuttleSystem' }
);
