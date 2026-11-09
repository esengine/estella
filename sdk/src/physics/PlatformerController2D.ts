// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PlatformerController2D.ts
 * @brief   What a side-on character wants: run, jump, drop through. CharacterController2D is what the world makes of it.
 *
 * @details The forgiveness a platformer is judged on lives here, and on its own clock. A jump pressed a moment before landing still
 *          happens, and one pressed a moment after running off a ledge does too. Input is read per rendered frame and latched, so a tap
 *          between two fixed steps is not lost, and consumed on the fixed step, where the character actually moves.
 */
import { defineComponent, type ComponentDef } from '../ecs/component';

/** The fields of the `PlatformerController2D` component. @experimental */
export interface PlatformerController2DData {
    /** Top running speed, world pixels per second. */
    moveSpeed: number;
    /** How fast it reaches that speed on the ground, and in the air. */
    groundAcceleration: number;
    airAcceleration: number;
    /** How fast it sheds it when the stick centres, on the ground and in the air. */
    groundDeceleration: number;
    airDeceleration: number;
    /** Downward acceleration, world pixels per second squared. */
    gravity: number;
    /** Gravity multiplier while falling. Above 1 lands faster than it rose, which reads as weight. */
    fallGravityScale: number;
    /** The fastest it falls. */
    maxFallSpeed: number;
    /** Upward speed a jump starts with; 0 disables jumping. */
    jumpSpeed: number;
    /** How much of a rising speed survives letting go of jump, 0..1. 1 makes every jump full height. */
    jumpCut: number;
    /** Seconds after leaving the ground that a jump still counts as from the ground. */
    coyoteTime: number;
    /** Seconds a jump pressed too early is remembered, to happen on landing. */
    jumpBuffer: number;
    /** Extra jumps before landing again. */
    airJumps: number;
    /** Seconds a drop through a one-way platform lasts. */
    dropTime: number;
    /** A jump keeps the velocity of the platform it left. */
    keepPlatformVelocity: boolean;
    /** Read the keyboard itself. Off, a game or an AI writes `moveInput`, `jumpHeld`, `jumpPressed` and `dropPressed`. */
    readKeyboard: boolean;
    /** Input: -1 left to 1 right. */
    moveInput: number;
    /** Input: the jump button is down. */
    jumpHeld: boolean;
    /** Input: the jump button went down. Consumed by the next fixed step. */
    jumpPressed: boolean;
    /** Input: ask to drop through a one-way platform. Consumed by the next fixed step. */
    dropPressed: boolean;
    enabled: boolean;
}

/**
 * Runs and jumps a CharacterController2D, with the forgiveness a platformer needs.
 *
 * @experimental
 */
export const PlatformerController2D: ComponentDef<PlatformerController2DData> = defineComponent<PlatformerController2DData>('PlatformerController2D', {
    moveSpeed: 260,
    groundAcceleration: 2400,
    airAcceleration: 1500,
    groundDeceleration: 3000,
    airDeceleration: 900,
    gravity: 1600,
    fallGravityScale: 1.25,
    maxFallSpeed: 1000,
    jumpSpeed: 620,
    jumpCut: 0.5,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    airJumps: 0,
    dropTime: 0.2,
    keepPlatformVelocity: true,
    readKeyboard: true,
    moveInput: 0,
    jumpHeld: false,
    jumpPressed: false,
    dropPressed: false,
    enabled: true,
}, {
    fields: {
        moveSpeed: { min: 0, unit: 'px/s' },
        groundAcceleration: { min: 0, unit: 'px/s²', advanced: true },
        airAcceleration: { min: 0, unit: 'px/s²', advanced: true },
        groundDeceleration: { min: 0, unit: 'px/s²', advanced: true },
        airDeceleration: { min: 0, unit: 'px/s²', advanced: true },
        gravity: { min: 0, unit: 'px/s²' },
        fallGravityScale: { min: 0, step: 0.05, advanced: true, tooltip: 'Gravity multiplier while falling. Above 1 lands faster than it rose.' },
        maxFallSpeed: { min: 0, unit: 'px/s', advanced: true },
        jumpSpeed: { min: 0, unit: 'px/s', tooltip: 'Upward speed a jump starts with. 0 = cannot jump.' },
        jumpCut: { min: 0, max: 1, step: 0.05, tooltip: 'How much of a rising speed survives letting go of jump. 1 makes every jump full height.' },
        coyoteTime: { min: 0, step: 0.01, unit: 's', tooltip: 'After leaving the ground, how long a jump still counts as from the ground.' },
        jumpBuffer: { min: 0, step: 0.01, unit: 's', tooltip: 'How long a jump pressed too early is remembered, to happen on landing.' },
        airJumps: { min: 0, step: 1, tooltip: 'Extra jumps before landing again.' },
        dropTime: { min: 0, step: 0.01, unit: 's', tooltip: 'How long a drop through a one-way platform lasts.' },
        readKeyboard: { tooltip: 'Move with A/D or the arrows, jump with Space, W or Up, drop with Down or S and jump. Off, a game writes the inputs itself.' },
        moveInput: { min: -1, max: 1, step: 0.1, advanced: true },
        jumpHeld: { advanced: true },
        jumpPressed: { advanced: true },
        dropPressed: { advanced: true },
    },
});

