import {
    defineSystem, Query, Mut, Res, Time, Commands,
    Transform, Sprite,
} from 'esengine';
import { ShipControl, Bullet } from '../components';
import { Actions } from '../actions';
import { gestureState } from '../state';

const HALF_W = 370;
const HALF_H = 260;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const shipSystem = defineSystem(
    [Query(Mut(Transform), Mut(Sprite), Mut(ShipControl)), Res(Time), Commands()],
    (query, time, cmds) => {
        for (const [_entity, transform, sprite, ship] of query) {
            const move = Actions.axis2d('Move');
            let x = transform.position.x + move.x * ship.speed * time.delta;
            let y = transform.position.y + move.y * ship.speed * time.delta;

            // Swipe steps accumulated by the gesture handlers.
            x += gestureState.stepX;
            y += gestureState.stepY;
            gestureState.stepX = 0;
            gestureState.stepY = 0;

            transform.position.x = clamp(x, -HALF_W, HALF_W);
            transform.position.y = clamp(y, -HALF_H, HALF_H);

            // Zoom is the keyboard/gamepad twin of the pinch gesture, so both write
            // the same scale rather than each keeping its own.
            const zoom = Actions.value('Zoom');
            if (zoom !== 0) {
                gestureState.scale = clamp(gestureState.scale + zoom * time.delta, 0.5, 2.5);
            }
            transform.scale = { x: gestureState.scale, y: gestureState.scale, z: 1 };

            if (Actions.pressed('Fire')) {
                ship.flash = 1;
                cmds.spawn()
                    .insert(Transform, {
                        position: { x: transform.position.x, y: transform.position.y + 28, z: 0 },
                    })
                    .insert(Sprite, {
                        size: { x: 8, y: 18 },
                        color: { r: 1, g: 0.9, b: 0.4, a: 1 },
                        layer: 1,
                    })
                    .insert(Bullet, {});
            }

            ship.flash = Math.max(0, ship.flash - time.delta * 5);
            sprite.color = {
                r: 0.35 + 0.65 * ship.flash,
                g: 0.85 + 0.15 * ship.flash,
                b: 1,
                a: 1,
            };
        }
    },
    { name: 'ShipSystem' }
);

export const bulletSystem = defineSystem(
    [Query(Mut(Transform), Mut(Sprite), Mut(Bullet)), Res(Time), Commands()],
    (query, time, cmds) => {
        for (const [entity, transform, sprite, bullet] of query) {
            bullet.lifetime -= time.delta;
            transform.position.y += bullet.speed * time.delta;
            sprite.color.a = Math.max(0, bullet.lifetime / 0.7);
            if (bullet.lifetime <= 0) cmds.despawn(entity);
        }
    },
    { name: 'BulletSystem' }
);
