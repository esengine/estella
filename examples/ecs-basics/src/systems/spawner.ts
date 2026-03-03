import {
    defineSystem, Query, Mut, Res, Time, Commands,
    Transform, Sprite,
} from 'esengine';
import { Spawner, Mover, Lifetime, Bouncer } from '../components';

const MAX_ENTITIES = 60;
let entityCount = 0;

export const spawnerSystem = defineSystem(
    [Query(Mut(Spawner), Transform), Res(Time), Commands()],
    (query, time, cmds) => {
        for (const [_entity, spawner, transform] of query) {
            spawner.timer += time.delta;
            if (spawner.timer < spawner.interval || entityCount >= MAX_ENTITIES) continue;
            spawner.timer = 0;

            const angle = Math.random() * Math.PI * 2;
            const speed = 80 + Math.random() * 120;
            const hue = Math.random();
            const rgb = hslToRgb(hue, 0.9, 0.6);
            const size = 10 + Math.random() * 20;

            const ec = cmds.spawn()
                .insert(Transform, {
                    position: { ...transform.position, z: 0 },
                })
                .insert(Sprite, {
                    size: { x: size, y: size },
                    color: { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 },
                })
                .insert(Mover, {
                    speed,
                    directionX: Math.cos(angle),
                    directionY: Math.sin(angle),
                })
                .insert(Lifetime, { remaining: 4 + Math.random() * 4 });

            if (Math.random() > 0.5) {
                ec.insert(Bouncer);
            }

            entityCount++;
        }
    },
    { name: 'SpawnerSystem' }
);

function hslToRgb(h: number, s: number, l: number) {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h * 12) % 12;
        return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return { r: f(0), g: f(8), b: f(4) };
}
