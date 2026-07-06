// Effects Gallery — the built-in material effect templates in one scene.
//
// Each character uses a material created from a Content Browser template
// (New Material → Hit Flash / Outline / Dissolve / Pixelate); the conveyor at
// the bottom scrolls itself in the shader via the injected u_time clock. The
// two animated ones show the code-driven pattern: a system writes a material
// parameter each frame with Material.setUniform.
import {
    addSystemToSchedule, Schedule, defineSystem, Query, Res, Time,
    Material, Sprite,
} from 'esengine';
import { FlashPulse, DissolveLoop } from './components';

const flashSystem = defineSystem(
    [Query(Sprite, FlashPulse), Res(Time)],
    (q, time) => {
        for (const [, sprite, pulse] of q) {
            if (!sprite.material) continue;
            const s = Math.max(0, Math.sin(time.elapsed * pulse.speed));
            Material.setUniform(sprite.material, 'u_flash', s * s);
        }
    },
    { name: 'FlashPulseSystem' },
);

const dissolveSystem = defineSystem(
    [Query(Sprite, DissolveLoop), Res(Time)],
    (q, time) => {
        for (const [, sprite, loop] of q) {
            if (!sprite.material) continue;
            const t = time.elapsed * loop.speed;
            const pingpong = 1 - Math.abs((t % 2) - 1);
            Material.setUniform(sprite.material, 'u_progress', pingpong);
        }
    },
    { name: 'DissolveLoopSystem' },
);

addSystemToSchedule(Schedule.Update, flashSystem);
addSystemToSchedule(Schedule.Update, dissolveSystem);
