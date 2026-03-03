import {
    defineSystem, Query, Mut, Res, Time,
    Transform, Sprite,
} from 'esengine';
import { Rotator } from '../components';

export const rotateSystem = defineSystem(
    [Query(Mut(Transform), Rotator), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, rotator] of query) {
            const angle = rotator.speed * time.elapsed * (Math.PI / 180);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            transform.rotation = { w: cos, x: 0, y: 0, z: sin };

            transform.position.y =
                rotator.baseY + Math.sin(time.elapsed * rotator.bobSpeed) * rotator.bobAmount;
        }
    },
    { name: 'RotateSystem' }
);

export const colorPulseSystem = defineSystem(
    [Query(Mut(Sprite), Rotator), Res(Time)],
    (query, time) => {
        for (const [_entity, sprite, rotator] of query) {
            const pulse = 0.7 + 0.3 * Math.sin(time.elapsed * rotator.bobSpeed * 1.5);
            sprite.color.a = pulse;
        }
    },
    { name: 'ColorPulseSystem' }
);
