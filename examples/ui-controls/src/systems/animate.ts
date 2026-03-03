import {
    defineSystem, Query, Mut, Res, Time, ProgressBar,
} from 'esengine';
import { ProgressAnimator } from '../components';

export const progressAnimateSystem = defineSystem(
    [Query([Mut(ProgressBar), Mut(ProgressAnimator)]), Res(Time)],
    (query, time) => {
        for (const [_entity, bar, animator] of query) {
            bar.value += animator.speed * animator.direction * time.delta;
            if (bar.value >= 1) {
                bar.value = 1;
                animator.direction = -1;
            } else if (bar.value <= 0) {
                bar.value = 0;
                animator.direction = 1;
            }
        }
    },
    { name: 'ProgressAnimateSystem' }
);
