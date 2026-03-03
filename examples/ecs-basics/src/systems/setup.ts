import {
    defineSystem, Commands, Transform, Sprite,
} from 'esengine';
import { Spawner } from '../components';

export const setupSystem = defineSystem(
    [Commands()],
    (cmds) => {
        cmds.spawn()
            .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
            .insert(Sprite, {
                size: { x: 40, y: 40 },
                color: { r: 1, g: 1, b: 1, a: 1 },
            })
            .insert(Spawner, { interval: 0.8, timer: 0 });
    },
    { name: 'SetupSystem' }
);
