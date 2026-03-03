import {
    defineSystem, Commands, EventReader,
    Transform, Sprite,
} from 'esengine';
import { SpawnRequestEvent } from '../events';
import { Collectible } from '../components';

export const spawnSystem = defineSystem(
    [EventReader(SpawnRequestEvent), Commands()],
    (reader, cmds) => {
        for (const event of reader) {
            cmds.spawn()
                .insert(Transform, {
                    position: { x: event.x, y: event.y, z: 0 },
                })
                .insert(Sprite, {
                    size: { x: 30, y: 30 },
                    color: { r: event.color.r, g: event.color.g, b: event.color.b, a: 1 },
                })
                .insert(Collectible, {
                    points: 10 + Math.floor(Math.random() * 20),
                    pulseSpeed: 2 + Math.random() * 3,
                });
        }
    },
    { name: 'SpawnSystem' }
);
