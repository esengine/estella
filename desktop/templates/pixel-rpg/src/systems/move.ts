import {
    defineSystem, Query, Mut, Res, Input, GetWorld,
    CharacterController, SpriteAnimator,
} from 'esengine';
import { Facings, Player } from '../components';

export const moveSystem = defineSystem(
    [Query(Mut(CharacterController), SpriteAnimator, Facings, Player), Res(Input), GetWorld()],
    (players, input, world) => {
        let x = 0;
        let y = 0;
        if (input.isKeyDown('ArrowLeft') || input.isKeyDown('KeyA')) x -= 1;
        if (input.isKeyDown('ArrowRight') || input.isKeyDown('KeyD')) x += 1;
        if (input.isKeyDown('ArrowDown') || input.isKeyDown('KeyS')) y -= 1;
        if (input.isKeyDown('ArrowUp') || input.isKeyDown('KeyW')) y += 1;
        // Normalised, or a diagonal would be ~1.4× faster than a straight line.
        const length = Math.hypot(x, y);
        const moving = length !== 0;

        for (const [entity, cc, animator, facings, player] of players) {
            cc.velocity.x = moving ? (x / length) * player.speed : 0;
            cc.velocity.y = moving ? (y / length) * player.speed : 0;

            // The way you face is a clip the scene chose, so new art is a new
            // asset rather than an edit here.
            const facing = moving
                ? (Math.abs(x) > Math.abs(y)
                    ? (x < 0 ? facings.left : facings.right)
                    : (y < 0 ? facings.down : facings.up))
                : animator.clip;
            const changed = animator.clip !== facing;

            // Written only when it CHANGES: the animator advances its own timer
            // on this component, and a system rewriting the whole thing every
            // frame puts that timer back — the cycle stands still.
            if (changed || animator.playing !== moving) {
                world.insert(entity, SpriteAnimator, {
                    ...animator,
                    clip: facing,
                    playing: moving,
                    currentFrame: changed ? 0 : animator.currentFrame,
                    frameTimer: changed ? 0 : animator.frameTimer,
                });
            }
        }
    },
    { name: 'MoveSystem' },
);
