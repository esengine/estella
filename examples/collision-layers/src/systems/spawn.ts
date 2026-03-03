import {
    defineSystem, Query, Mut, Res, Time, Commands,
    Transform, Sprite, RigidBody, CircleCollider, BodyType,
} from 'esengine';
import { SpawnTimer } from '../components';

const LAYER_RED = 0x0001;
const LAYER_GREEN = 0x0002;
const LAYER_BLUE = 0x0004;
const LAYER_GROUND = 0x0008;

const MAX_BODIES = 50;
const SPAWN_Y = 260;
const PPU = 100;

const LAYERS = [
    { category: LAYER_RED, mask: LAYER_RED | LAYER_GROUND, color: { r: 1, g: 0.3, b: 0.3 }, x: -200 },
    { category: LAYER_GREEN, mask: LAYER_GREEN | LAYER_GROUND, color: { r: 0.3, g: 1, b: 0.3 }, x: 0 },
    { category: LAYER_BLUE, mask: LAYER_BLUE | LAYER_GROUND, color: { r: 0.3, g: 0.5, b: 1 }, x: 200 },
];

let bodyCount = 0;

export const spawnSystem = defineSystem(
    [Query([Mut(SpawnTimer)]), Res(Time), Commands()],
    (query, time, cmds) => {
        for (const [_entity, timer] of query) {
            timer.timer += time.delta;
            if (timer.timer < timer.interval || bodyCount >= MAX_BODIES) continue;
            timer.timer = 0;

            const layerIdx = bodyCount % 3;
            const layer = LAYERS[layerIdx];
            const radius = 10 + Math.random() * 10;
            const xOffset = (Math.random() - 0.5) * 80;

            cmds.spawn()
                .insert(Transform, { position: { x: layer.x + xOffset, y: SPAWN_Y, z: 0 } })
                .insert(Sprite, {
                    size: { x: radius * 2, y: radius * 2 },
                    color: { ...layer.color, a: 1 },
                })
                .insert(RigidBody, {
                    bodyType: BodyType.Dynamic,
                })
                .insert(CircleCollider, {
                    radius: radius / PPU,
                    restitution: 0.4,
                    categoryBits: layer.category,
                    maskBits: layer.mask,
                });

            bodyCount++;
        }
    },
    { name: 'SpawnSystem' }
);
