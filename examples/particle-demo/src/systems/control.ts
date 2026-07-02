import {
    defineSystem, Query, Mut, Res, Commands,
    Input, UICameraInfo, Transform, Particle, ParticleAPI, ParticleEmitter,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { Follow, Burst } from '../components';
import { PRESETS, BURST, applyPreset } from '../config';

// Current preset index and whether the stream is paused — module state, since a
// keypress this frame changes what the follow emitter does next frame.
let current = 0;
let paused = false;

// All the input for the demo: 1–6 / Space pick a preset (applied live to the
// follow emitter), P toggles emission via the Particle resource, and left-click
// spawns a firework at the cursor that reuses the follow emitter's texture.
export const controlSystem = defineSystem(
    [Res(Input), Res(Particle), Res(UICameraInfo), Query(Mut(ParticleEmitter), Follow), Commands()],
    (input, particles: ParticleAPI, camera: UICameraData, follows, cmds) => {
        let next = -1;
        if (input.isKeyPressed('Space')) next = (current + 1) % PRESETS.length;
        for (let i = 0; i < PRESETS.length; i++) {
            if (input.isKeyPressed(`Digit${i + 1}`)) next = i;
        }
        const togglePause = input.isKeyPressed('KeyP');
        const click = camera.valid && input.isMouseButtonPressed(0);

        for (const [entity, emitter] of follows) {
            if (next >= 0) {
                current = next;
                applyPreset(emitter, PRESETS[current]);
            }
            if (togglePause) {
                paused = !paused;
                if (paused) particles.stop(entity); else particles.play(entity);
            }
            if (click) {
                cmds.spawn()
                    .insert(Transform, { position: { x: camera.worldMouseX, y: camera.worldMouseY, z: 0 } })
                    .insert(ParticleEmitter, { ...BURST, texture: emitter.texture })
                    .insert(Burst, { age: 0 });
            }
        }
    },
    { name: 'ControlSystem' },
);
