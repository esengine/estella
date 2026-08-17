import {
    defineSystem, Query, Mut, Res, ResMut, Input,
    CharacterController3D, Physics3DDebugDraw,
} from 'esengine';

const WALK_SPEED = 320;
const JUMP_SPEED = 520;

/**
 * Drive the character from the keyboard.
 *
 * Only the horizontal components are written: the vertical one is carried by the
 * world, so a zero there means "walk", not "hang in the air". A jump is the one
 * time a game writes it.
 */
export const controlSystem = defineSystem(
    [Query(Mut(CharacterController3D)), Res(Input)],
    (query, input) => {
        for (const [, character] of query) {
            let dx = 0;
            let dz = 0;
            if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dz -= 1;
            if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dz += 1;
            if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dx -= 1;
            if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dx += 1;

            const length = Math.hypot(dx, dz);
            character.velocity.x = length > 0 ? (dx / length) * WALK_SPEED : 0;
            character.velocity.z = length > 0 ? (dz / length) * WALK_SPEED : 0;
            character.velocity.y = input.isKeyDown('Space') && character.isOnFloor ? JUMP_SPEED : 0;
        }
    },
    { name: 'ControlSystem' },
);

/** The overlay IS the scenery here: this project ships no meshes, so the shapes
 *  the solver built are the whole picture. */
export const showShapesSystem = defineSystem(
    [ResMut(Physics3DDebugDraw)],
    (debug) => { debug.modify((config) => { config.enabled = true; }); },
    { name: 'ShowShapesSystem' },
);

export const debugToggleSystem = defineSystem(
    [Res(Input), ResMut(Physics3DDebugDraw)],
    (input, debug) => {
        if (!input.isKeyPressed('F1')) return;
        debug.modify((config) => { config.enabled = !config.enabled; });
    },
    { name: 'DebugToggleSystem' },
);
