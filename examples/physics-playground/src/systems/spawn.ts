import {
    defineSystem, Query, Mut, Res, Time, Commands,
    Transform, ShapeRenderer, ShapeType,
    RigidBody, BoxCollider, CircleCollider, CapsuleCollider, BodyType,
} from 'esengine';
import { SpawnTimer } from '../components';

const MAX_BODIES = 40;
const SPAWN_Y = 250;
const PPU = 100;
let bodyCount = 0;

export const spawnSystem = defineSystem(
    [Query(Mut(SpawnTimer)), Res(Time), Commands()],
    (query, time, cmds) => {
        for (const [_entity, timer] of query) {
            timer.timer += time.delta;
            if (timer.timer < timer.interval || bodyCount >= MAX_BODIES) continue;
            timer.timer = 0;

            const x = (Math.random() - 0.5) * 400;
            const hue = Math.random();
            const rgb = hslToRgb(hue, 0.85, 0.55);
            const color = { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 };

            const variant = Math.floor(Math.random() * 3);

            if (variant === 0) {
                const r = 15 + Math.random() * 15;
                const d = r * 2;
                cmds.spawn()
                    .insert(Transform, { position: { x, y: SPAWN_Y, z: 0 } })
                    .insert(ShapeRenderer, {
                        shapeType: ShapeType.Circle,
                        size: { x: d, y: d },
                        color,
                    })
                    .insert(RigidBody, { bodyType: BodyType.Dynamic })
                    .insert(CircleCollider, {
                        radius: r / PPU,
                        restitution: 0.2 + Math.random() * 0.4,
                    });
            } else if (variant === 1) {
                const w = 20 + Math.random() * 20;
                const h = 40 + Math.random() * 30;
                cmds.spawn()
                    .insert(Transform, { position: { x, y: SPAWN_Y, z: 0 } })
                    .insert(ShapeRenderer, {
                        shapeType: ShapeType.Capsule,
                        size: { x: w, y: h },
                        color,
                    })
                    .insert(RigidBody, { bodyType: BodyType.Dynamic })
                    .insert(CapsuleCollider, {
                        radius: (w / 2) / PPU,
                        halfHeight: ((h - w) / 2) / PPU,
                        restitution: 0.2 + Math.random() * 0.4,
                    });
            } else {
                const w = 20 + Math.random() * 30;
                const h = 20 + Math.random() * 30;
                const cr = 4 + Math.random() * 6;
                cmds.spawn()
                    .insert(Transform, { position: { x, y: SPAWN_Y, z: 0 } })
                    .insert(ShapeRenderer, {
                        shapeType: ShapeType.RoundedRect,
                        size: { x: w, y: h },
                        cornerRadius: cr,
                        color,
                    })
                    .insert(RigidBody, { bodyType: BodyType.Dynamic })
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
