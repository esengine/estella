import {
    defineSystem, Query, Mut, Res, Time, Input,
    Transform, Sprite, Animator,
    AnimatorController, AnimatorControllerAPI,
} from 'esengine';
import { Player } from '../components';
import {
    WALK_SPEED, RUN_SPEED, ACCEL, RANGE_X,
    HOP_DURATION, HOP_HEIGHT, BASE_Y,
} from '../config';

// Input → movement + Animator parameters. The system never touches the
// SpriteAnimator: it eases a velocity, feeds |vx| into the `speed` float and
// Space into the `hop` trigger — the state machine picks every clip.
export const controlSystem = defineSystem(
    [Query(Mut(Transform), Mut(Sprite), Mut(Player), Animator), Res(Input), Res(Time), Res(AnimatorController)],
    (players, input, time, ctrl: AnimatorControllerAPI) => {
        const dir =
            (input.isKeyDown('ArrowRight') || input.isKeyDown('KeyD') ? 1 : 0) -
            (input.isKeyDown('ArrowLeft') || input.isKeyDown('KeyA') ? 1 : 0);
        const running = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight');
        const hop = input.isKeyPressed('Space');

        for (const [entity, transform, sprite, player, animator] of players) {
            // Ease toward the wanted velocity so the speed parameter sweeps
            // through the run blend threshold instead of jumping across it.
            const target = dir * (running ? RUN_SPEED : WALK_SPEED);
            const dv = target - player.vx;
            const step = ACCEL * time.delta;
            player.vx += Math.abs(dv) <= step ? dv : Math.sign(dv) * step;

            transform.position.x = Math.max(-RANGE_X, Math.min(RANGE_X, transform.position.x + player.vx * time.delta));
            if (dir !== 0) sprite.flipX = dir < 0;

            ctrl.setFloat(entity, 'speed', Math.abs(player.vx));
            if (hop) ctrl.setTrigger(entity, 'hop');

            // While the Hop state plays its clip, code adds the vertical arc.
            // The arc and the clip share one duration, so touchdown lands on the
            // same frame the exit-time transition returns the machine to Idle.
            if (animator.currentState === 'Hop') {
                player.hopTime = Math.min(player.hopTime + time.delta, HOP_DURATION);
                transform.position.y = BASE_Y + HOP_HEIGHT * Math.sin((player.hopTime / HOP_DURATION) * Math.PI);
            } else {
                player.hopTime = 0;
                transform.position.y = BASE_Y;
            }
        }
    },
    { name: 'ControlSystem' },
);
