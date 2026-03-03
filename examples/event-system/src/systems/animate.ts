import {
    defineSystem, Query, Mut, Res, Time,
    Transform, Sprite,
} from 'esengine';
import { Collectible } from '../components';

export const animateSystem = defineSystem(
    [Query([Mut(Transform), Mut(Sprite), Collectible]), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, sprite, collectible] of query) {
            const scale = 1 + 0.2 * Math.sin(time.elapsed * collectible.pulseSpeed);
            transform.scale = { x: scale, y: scale, z: 1 };
        }
    },
    { name: 'AnimateSystem' }
);
