import {
    defineSystem, Query, Mut, Res, Transform, UICameraInfo,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { Torch } from '../components';

// Pin the torch entity (a Point light + a small bright marker sprite) to the
// world-space mouse position. UICameraInfo already projects the cursor through
// the active camera, so no manual screen→world math is needed.
export const torchSystem = defineSystem(
    [Query(Mut(Transform), Torch), Res(UICameraInfo)],
    (torches, camera: UICameraData) => {
        if (!camera.valid) return;
        for (const [, transform] of torches) {
            transform.position.x = camera.worldMouseX;
            transform.position.y = camera.worldMouseY;
        }
    },
    { name: 'TorchSystem' },
);
