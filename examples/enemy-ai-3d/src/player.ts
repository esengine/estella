import {
    defineSystem, Query, Mut, Res, ResMut, Input, Time, Transform, Camera,
    CharacterController3D, NavAgent, NavDebugDraw, Physics3DDebugDraw, NavObstacle,
} from 'esengine';

const WALK_SPEED = 340;

/**
 * Drive the player from the keyboard. Only the horizontal axes are written — the
 * vertical one is the world's, which makes walking off the terrace a fall. The
 * player is the character with no NavAgent; everything else on two legs here is
 * being driven by one.
 */
export const controlSystem = defineSystem(
    [Query(Mut(CharacterController3D)).without(NavAgent), Res(Input)],
    (players, input) => {
        for (const [, character] of players) {
            let dx = 0;
            let dz = 0;
            if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dz -= 1;
            if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dz += 1;
            if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dx -= 1;
            if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dx += 1;
            const length = Math.hypot(dx, dz);
            character.velocity.x = length > 0 ? (dx / length) * WALK_SPEED : 0;
            character.velocity.z = length > 0 ? (dz / length) * WALK_SPEED : 0;
            character.velocity.y = 0;
        }
    },
    { name: 'ControlSystem' },
);

/** Fraction of the remaining distance the eye closes per second. */
const CATCH_UP = 4;
const EYE = { x: 0, y: 620, z: 900 };

export const cameraFollowSystem = defineSystem(
    [Query(Mut(Transform), Camera), Query(Transform, CharacterController3D).without(NavAgent), Res(Time)],
    (cameras, players, time) => {
        let target: { x: number; y: number; z: number } | null = null;
        for (const [, transform] of players) {
            target = transform.position;
            break;
        }
        if (!target) return;
        const t = Math.min(1, CATCH_UP * time.delta);
        for (const [, transform] of cameras) {
            const p = transform.position;
            p.x += (target.x + EYE.x - p.x) * t;
            p.y += (target.y + EYE.y - p.y) * t;
            p.z += (target.z + EYE.z - p.z) * t;
        }
    },
    { name: 'CameraFollowSystem' },
);

/** The overlays ARE the scenery: this project ships no art, so what the solver
 *  built and what the bake found are the whole picture. */
export const showWorldSystem = defineSystem(
    [ResMut(Physics3DDebugDraw), ResMut(NavDebugDraw)],
    (shapes, nav) => {
        shapes.modify((config) => { config.enabled = true; });
        nav.modify((config) => { config.enabled = true; });
    },
    { name: 'ShowWorldSystem' },
);

/** G shuts the doorway and opens it again — the navigable world is rebuilt for it
 *  while the game runs, and the hunters go the long way round instead. */
export const gateSystem = defineSystem(
    [Query(Mut(NavObstacle)), Res(Input)],
    (gates, input) => {
        if (!input.isKeyPressed('KeyG')) return;
        for (const [, gate] of gates) gate.enabled = !gate.enabled;
    },
    { name: 'GateSystem' },
);
