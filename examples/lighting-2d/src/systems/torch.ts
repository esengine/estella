import {
    defineSystem, Query, Mut, Res, Transform, UICameraInfo, Input,
} from 'esengine';
import type { UICameraData, InputState } from 'esengine';
import { Torch } from '../components';

// Pin the torch entity (a Point light + a small bright marker sprite) to the
// world-space mouse position. UICameraInfo already projects the cursor through
// the active camera, so no manual screen→world math is needed.
//
// Until the pointer has actually moved, leave the torch where the scene put it.
// A cursor that has never been over the canvas reads as (0, 0) — the top-left
// corner — and following that puts the room's only light off in a corner, so the
// demo opens on a black screen and stays there for anyone who has not yet moved
// the mouse (and for every screenshot taken of it).
export const torchSystem = defineSystem(
    [Query(Mut(Transform), Torch), Res(UICameraInfo), Res(Input)],
    (torches, camera: UICameraData, input: InputState) => {
        if (!camera.valid) return;
        if (input.mouseX === 0 && input.mouseY === 0) return;
        for (const [, transform] of torches) {
            transform.position.x = camera.worldMouseX;
            transform.position.y = camera.worldMouseY;
        }
    },
    { name: 'TorchSystem' },
);
