import {
    defineSystem, Query, Mut, Res, Input,
    CharacterController3D,
} from 'esengine';

const WALK_SPEED = 340;
const JUMP_SPEED = 560;

/**
 * Walk the character on the ground plane (x and z) and jump off it. Only the
 * horizontal components are written each frame — the vertical one is the world's,
 * so leaving it alone means "walk" rather than "hang in the air". The diagonal is
 * normalised, or two keys would be ~1.4x faster than one.
 */
export const walkSystem = defineSystem(
    [Query(Mut(CharacterController3D)), Res(Input)],
    (characters, input) => {
        let x = 0;
        let z = 0;
        if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) x -= 1;
        if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) x += 1;
        if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) z -= 1;
        if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) z += 1;
        const length = Math.hypot(x, z);

        for (const [, character] of characters) {
            character.velocity.x = length > 0 ? (x / length) * WALK_SPEED : 0;
            character.velocity.z = length > 0 ? (z / length) * WALK_SPEED : 0;
            if (input.isKeyDown('Space') && character.isOnFloor) character.velocity.y = JUMP_SPEED;
        }
    },
    { name: 'WalkSystem' },
);
