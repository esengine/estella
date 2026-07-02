import {
    defineSystem, Query, Res, Commands,
    Input, UICameraInfo, Transform, Sprite, ParticleEmitter,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { TexHolder, Burst } from '../components';
import { BURST } from '../config';

// Clicking empty space (not a button — isPointerOverUI gates that out) throws a
// one-shot firework at the cursor, reusing the shared particle texture.
export const sparkSystem = defineSystem(
    [Res(Input), Res(UICameraInfo), Query(Sprite, TexHolder), Commands()],
    (input, camera: UICameraData, holders, cmds) => {
        if (!camera.valid || !input.isMouseButtonPressed(0) || input.isPointerOverUI()) return;
        let texture = 0;
        for (const [, sprite] of holders) texture = sprite.texture;
        cmds.spawn()
            .insert(Transform, { position: { x: camera.worldMouseX, y: camera.worldMouseY, z: 0 } })
            .insert(ParticleEmitter, { ...BURST, texture })
            .insert(Burst, { age: 0 });
    },
    { name: 'SparkSystem' },
);
