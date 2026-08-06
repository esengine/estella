import {
    defineSystem, Query, Mut, Res, Transform, UICameraInfo, Input,
} from 'esengine';
import type { UICameraData, InputState } from 'esengine';
import { Torch } from '../components';

// Pin the torch entity (a Point light + a small bright marker sprite) to the
// world-space mouse position. UICameraInfo already projects the cursor through
// the active camera, so no manual screen→world math is needed.
//
// Until the pointer has actually MOVED, leave the torch where the scene put it.
// A pointer that has never been used still reports a position — (0, 0) on the
// web, whatever the last touch left behind on a phone — and following it puts
// the room's only light in a corner, so the demo opens on a black screen for
// anyone who has not yet moved the mouse, and for every screenshot taken of it.
// Movement is the signal, not any particular resting value: a device with no
// mouse at all never produces one, which is the correct answer there.
let originX: number | null = null;
let originY: number | null = null;
let moved = false;

export const torchSystem = defineSystem(
    [Query(Mut(Transform), Torch), Res(UICameraInfo), Res(Input)],
    (torches, camera: UICameraData, input: InputState) => {
        if (!camera.valid) return;
        if (!moved) {
            if (originX === null) {
                originX = input.mouseX;
                originY = input.mouseY;
                return;
            }
            if (input.mouseX === originX && input.mouseY === originY) return;
            moved = true;
        }
        for (const [, transform] of torches) {
            transform.position.x = camera.worldMouseX;
            transform.position.y = camera.worldMouseY;
        }
    },
    { name: 'TorchSystem' },
);
