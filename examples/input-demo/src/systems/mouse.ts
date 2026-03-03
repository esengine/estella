import {
    defineSystem, Query, Mut, Res, Input, Commands,
    Transform, Sprite, UICameraInfo,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { MouseFollower, Trail } from '../components';

const FOLLOW_SPEED = 8;

export const mouseFollowSystem = defineSystem(
    [Query(Mut(Transform), MouseFollower), Res(Input), Res(UICameraInfo)],
    (query, input, camera: UICameraData) => {
        if (!camera.valid) return;
        const worldX = camera.worldMouseX;
        const worldY = camera.worldMouseY;

        for (const [_entity, transform] of query) {
            transform.position.x += (worldX - transform.position.x) * FOLLOW_SPEED * 0.016;
            transform.position.y += (worldY - transform.position.y) * FOLLOW_SPEED * 0.016;
        }
    },
    { name: 'MouseFollowSystem' }
);

export const mouseClickSystem = defineSystem(
    [Res(Input), Res(UICameraInfo), Commands()],
    (input, camera: UICameraData, cmds) => {
        if (!camera.valid) return;

        if (input.isMouseButtonPressed(0)) {
            cmds.spawn()
                .insert(Transform, { position: { x: camera.worldMouseX, y: camera.worldMouseY, z: 0 } })
                .insert(Sprite, {
                    size: { x: 20, y: 20 },
                    color: { r: 1, g: 1, b: 0.3, a: 1 },
                    layer: 1,
                })
                .insert(Trail, { lifetime: 0.6 });
        }

        if (input.isMouseButtonPressed(2)) {
            cmds.spawn()
                .insert(Transform, { position: { x: camera.worldMouseX, y: camera.worldMouseY, z: 0 } })
                .insert(Sprite, {
                    size: { x: 16, y: 16 },
                    color: { r: 0.8, g: 0.3, b: 1, a: 1 },
                    layer: 1,
                })
                .insert(Trail, { lifetime: 1.0 });
        }
    },
    { name: 'MouseClickSystem' }
);
