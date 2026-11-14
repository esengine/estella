// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    skyClock.ts
 * @brief   How far the clouds have drifted and changed: what the wind has done so far, added up frame by frame.
 *
 * @details A place worked out as speed times the time since the start moves the whole sky at once when the speed changes, by as much as the
 *          game has been running. So this keeps the sum instead: a storm blowing up speeds the clouds from where they are, the wind can
 *          swing round, a volume can bring a stronger one, and none of it moves a cloud. It follows the game's clock, so a paused game has a
 *          still sky and the same steps make the same clouds. Sky, its ground shadow and the fog's shafts all read this one sum.
 */
import { getEffectDef } from './effects';
import type { BlendedEffect } from './volumeBlending';

/** Where the clouds are in their drift. Plain numbers: what a save holds to bring the same sky back. @experimental */
export interface SkyClockState {
    /** How far the main layer has drifted, in kilometres. */
    driftX: number;
    driftZ: number;
    /** How far the upper layer has drifted, in kilometres. */
    upperDriftX: number;
    upperDriftZ: number;
    /** How far the clouds' shapes have changed, in the noise's own units. */
    evolve: number;
}

const state: SkyClockState = { driftX: 0, driftZ: 0, upperDriftX: 0, upperDriftZ: 0, evolve: 0 };
/** Kilometres a second each way, and the change a second, as the sky last said. */
const velocity = { x: 0, z: 0, upperX: 0, upperZ: 0, evolve: 0 };
/** The same with the weather's wind at 1: what a run's summed wind multiplies when the clock is moved to a moment. */
const still = { x: 0, z: 0, upperX: 0, upperZ: 0 };

function value(effect: BlendedEffect, name: string): number {
    const set = effect.uniforms.get(name);
    if (set !== undefined) return set;
    return getEffectDef('skyAtmosphere')?.uniforms.find((u) => u.name === name)?.defaultValue ?? 0;
}

/** Moves the clouds on by a frame of the game's clock, by the wind the sky last said. */
export function advanceSkyClock(delta: number): void {
    if (!(delta > 0)) return;
    state.driftX += velocity.x * delta;
    state.driftZ += velocity.z * delta;
    state.upperDriftX += velocity.upperX * delta;
    state.upperDriftZ += velocity.upperZ * delta;
    state.evolve += velocity.evolve * delta;
}

/** Tells the sky where its clouds are, and takes from it how they are moving. `wind` is the weather's × on the wind, 1 with none. */
export function applySkyClock(effects: Map<string, BlendedEffect>, wind: number): void {
    const sky = effects.get('skyAtmosphere');
    if (!sky || !sky.enabled) {
        // Nothing to carry: a sky that comes back takes up from where its clouds were, not from a wind that blew while it was gone.
        velocity.x = velocity.z = velocity.upperX = velocity.upperZ = velocity.evolve = 0;
        return;
    }
    const angle = value(sky, 'u_windDirection') * Math.PI / 180;
    const base = value(sky, 'u_windSpeed');
    const speed = base * wind;
    velocity.x = Math.sin(angle) * speed;
    velocity.z = Math.cos(angle) * speed;
    const upper = speed * value(sky, 'u_cloud2Wind');
    velocity.upperX = Math.sin(angle) * upper;
    velocity.upperZ = Math.cos(angle) * upper;
    still.x = Math.sin(angle) * base;
    still.z = Math.cos(angle) * base;
    still.upperX = still.x * value(sky, 'u_cloud2Wind');
    still.upperZ = still.z * value(sky, 'u_cloud2Wind');
    velocity.evolve = value(sky, 'u_cloudChange');
    sky.uniforms.set('u_cloudDriftX', state.driftX);
    sky.uniforms.set('u_cloudDriftZ', state.driftZ);
    sky.uniforms.set('u_cloud2DriftX', state.upperDriftX);
    sky.uniforms.set('u_cloud2DriftZ', state.upperDriftZ);
    sky.uniforms.set('u_cloudEvolve', state.evolve);
}

/** Where the clouds are now. @experimental */
export function skyClockState(): SkyClockState {
    return { ...state };
}

/** Puts the clouds where a save had them, or back to the start. @experimental */
export function setSkyClockState(next: Partial<SkyClockState> | null): void {
    state.driftX = next?.driftX ?? 0;
    state.driftZ = next?.driftZ ?? 0;
    state.upperDriftX = next?.upperDriftX ?? 0;
    state.upperDriftZ = next?.upperDriftZ ?? 0;
    state.evolve = next?.evolve ?? 0;
}

/**
 * Puts the clouds where `seconds` of the game's clock would have taken them, `windSeconds` of it at the weather's own wind (its strength
 * summed over the run): the sky's wind as it last said, the change of shape by time alone. What moving the scene clock to a moment does.
 *
 * @experimental
 */
export function seekSkyClock(seconds: number, windSeconds: number): void {
    state.driftX = still.x * windSeconds;
    state.driftZ = still.z * windSeconds;
    state.upperDriftX = still.upperX * windSeconds;
    state.upperDriftZ = still.upperZ * windSeconds;
    state.evolve = velocity.evolve * seconds;
}
