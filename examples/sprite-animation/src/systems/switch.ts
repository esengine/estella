import {
    defineSystem, Query, Mut, Res, Time, SpriteAnimator,
} from 'esengine';
import { AnimSwitcher } from '../components';

export const switchSystem = defineSystem(
    [Query(Mut(SpriteAnimator), Mut(AnimSwitcher)), Res(Time)],
    (query, time) => {
        for (const [_entity, animator, switcher] of query) {
            switcher.switchTimer -= time.delta;
            if (switcher.switchTimer <= 0) {
                switcher.isWalking = !switcher.isWalking;
                animator.clip = switcher.isWalking
                    ? switcher.walkClip
                    : switcher.idleClip;
                animator.currentFrame = 0;
                animator.frameTimer = 0;
                switcher.switchTimer = 2 + Math.random() * 2;
            }
        }
    },
    { name: 'SwitchSystem' }
);
