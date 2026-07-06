import {
    defineSystem, Query, Mut, Res, Time, Commands,
    Transform, Sprite,
} from 'esengine';
import { Player, Puff, footsteps } from '../components';
import { PUFF_LIFE } from '../config';

// Turns queued footstep frame events into dust puffs at the player's feet,
// then fades/raises live puffs and despawns the spent ones. Spawning happens
// here (not in the event listener) so it runs through Commands, outside the
// animation system's update.
export const puffSystem = defineSystem(
    [Query(Transform, Player), Query(Mut(Transform), Mut(Sprite), Mut(Puff)), Res(Time), Commands()],
    (players, puffs, time, cmds) => {
        if (footsteps.pending > 0) {
            for (const [, transform, player] of players) {
                for (let i = footsteps.pending; i > 0; i--) {
                    const behind = player.vx >= 0 ? -1 : 1;
                    cmds.spawn()
                        .insert(Transform, {
                            position: {
                                x: transform.position.x + behind * (10 + Math.random() * 8),
                                y: transform.position.y - 44,
                                z: 0,
                            },
                        })
                        .insert(Sprite, {
                            size: { x: 12, y: 7 },
                            color: { r: 1, g: 1, b: 1, a: 0.4 },
                            layer: 3,
                        })
                        .insert(Puff, { life: PUFF_LIFE });
                }
            }
            footsteps.pending = 0;
        }

        for (const [entity, transform, sprite, puff] of puffs) {
            puff.life -= time.delta;
            const t = Math.max(0, puff.life / PUFF_LIFE);
            sprite.color.a = 0.4 * t;
            transform.position.y += 26 * time.delta;
            if (puff.life <= 0) cmds.despawn(entity);
        }
    },
    { name: 'PuffSystem' },
);
