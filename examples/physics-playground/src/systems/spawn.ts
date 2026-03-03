import {
    defineSystem, Query, Mut, Res, Time, Commands,
    Transform, Sprite, RigidBody, BoxCollider, CircleCollider, BodyType,
} from 'esengine';
import { SpawnTimer } from '../components';

const MAX_BODIES = 40;
const SPAWN_Y = 250;
const PPU = 100;

let bodyCount = 0;

export const spawnSystem = defineSystem(
    [Query([Mut(SpawnTimer)]), Res(Time), Commands()],
    (query, time, cmds) => {
        for (const [_entity, timer] of query) {
            timer.timer += time.delta;
            if (timer.timer < timer.interval || bodyCount >= MAX_BODIES) continue;
            timer.timer = 0;

            const x = (Math.random() - 0.5) * 400;
            const hue = Math.random();
            const rgb = hslToRgb(hue, 0.85, 0.55);
            const useCircle = Math.random() > 0.5;

            if (useCircle) {
                const radius = 12 + Math.random() * 18;
                cmds.spawn()
                    .insert(Transform, { position: { x, y: SPAWN_Y, z: 0 } })
                    .insert(Sprite, {
                        size: { x: radius * 2, y: radius * 2 },
                        color: { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 },
                        texture: '0477f2e4-d640-4a8e-b696-36f52b7583df',
                    })
                    .insert(RigidBody, {
                        bodyType: BodyType.Dynamic,
                        restitution: 0.3 + Math.random() * 0.5,
                    })
                    .insert(CircleCollider, {
                        radius: radius / PPU,
                        restitution: 0.3 + Math.random() * 0.5,
                    });
            } else {
                const w = 20 + Math.random() * 30;
                const h = 20 + Math.random() * 30;
                cmds.spawn()
                    .insert(Transform, { position: { x, y: SPAWN_Y, z: 0 } })
                    .insert(Sprite, {
                        size: { x: w, y: h },
                        color: { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 },
                        texture: '88be0710-ab45-4377-ac76-166aecfbd56f',
                    })
                    .insert(RigidBody, {
                        bodyType: BodyType.Dynamic,
                    })
                    .insert(BoxCollider, {
                        halfExtents: { x: w / 2 / PPU, y: h / 2 / PPU },
                        restitution: 0.2 + Math.random() * 0.4,
                    });
            }

            bodyCount++;
        }
    },
    { name: 'SpawnSystem' }
);

function hslToRgb(h: number, s: number, l: number) {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h * 12) % 12;
        return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return { r: f(0), g: f(8), b: f(4) };
}