/** What is true of one character between fixed steps. Not authored and not saved. @internal */
export interface PlatformerState {
    /** Seconds of coyote time left. */
    coyote: number;
    /** Seconds a buffered jump has left. */
    buffered: number;
    /** Seconds a drop has left. */
    dropping: number;
    airJumpsLeft: number;
    /** Rising from a jump that has not yet been cut. */
    jumping: boolean;
}

export function platformerState(airJumps = 0): PlatformerState {
    return { coyote: 0, buffered: 0, dropping: 0, airJumpsLeft: airJumps, jumping: false };
}

/** What the character controller reported of the last move. @internal */
export interface PlatformerGround {
    onFloor: boolean;
    onCeiling: boolean;
    /** The velocity of what it stands on. */
    floorVelocityX: number;
    floorVelocityY: number;
}

/** The velocity and collision wishes one fixed step ends in. @internal */
export interface PlatformerStep {
    velocityX: number;
    velocityY: number;
    dropThrough: boolean;
    jumped: boolean;
}

const approach = (from: number, to: number, step: number): number =>
    from < to ? Math.min(to, from + step) : Math.max(to, from - step);

/**
 * One fixed step of what the character wants, from its last velocity. Pure: every rule a player feels is here, and none of it needs a world.
 * Velocities are along the world's right and up. It updates `state`, and consumes nothing of `config`.
 * @internal
 */
export function stepPlatformer(
    config: PlatformerController2DData, state: PlatformerState, ground: PlatformerGround,
    velocityX: number, velocityY: number, jumpPressed: boolean, dropPressed: boolean, dt: number,
): PlatformerStep {
    const target = Math.max(-1, Math.min(1, config.moveInput)) * config.moveSpeed;
    const moving = target !== 0 && (velocityX === 0 || Math.sign(target) === Math.sign(velocityX));
    const rate = ground.onFloor
        ? (moving ? config.groundAcceleration : config.groundDeceleration)
        : (moving ? config.airAcceleration : config.airDeceleration);
    let vx = approach(velocityX, target, rate * dt);
    let vy = velocityY;

    state.coyote = Math.max(0, state.coyote - dt);
    state.buffered = Math.max(0, state.buffered - dt);
    state.dropping = Math.max(0, state.dropping - dt);

    if (ground.onFloor && vy <= 0) {
        state.coyote = config.coyoteTime;
        state.airJumpsLeft = config.airJumps;
        state.jumping = false;
    }
    if (jumpPressed) state.buffered = Math.max(config.jumpBuffer, dt);

    // A drop is asked for on the ground, and the same press is not also a jump.
    if (dropPressed && ground.onFloor) {
        state.dropping = config.dropTime;
        state.buffered = 0;
    }

    let jumped = false;
    if (state.buffered > 0 && config.jumpSpeed > 0 && state.dropping <= 0) {
        const fromGround = state.coyote > 0;
        if (fromGround || state.airJumpsLeft > 0) {
            if (!fromGround) state.airJumpsLeft--;
            vy = config.jumpSpeed;
            if (fromGround && config.keepPlatformVelocity) {
                vx += ground.floorVelocityX;
                if (ground.floorVelocityY > 0) vy += ground.floorVelocityY;
            }
            state.coyote = 0;
            state.buffered = 0;
            state.jumping = true;
            jumped = true;
        }
    }

    if (!jumped) {
        // Letting go of jump ends the rise once. The cut is on the jump, so being thrown upward by something else is left alone.
        if (state.jumping && vy > 0 && !config.jumpHeld) {
            vy *= config.jumpCut;
            state.jumping = false;
        }
        if (ground.onCeiling && vy > 0) vy = 0;
        const gravity = config.gravity * (vy < 0 ? config.fallGravityScale : 1);
        vy = Math.max(-config.maxFallSpeed, vy - gravity * dt);
    }

    return { velocityX: vx, velocityY: vy, dropThrough: state.dropping > 0, jumped };
}
